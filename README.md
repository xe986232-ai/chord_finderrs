# Deteksi Chord — 100% Client-Side (Essentia.js)

Upload lagu → dapat progresi chord (mayor/minor) sepanjang lagu.
**Tanpa backend. Tanpa server. Tanpa biaya hosting compute.**

Ditenagai oleh [Essentia.js](https://github.com/MTG/essentia.js) — port
WebAssembly dari library MIR (Music Information Retrieval) **Essentia**
buatan Music Technology Group, UPF Barcelona. Ini bukan model transkripsi
melodi yang "diakalin" buat nebak chord — ini algoritma yang memang
dirancang buat chord recognition:

1. **HPCP** (Harmonic Pitch Class Profile) — hitung chroma feature langsung
   dari spektrum audio tiap frame, tahan terhadap harmonik/overtone
2. **ChordsDetection** — cocokkan tiap window waktu ke triad **mayor/minor**
   terdekat, output progresi chord kayak `C`, `Am`, `F`, `G`, dst.

> Versi sebelumnya sempat pakai Basic Pitch (model transkripsi melodi
> Spotify) yang dipaksa buat nebak chord dari kumpulan not — hasilnya
> nggak akurat karena model itu memang bukan buat itu. Sekarang full
> ganti ke pipeline MIR yang proper.

---

## Setup

### 1. Install dependency

```bash
npm install essentia.js
```

### 2. Copy file WASM ke folder `public/`

Essentia.js WAJIB di-load lewat `<script>` tag runtime (bukan bundling
langsung lewat `import`), karena ini cara yang direkomendasikan resmi
buat modul WASM-nya di browser (menghindari masalah bundler dengan
Emscripten output).

```bash
mkdir -p public/essentia
cp node_modules/essentia.js/dist/essentia-wasm.web.js public/essentia/
cp node_modules/essentia.js/dist/essentia-wasm.web.wasm public/essentia/
cp node_modules/essentia.js/dist/essentia.js-core.js public/essentia/
```

Cek folder `public/essentia/` harus ada 3 file:
- `essentia-wasm.web.js` (~220KB) — loader WASM
- `essentia-wasm.web.wasm` (~1.9MB) — binary WASM Essentia
- `essentia.js-core.js` (~340KB) — JS API wrapper

### 3. Copy komponen ke project

Copy `src/components/ChordDetector.jsx` ke folder `src/components/`
project lu.

### 4. Import dan render

```tsx
import ChordDetector from "./components/ChordDetector";

function App() {
  return <ChordDetector />;
}
```

### 5. Jalankan

```bash
npm run dev
```

Buka browser, drop file MP3/WAV, tunggu progress bar selesai, lihat
progresi chord-nya, klik **Download chord chart (.txt)** kalau mau simpan.

---

## Tuning akurasi (opsional)

Di dalam `ChordDetector.jsx`:

```js
const FRAME_SIZE = 4096;        // ukuran frame analisis spektrum
const HOP_SIZE = 2048;          // jarak antar frame
const CHORD_WINDOW_SIZE = 2;    // detik, smoothing internal ChordsDetection
const MIN_SEGMENT_DURATION = 0.75; // segmen lebih pendek dari ini digabung ke tetangga
const SILENCE_RMS_RATIO = 0.06; // ambang batas hening relatif ke RMS maksimum lagu
```

**Kalau chord kerasa "kedip-kedip" / kecepetan gonta-ganti** → naikkan
`CHORD_WINDOW_SIZE` (coba 3-4) atau `MIN_SEGMENT_DURATION`

**Kalau banyak muncul "N.C." padahal ada musiknya** → turunkan
`SILENCE_RMS_RATIO`

---

## Batasan yang perlu diketahui

- **Paling akurat buat aransemen yang jelas** (gitar/piano dengan chord
  yang jelas) — full band mix yang padat tetap bisa lebih menantang karena
  banyak instrumen tumpang tindih di frekuensi yang sama
- **Cuma mengenali mayor & minor** — chord kompleks (7th, sus, dim, aug,
  add9, dst) bakal dibulatkan ke mayor/minor terdekat (ini keputusan
  desain, bukan limitasi algoritma — HPCP + ChordsDetection sebenarnya
  bisa dikembangkan buat chord lebih kompleks kalau nanti dibutuhkan)
- Proses per-frame lumayan banyak kalkulasi WASM, tapi tetap jalan
  dalam hitungan detik untuk lagu 3-4 menit di device modern

---

## Referensi

- Library: https://github.com/MTG/essentia.js
- Dokumentasi algoritma HPCP: https://essentia.upf.edu/reference/std_HPCP.html
- Dokumentasi algoritma ChordsDetection: https://essentia.upf.edu/reference/std_ChordsDetection.html
- Tutorial chord estimation (Python, konsepnya sama): https://essentia.upf.edu/tutorial_tonal_chords.html
