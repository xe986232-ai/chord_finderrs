import { useState, useRef, useCallback } from "react";
import { Upload, Music2, Loader2, AlertCircle, RotateCcw, Guitar, Download } from "lucide-react";

/**
 * ChordDetector
 * -------------
 * Upload audio -> Essentia.js (MTG/UPF, port WASM dari library Essentia C++)
 * jalan LANGSUNG di browser -> hitung HPCP (Harmonic Pitch Class Profile,
 * chroma feature) per frame dari spektrum audio -> ChordsDetection
 * (algoritma MIR standar) mencocokkan tiap window ke triad MAYOR/MINOR
 * terdekat -> keluar progresi chord (C, Am, F, G, dst).
 *
 * Ini beda dari pendekatan sebelumnya yang "akal-akalan" numpang di model
 * transkripsi melodi (Basic Pitch) -- sekarang pakai algoritma yang memang
 * dirancang buat chord recognition (HPCP + ChordsDetection), jadi jauh
 * lebih tahan sama harmonik/overtone instrumen asli.
 *
 * TIDAK ADA BACKEND. Semua proses di device user sendiri, audio nggak pernah
 * dikirim ke server manapun.
 *
 * Dependency: npm install essentia.js
 * File WASM-nya WAJIB ditaruh di public/essentia/ (lihat README.md) --
 * di-load lewat <script> tag runtime (bukan bundling langsung), karena
 * itu cara yang direkomendasikan resmi buat WASM Essentia di browser.
 */

const ESSENTIA_WASM_JS = "/essentia/essentia-wasm.web.js";
const ESSENTIA_CORE_JS = "/essentia/essentia.js-core.js";

const FRAME_SIZE = 4096;
const HOP_SIZE = 2048;
const CHORD_WINDOW_SIZE = 2; // detik, dipakai internal oleh ChordsDetection buat smoothing

// Minimum durasi satu segmen chord (detik) -- segmen lebih pendek dari ini
// digabung ke tetangganya biar progresi gak "kedip-kedip".
const MIN_SEGMENT_DURATION = 0.75;

// Frame dengan energi di bawah ini dianggap hening -> dilabeli "N.C." (no chord)
const SILENCE_RMS_RATIO = 0.06; // relatif terhadap RMS maksimum di seluruh lagu

let essentiaLoadPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`Gagal load ${src}`)));
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });
    script.addEventListener("error", () => reject(new Error(`Gagal load ${src}`)));
    document.body.appendChild(script);
  });
}

// Load essentia-wasm.web.js + essentia.js-core.js sekali aja (cached), lalu
// inisialisasi instance Essentia siap pakai.
async function loadEssentia() {
  if (!essentiaLoadPromise) {
    essentiaLoadPromise = (async () => {
      await loadScript(ESSENTIA_WASM_JS);
      await loadScript(ESSENTIA_CORE_JS);
      const wasmModule = await window.EssentiaWASM();
      return new window.Essentia(wasmModule);
    })();
  }
  return essentiaLoadPromise;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function decodeToMono(arrayBuffer) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  await audioCtx.close();

  const numChannels = decoded.numberOfChannels;
  const length = decoded.length;
  const monoData = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      sum += decoded.getChannelData(ch)[i];
    }
    monoData[i] = sum / numChannels;
  }

  return { audioData: monoData, sampleRate: decoded.sampleRate };
}

// Jalanin pipeline HPCP standar (Windowing -> Spectrum -> SpectralPeaks -> HPCP)
// per frame, sambil ngitung RMS tiap frame buat gerbang "hening".
async function extractChords(essentia, audioData, sampleRate, onProgress) {
  const frames = essentia.FrameGenerator(audioData, FRAME_SIZE, HOP_SIZE);
  const numFrames = frames.size();

  const pcpVec = new essentia.module.VectorVectorFloat();
  const rmsValues = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    const frame = frames.get(i);

    const rms = essentia.RMS(frame).rms;
    rmsValues[i] = rms;

    const windowed = essentia.Windowing(frame, true, FRAME_SIZE, "blackmanharris62", 0, true);
    const spectrum = essentia.Spectrum(windowed.frame, FRAME_SIZE);
    const peaks = essentia.SpectralPeaks(
      spectrum.spectrum,
      0.00001, // magnitudeThreshold
      5000, // maxFrequency
      100, // maxPeaks
      40, // minFrequency
      "magnitude", // orderBy
      sampleRate
    );
    const hpcp = essentia.HPCP(
      peaks.frequencies,
      peaks.magnitudes,
      true, // bandPreset
      500, // bandSplitFrequency
      0, // harmonics
      5000, // maxFrequency
      false, // maxShifted
      40, // minFrequency
      false, // nonLinear
      "unitMax", // normalized
      440, // referenceFrequency
      sampleRate,
      12, // size
      "squaredCosine", // weightType
      1 // windowSize
    );

    pcpVec.push_back(hpcp.hpcp);

    if (i % 80 === 0) {
      onProgress(i / numFrames);
      // kasih napas ke browser biar UI (progress bar) gak nge-freeze
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  onProgress(0.95);

  const result = essentia.ChordsDetection(pcpVec, HOP_SIZE, sampleRate, CHORD_WINDOW_SIZE);

  const chordLabels = [];
  const chordsOut = result.chords;
  const total = typeof chordsOut.size === "function" ? chordsOut.size() : chordsOut.length;
  for (let i = 0; i < total; i++) {
    const label = typeof chordsOut.get === "function" ? chordsOut.get(i) : chordsOut[i];
    chordLabels.push(label || "N");
  }

  // Gerbang hening: cari RMS maksimum, tandai frame yang terlalu pelan sebagai "N.C."
  let maxRms = 0;
  for (let i = 0; i < rmsValues.length; i++) {
    if (rmsValues[i] > maxRms) maxRms = rmsValues[i];
  }
  const silenceThreshold = maxRms * SILENCE_RMS_RATIO;

  const hopDuration = HOP_SIZE / sampleRate;
  const labeled = chordLabels.map((label, i) => {
    const isSilent = (rmsValues[i] || 0) < silenceThreshold;
    return {
      chord: isSilent || label === "N" ? "N.C." : label,
      time: i * hopDuration,
    };
  });

  return labeled;
}

// Gabungin label per-frame jadi segmen, lalu gabung segmen kependekan ke tetangganya.
function toSegments(labeled, totalDuration) {
  if (labeled.length === 0) return [];

  let segments = [];
  labeled.forEach((entry, i) => {
    const startTime = entry.time;
    const endTime = i + 1 < labeled.length ? labeled[i + 1].time : totalDuration;
    const last = segments[segments.length - 1];
    if (last && last.chord === entry.chord) {
      last.endTime = endTime;
    } else {
      segments.push({ chord: entry.chord, startTime, endTime });
    }
  });

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

  const final = [];
  segments.forEach((seg) => {
    const last = final[final.length - 1];
    if (last && last.chord === seg.chord) {
      last.endTime = seg.endTime;
    } else {
      final.push({ ...seg });
    }
  });

  return final;
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
      const essentia = await loadEssentia();

      const arrayBuffer = await selectedFile.arrayBuffer();
      const { audioData, sampleRate } = await decodeToMono(arrayBuffer);
      const totalDuration = audioData.length / sampleRate;

      const labeled = await extractChords(essentia, audioData, sampleRate, (p) => setProgress(p));
      const chordSegments = toSegments(labeled, totalDuration).filter((s) => s.chord !== "N.C." || labeled.length < 3);

      if (chordSegments.length === 0) {
        setErrorMsg("Chord nggak berhasil dikenali dari audio ini. Coba audio dengan aransemen chord yang lebih jelas.");
        setStatus("error");
        return;
      }

      setProgress(1);
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
                  <p className="text-xs text-[#8B8F98] mt-1">Menghitung chroma & mencocokkan chord...</p>
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
                        className={`shrink-0 flex flex-col items-center justify-center rounded-lg px-4 py-3 min-w-[64px] ${
                          s.chord === "N.C." ? "bg-white/[0.02]" : "bg-white/[0.04]"
                        }`}
                      >
                        <span className={`text-base font-bold ${s.chord === "N.C." ? "text-[#5A5D66]" : "text-[#3ECF8E]"}`}>
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
                  "N.C." artinya bagian hening/tanpa chord jelas.
                </p>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-[#4A4D54] mt-4 flex items-center justify-center gap-1.5">
          <Music2 className="w-3 h-3" />
          Ditenagai Essentia.js (MTG-UPF, port WASM dari library Essentia) — jalan 100% di browser
        </p>
      </div>
    </div>
  );
}
