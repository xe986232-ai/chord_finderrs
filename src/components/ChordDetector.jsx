import { useState, useRef, useCallback } from "react";
import { Upload, Music2, Loader2, AlertCircle, RotateCcw, Guitar, Download } from "lucide-react";

/**
 * ChordDetector
 * -------------
 * Upload audio -> Basic Pitch (Spotify) jalan LANGSUNG di browser buat deteksi
 * nada-nada yang main bareng -> nada-nada itu dikelompokin per window waktu ->
 * tiap window dicocokin ke pola chord MAYOR/MINOR (chroma template matching)
 * -> keluar progresi chord sepanjang lagu (C, Am, F, G, dst).
 *
 * TIDAK ADA BACKEND. Semua proses di device user sendiri, audio nggak pernah
 * dikirim ke server manapun.
 *
 * Dependency: npm install @spotify/basic-pitch
 * Model file WAJIB ditaruh di public/basic-pitch-model/ (lihat README.md)
 *
 * Catatan desain: ini SENGAJA cuma ngenalin MAYOR & MINOR (gak ada 7th, sus,
 * dim, aug, dst) -- biar hasilnya simpel & gampang dibaca buat main gitar/piano.
 */

const MODEL_PATH = "/basic-pitch-model/model.json";

// Threshold deteksi not polyphonic (dari Basic Pitch)
const ONSET_THRESHOLD = 0.4;
const FRAME_THRESHOLD = 0.25;
const MIN_NOTE_LENGTH = 3;

// Panjang tiap window analisis chord, dalam detik.
// Makin kecil = makin detail (nangkep pergantian chord cepat) tapi makin gampang goyah/noise.
const WINDOW_SIZE = 1.0;

// Minimum "energi" nada dalam satu window biar dianggap ada chord (bukan hening/noise).
const MIN_ENERGY = 0.12;

// Minimum durasi satu segmen chord (detik) -- segmen yang lebih pendek dari ini
// digabung ke tetangganya biar progresi gak "kedip-kedip".
const MIN_SEGMENT_DURATION = 0.75;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR_INTERVALS = [0, 4, 7];
const MINOR_INTERVALS = [0, 3, 7];

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function decodeAndResample(arrayBuffer, targetSampleRate = 22050) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  await audioCtx.close();

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
  const { BasicPitch, outputToNotesPoly, noteFramesToTime } = await import("@spotify/basic-pitch");

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
    outputToNotesPoly(frames, onsets, ONSET_THRESHOLD, FRAME_THRESHOLD, MIN_NOTE_LENGTH)
  );

  return notes;
}

// Sebar tiap not ke window waktu yang dia lewatin, bobotnya pakai amplitude not itu.
function buildChromaWindows(notes, totalDuration) {
  const numWindows = Math.max(1, Math.ceil(totalDuration / WINDOW_SIZE));
  const windows = Array.from({ length: numWindows }, () => new Array(12).fill(0));

  notes.forEach((note) => {
    const start = note.startTimeSeconds;
    const end = start + note.durationSeconds;
    const pitchClass = ((Math.round(note.pitchMidi) % 12) + 12) % 12;
    const amp = note.amplitude || 0.5;

    const startW = Math.max(0, Math.floor(start / WINDOW_SIZE));
    const endW = Math.min(numWindows - 1, Math.floor(end / WINDOW_SIZE));
    for (let w = startW; w <= endW; w++) {
      windows[w][pitchClass] += amp;
    }
  });

  return windows;
}

// Cocokin satu chroma vector ke 12 pola mayor + 12 pola minor, ambil skor tertinggi.
function matchChord(chroma) {
  const totalEnergy = chroma.reduce((a, b) => a + b, 0);
  if (totalEnergy < MIN_ENERGY) return null;

  let best = { root: -1, quality: "", score: -Infinity };

  for (let root = 0; root < 12; root++) {
    const majorScore = MAJOR_INTERVALS.reduce((s, iv) => s + chroma[(root + iv) % 12], 0);
    const minorScore = MINOR_INTERVALS.reduce((s, iv) => s + chroma[(root + iv) % 12], 0);

    if (majorScore > best.score) best = { root, quality: "", score: majorScore };
    if (minorScore > best.score) best = { root, quality: "m", score: minorScore };
  }

  return `${NOTE_NAMES[best.root]}${best.quality}`;
}

// Window per-window -> gabung window berlabel sama jadi satu segmen, lalu
// gabung segmen yang kependekan ke tetangganya biar progresi rapi.
function windowsToSegments(windows) {
  let segments = [];

  windows.forEach((chroma, i) => {
    const label = matchChord(chroma) || "N.C.";
    const startTime = i * WINDOW_SIZE;
    const endTime = startTime + WINDOW_SIZE;

    const last = segments[segments.length - 1];
    if (last && last.chord === label) {
      last.endTime = endTime;
    } else {
      segments.push({ chord: label, startTime, endTime });
    }
  });

  // Gabungin segmen pendek ke segmen sebelah (biasanya noise di antara dua chord stabil)
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < segments.length; i++) {
      const dur = segments[i].endTime - segments[i].startTime;
      if (dur < MIN_SEGMENT_DURATION && segments.length > 1) {
        if (i === 0) {
          segments[1].startTime = segments[0].startTime;
          segments.shift();
        } else {
          segments[i - 1].endTime = segments[i].endTime;
          segments.splice(i, 1);
        }
        merged = true;
        break;
      }
    }
  }

  // Setelah digabung, mungkin ada dua segmen bersebelahan dengan chord sama -> gabung lagi
  const final = [];
  segments.forEach((seg) => {
    const last = final[final.length - 1];
    if (last && last.chord === seg.chord) {
      last.endTime = seg.endTime;
    } else {
      final.push({ ...seg });
    }
  });

  return final.filter((s) => s.chord !== "N.C." || final.length === 1);
}

export default function ChordDetector() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | processing | ready | error
  const [progress, setProgress] = useState(0);
  const [segments, setSegments] = useState([]);
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
    setSegments([]);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const audioData = await decodeAndResample(arrayBuffer);
      const totalDuration = audioData.length / 22050;

      const notes = await audioToNotes(audioData, (p) => setProgress(p));

      if (notes.length === 0) {
        setErrorMsg("Nggak ada nada yang terdeteksi. Coba audio yang lebih jelas (musik dengan iringan chord yang jelas biasanya lebih akurat dari full mix yang padat).");
        setStatus("error");
        return;
      }

      const windows = buildChromaWindows(notes, totalDuration);
      const chordSegments = windowsToSegments(windows);

      if (chordSegments.length === 0) {
        setErrorMsg("Chord nggak berhasil dikenali dari audio ini.");
        setStatus("error");
        return;
      }

      setSegments(chordSegments);
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

  const downloadChordChart = () => {
    if (!segments.length) return;
    const lines = segments.map((s) => `${formatTime(s.startTime)} - ${formatTime(s.endTime)}\t${s.chord}`);
    const text = `Chord chart: ${file?.name || "audio"}\n\n${lines.join("\n")}\n`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const baseName = file?.name?.replace(/\.[^/.]+$/, "") || "chords";
    a.href = url;
    a.download = `${baseName}-chords.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setSegments([]);
    setErrorMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="min-h-full w-full bg-[#0A0C10] text-[#E8E9EC] flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#3ECF8E] to-[#2A9D6F] flex items-center justify-center shadow-lg shadow-[#3ECF8E]/20">
            <Guitar className="w-5 h-5 text-[#0A0C10]" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">Deteksi Chord</h1>
            <p className="text-xs text-[#8B8F98]">Upload lagu, dapatkan progresi chord mayor/minor — semua di browser lu</p>
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
                  <p className="text-xs text-[#8B8F98] mt-1">AI sedang menganalisis chord...</p>
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
                    {segments.length}
                  </span>
                  <span className="text-[11px] uppercase tracking-widest text-[#5A5D66]">
                    segmen chord
                  </span>
                </div>

                {/* Timeline progresi chord */}
                <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-[#5A5D66] mb-2 px-1">Progresi chord</p>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {segments.map((s, i) => (
                      <div
                        key={i}
                        className="shrink-0 flex flex-col items-center justify-center rounded-lg px-4 py-3 min-w-[64px] bg-white/[0.04]"
                      >
                        <span className="text-base font-bold text-[#3ECF8E]">
                          {s.chord}
                        </span>
                        <span className="text-[9px] mt-0.5 text-[#5A5D66]">
                          {formatTime(s.startTime)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={downloadChordChart}
                    className="flex-1 flex items-center justify-center gap-2 rounded-full bg-[#3ECF8E] text-[#0A0C10] font-semibold text-sm py-3 hover:brightness-110 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    Download chord chart (.txt)
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
                  Cuma dikenalin sebagai mayor/minor (C, C#m, dst) — nggak termasuk 7th/sus/dim.
                  Musik dengan aransemen padat (full band) bisa bikin deteksi kurang presisi.
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
