"""
Chord Analysis API
------------------
Endpoint tunggal: POST /analyze, terima file audio, balikin daftar chord
dengan timestamp-nya.

Alur pemrosesan (semua fungsi librosa ini publik/generic, bukan punya
proyek siapa pun):

  1. Load & resample audio ke mono
  2. HPSS -> pisahin komponen harmonik (nada) dari perkusif (drum/hentakan),
     supaya chroma yang diambil nanti gak keganggu drum
  3. Beat tracking dari komponen perkusif -> dapet ketukan lagu
  4. Chroma CQT dari komponen harmonik, lalu disinkronkan per-ketukan
     (median tiap beat), jadi satu "snapshot nada" per ketukan
  5. Cocokin setiap snapshot ke template chord (major/minor/dominant7)
     pakai cosine similarity
  6. Viterbi decoding -> pilih urutan chord paling mulus sepanjang lagu
     (gak lompat-lompat cuma karena satu ketukan noise)
"""

import os
import tempfile

import numpy as np
import librosa
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="Chord Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAX_SECONDS = 240  # batas durasi biar gak timeout di free-tier CPU Space


def _make_templates():
    """Bangun template chroma buat major, minor, dan dominant-7.
    Bobot interval dibedain (root paling kuat, lalu fifth, lalu third)
    supaya lebih tahan noise ketimbang template biner rata 1/0/1."""
    names, vectors = [], []
    for i, root in enumerate(NOTES):
        maj = np.zeros(12)
        maj[i] = 1.0
        maj[(i + 4) % 12] = 0.75   # major third
        maj[(i + 7) % 12] = 0.85   # perfect fifth
        names.append(root)
        vectors.append(maj / np.linalg.norm(maj))

        minr = np.zeros(12)
        minr[i] = 1.0
        minr[(i + 3) % 12] = 0.75  # minor third
        minr[(i + 7) % 12] = 0.85  # perfect fifth
        names.append(root + "m")
        vectors.append(minr / np.linalg.norm(minr))

        dom7 = np.zeros(12)
        dom7[i] = 1.0
        dom7[(i + 4) % 12] = 0.65
        dom7[(i + 7) % 12] = 0.7
        dom7[(i + 10) % 12] = 0.55  # minor seventh
        names.append(root + "7")
        vectors.append(dom7 / np.linalg.norm(dom7))

    names.append("N")  # state "diam / gak jelas"
    vectors.append(np.zeros(12))
    return names, np.array(vectors)


CHORD_NAMES, TEMPLATE_MATRIX = _make_templates()
N_STATES = len(CHORD_NAMES)
SILENCE_STATE = N_STATES - 1


def _viterbi(emission_scores, self_stay=0.93):
    """Decode path chord paling mungkin sepanjang lagu. emission_scores:
    array [T, N_STATES] berisi skor mentah (cosine sim / heuristic) per
    state per frame. Ini implementasi Viterbi standar (Viterbi, 1967)."""
    T, n = emission_scores.shape
    sharp = 9.0
    exp_scores = np.exp(emission_scores * sharp)
    emission = exp_scores / exp_scores.sum(axis=1, keepdims=True)
    log_em = np.log(emission + 1e-12)

    off = (1 - self_stay) / (n - 1)
    trans = np.full((n, n), off)
    np.fill_diagonal(trans, self_stay)
    log_tr = np.log(trans)

    dp = np.empty((T, n))
    ptr = np.zeros((T, n), dtype=int)
    dp[0] = log_em[0]
    for t in range(1, T):
        cand = dp[t - 1][:, None] + log_tr
        ptr[t] = np.argmax(cand, axis=0)
        dp[t] = cand[ptr[t], np.arange(n)] + log_em[t]

    path = np.empty(T, dtype=int)
    path[-1] = int(np.argmax(dp[-1]))
    for t in range(T - 2, -1, -1):
        path[t] = ptr[t + 1, path[t + 1]]
    return path


def analyze(file_path: str, self_stay: float = 0.93):
    y, sr = librosa.load(file_path, sr=22050, mono=True, duration=MAX_SECONDS)
    duration = float(librosa.get_duration(y=y, sr=sr))

    y_harmonic, y_percussive = librosa.effects.hpss(y)

    tempo, beat_frames = librosa.beat.beat_track(y=y_percussive, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0]) if np.size(tempo) else 0.0

    chroma = librosa.feature.chroma_cqt(y=y_harmonic, sr=sr)

    if len(beat_frames) >= 2:
        chroma_sync = librosa.util.sync(chroma, beat_frames, aggregate=np.median)
        frame_times = librosa.frames_to_time(beat_frames, sr=sr)
    else:
        # fallback: gak ketemu beat yang jelas -> pakai grid waktu tetap
        hop_frames = int(0.5 * sr / 512)
        idx = np.arange(0, chroma.shape[1], max(1, hop_frames))
        chroma_sync = chroma[:, idx]
        frame_times = librosa.frames_to_time(idx, sr=sr)

    if chroma_sync.shape[1] == 0:
        return [], duration, tempo

    norm = np.linalg.norm(chroma_sync, axis=0, keepdims=True)
    norm[norm == 0] = 1
    chroma_norm = (chroma_sync / norm).T  # [T, 12]

    scores = chroma_norm @ TEMPLATE_MATRIX.T  # [T, N_STATES] cosine-ish sim

    # heuristic silence score: tinggi kalau energi frame rendah
    rms_energy = librosa.feature.rms(y=y_harmonic + y_percussive)[0]
    rms_at_beats = np.interp(
        frame_times, librosa.frames_to_time(np.arange(len(rms_energy)), sr=sr), rms_energy
    )
    thresh = max(np.median(rms_at_beats) * 0.2, 1e-4)
    scores[:, SILENCE_STATE] = (1 - rms_at_beats / thresh) * 1.4

    path = _viterbi(scores, self_stay=self_stay)

    results = []
    for i, state in enumerate(path):
        name = CHORD_NAMES[state]
        t = float(frame_times[i]) if i < len(frame_times) else duration
        if results and results[-1]["chord"] == name:
            continue
        results.append({"time": round(t, 3), "chord": name})

    return results, duration, tempo


@app.get("/")
def root():
    return {"status": "ok", "message": "POST audio (multipart, field 'file') ke /analyze"}


@app.post("/analyze")
async def analyze_endpoint(file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename or "")[1] or ".mp3"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        chords, duration, tempo = analyze(tmp_path)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=500, content={"error": str(exc)})
    finally:
        os.remove(tmp_path)

    return JSONResponse({"duration": duration, "tempo": tempo, "chords": chords})
