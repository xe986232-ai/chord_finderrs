import { useState, useRef, useCallback } from "react";
import { Upload, Music2, Download, Loader2, AlertCircle, RotateCcw, Piano } from "lucide-react";

/**
 * AudioToMidi
 * -----------
 * Upload audio -> AI model (Spotify Basic Pitch) jalan LANGSUNG di browser,
 * hasil note events dirangkai jadi file .midi -> download.
 *
 * TIDAK ADA BACKEND. Semua proses (decode audio, resample, inference model,
 * generate file MIDI) terjadi di device user sendiri. Audio nggak pernah
 * dikirim ke server manapun.
 *
 * Dependency yang harus diinstall:
 *   npm install @spotify/basic-pitch @tonejs/midi
 *
 * Model file WAJIB ditaruh di public/basic-pitch-model/ (lihat README.md)
 */

const MODEL_PATH = "/basic-pitch-model/model.json";

// Threshold buat outputToNotesPoly -- lihat README kalau mau tuning akurasi
const ONSET_THRESHOLD = 0.5; // makin tinggi = makin strict soal awal not baru
const FRAME_THRESHOLD = 0.3; // makin tinggi = makin strict soal not yang "nyambung"
const MIN_NOTE_LENGTH = 5; // minimum panjang not (dalam frame) biar noise kebuang

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Konversi MIDI note number -> nama not (buat preview list, misal 60 -> "C4")
function midiToNoteName(midiNumber) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midiNumber / 12) - 1;
  const name = names[midiNumber % 12];
  return `${name}${octave}`;
}

async function decodeAndResample(arrayBuffer, targetSampleRate = 22050) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  await audioCtx.close();

  // Mixdown ke mono (rata-rata semua channel)
  const numChannels = decoded.numberOfChannels;
  const originalLength = decoded.length;
  const monoData = new Float32Array(originalLength);
  for (let i = 0; i < originalLength; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      sum += decoded.getChannelData(ch)[i];
    }
    monoData[i] = sum / numChannels;
  }

  // Resample linear interpolation ke 22050Hz (wajib, model dilatih di rate ini)
  const originalRate = decoded.sampleRate;
  if (originalRate === targetSampleRate) return monoData;

  const ratio = targetSampleRate / originalRate;
  const newLength = Math.floor(originalLength * ratio);
  const resampled = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const pos = i / ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = monoData[idx] || 0;
    const b = monoData[idx + 1] || monoData[idx] || 0;
    resampled[i] = a + (b - a) * frac;
  }
  return resampled;
}

async function audioToNotes(audioData, onProgress) {
  const { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } =
    await import("@spotify/basic-pitch");

  const basicPitch = new BasicPitch(MODEL_PATH);

  const frames = [];
  const onsets = [];
  const contours = [];

  await basicPitch.evaluateModel(
    audioData,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress(p)
  );

  const notes = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(frames, onsets, ONSET_THRESHOLD, FRAME_THRESHOLD, MIN_NOTE_LENGTH)
    )
  );

  return notes;
}

async function notesToMidiBytes(notes) {
  const { Midi } = await import("@tonejs/midi");
  const midi = new Midi();
  const track = midi.addTrack();

  notes.forEach((note) => {
    track.addNote({
      midi: note.pitchMidi,
      time: note.startTimeSeconds,
      duration: note.durationSeconds,
      velocity: Math.min(1, Math.max(0, note.amplitude)),
    });

    if (note.pitchBends) {
      note.pitchBends.forEach((bend, i) => {
        track.addPitchBend({
          time: note.startTimeSeconds + (i * note.durationSeconds) / note.pitchBends.length,
          value: bend,
        });
      });
    }
  });

  return midi.toArray();
}

export default function AudioToMidi() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | processing | ready | error
  const [progress, setProgress] = useState(0);
  const [notes, setNotes] = useState([]);
  const [midiBytes, setMidiBytes] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef(null);

  const handleFile = useCallback(async (selectedFile) => {
    if (!selectedFile || !selectedFile.type.startsWith("audio")) {
      setErrorMsg("Format file harus audio (MP3, WAV, M4A, FLAC, OGG).");
      setStatus("error");
      return;
    }

    setFile(selectedFile);
    setStatus("processing");
    setProgress(0);
    setErrorMsg("");
    setNotes([]);
    setMidiBytes(null);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const audioData = await decodeAndResample(arrayBuffer);

      const detectedNotes = await audioToNotes(audioData, (p) => setProgress(p));

      if (detectedNotes.length === 0) {
        setErrorMsg("Nggak ada not yang terdeteksi. Coba audio yang lebih jelas (vokal/instrumen tunggal biasanya lebih akurat dari full mix).");
        setStatus("error");
        return;
      }

      const bytes = await notesToMidiBytes(detectedNotes);

      setNotes(detectedNotes);
      setMidiBytes(bytes);
      setStatus("ready");
    } catch (err) {
      setErrorMsg(`Gagal memproses audio: ${err.message || "unknown error"}`);
      setStatus("error");
    }
  }, []);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handleFile(dropped);
  };

  const downloadMidi = () => {
    if (!midiBytes) return;
    const blob = new Blob([midiBytes], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const baseName = file?.name?.replace(/\.[^/.]+$/, "") || "transcription";
    a.href = url;
    a.download = `${baseName}.mid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setNotes([]);
    setMidiBytes(null);
    setErrorMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="min-h-full w-full bg-[#0A0C10] text-[#E8E9EC] flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#3ECF8E] to-[#2A9D6F] flex items-center justify-center shadow-lg shadow-[#3ECF8E]/20">
            <Piano className="w-5 h-5 text-[#0A0C10]" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">Audio ke MIDI</h1>
            <p className="text-xs text-[#8B8F98]">Upload lagu, dapatkan file .mid — semua proses di browser lu</p>
          </div>
        </div>

        {/* Main card */}
        <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-1 shadow-2xl shadow-black/40 overflow-hidden">
          <div className="rounded-xl bg-gradient-to-b from-white/[0.04] to-transparent p-6">

            {status === "idle" && (
              <label
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-14 cursor-pointer transition-all duration-200 ${
                  isDragOver
                    ? "border-[#3ECF8E] bg-[#3ECF8E]/5"
                    : "border-white/10 hover:border-white/20 hover:bg-white/[0.02]"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-[#8B8F98]" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-white">Tap atau drop file audio di sini</p>
                  <p className="text-xs text-[#8B8F98] mt-1">MP3, WAV, M4A, FLAC, OGG</p>
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[#5A5D66]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3ECF8E]" />
                  Tanpa upload ke server — 100% diproses lokal
                </div>
              </label>
            )}

            {status === "processing" && (
              <div className="flex flex-col items-center justify-center gap-4 py-14">
                <Loader2 className="w-8 h-8 text-[#3ECF8E] animate-spin" />
                <div className="text-center w-full max-w-xs">
                  <p className="text-sm font-medium text-white truncate">{file?.name}</p>
                  <p className="text-xs text-[#8B8F98] mt-1">AI sedang mentranskrip not...</p>
                </div>
                <div className="w-full max-w-xs h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full bg-[#3ECF8E] transition-all duration-150"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-[#5A5D66] tabular-nums">{Math.round(progress * 100)}%</p>
              </div>
            )}

            {status === "error" && (
              <div className="flex flex-col items-center justify-center gap-4 py-14">
                <AlertCircle className="w-8 h-8 text-[#F27171]" />
                <p className="text-sm text-[#F27171] text-center max-w-sm">{errorMsg}</p>
                <button
                  onClick={reset}
                  className="text-xs text-[#8B8F98] hover:text-white underline"
                >
                  Coba lagi
                </button>
              </div>
            )}

            {status === "ready" && (
              <div className="space-y-5">
                {/* Ringkasan hasil */}
                <div className="rounded-xl bg-black/40 border border-white/5 px-6 py-8 flex flex-col items-center gap-2">
                  <span className="text-5xl font-bold tabular-nums text-[#3ECF8E]" style={{ textShadow: "0 0 24px rgba(62,207,142,0.35)" }}>
                    {notes.length}
                  </span>
                  <span className="text-[11px] uppercase tracking-widest text-[#5A5D66]">
                    not terdeteksi
                  </span>
                </div>

                {/* Preview beberapa not pertama */}
                <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5D66] mb-2 px-1">Preview not (10 pertama)</p>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {notes.slice(0, 10).map((n, i) => (
                      <div
                        key={i}
                        className="shrink-0 flex flex-col items-center justify-center rounded-lg px-3 py-2 min-w-[52px] bg-white/[0.04]"
                      >
                        <span className="text-xs font-bold text-[#B8BAC0]">
                          {midiToNoteName(Math.round(n.pitchMidi))}
                        </span>
                        <span className="text-[9px] mt-0.5 text-[#5A5D66]">
                          {formatTime(n.startTimeSeconds)}
                        </span>
                      </div>
                    ))}
                    {notes.length > 10 && (
                      <div className="shrink-0 flex items-center justify-center px-3 text-[11px] text-[#5A5D66]">
                        +{notes.length - 10} lagi
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={downloadMidi}
                    className="flex-1 flex items-center justify-center gap-2 rounded-full bg-[#3ECF8E] text-[#0A0C10] font-semibold text-sm py-3 hover:brightness-110 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    Download .mid
                  </button>
                  <button
                    onClick={reset}
                    title="Upload lagu lain"
                    className="w-11 h-11 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center shrink-0 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4 text-[#8B8F98]" />
                  </button>
                </div>

                <p className="text-[11px] text-[#5A5D66] text-center leading-relaxed">
                  Import file .mid ke FL Studio Mobile lewat file manager, atau share ke app FL Studio Mobile langsung.
                  Not belum di-quantize — sesuaikan grid/snap di piano roll kalau perlu.
                </p>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-[#4A4D54] mt-4 flex items-center justify-center gap-1.5">
          <Music2 className="w-3 h-3" />
          Ditenagai Basic Pitch (Spotify, Apache-2.0 License) — jalan 100% di browser
        </p>
      </div>
    </div>
  );
}
