# Deteksi Chord — 100% Client-Side

Upload lagu → dapat progresi chord (mayor/minor) sepanjang lagu.
**Tanpa backend. Tanpa server. Tanpa biaya hosting compute.**

Ditenagai oleh [Basic Pitch](https://github.com/spotify/basic-pitch) — model
open-source Spotify (Apache-2.0 License) yang jalan penuh di browser lewat
TensorFlow.js, buat deteksi nada-nada yang main bareng (polyphonic).
Nada-nada itu lalu dikelompokin per window waktu dan dicocokin ke pola
chord **mayor/minor** (chroma template matching) — output-nya progresi
chord kayak `C`, `Am`, `F`, `G`, dst.

> Sengaja cuma dikenalin mayor & minor (gak ada 7th/sus/dim/aug) biar
> hasilnya simpel dan gampang langsung dipakai buat main gitar/piano.

---

## Setup

### 1. Install dependency

Di root project (atau project React manapun):

```bash
npm install @spotify/basic-pitch
```

### 2. Copy model file ke folder `public/`

Model AI-nya (~900KB total) harus bisa diakses lewat URL statis, karena
di-load lewat `fetch` di browser, bukan bundling biasa via import.

```bash
mkdir -p public/basic-pitch-model
cp node_modules/@spotify/basic-pitch/model/model.json public/basic-pitch-model/
cp node_modules/@spotify/basic-pitch/model/*.bin public/basic-pitch-model/
```

Cek folder `public/basic-pitch-model/` harus ada 2 file:
- `model.json` (~175KB) — arsitektur model
- `group1-shard1of1.bin` (~742KB) — bobot/weights hasil training

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

Di dalam `ChordDetector.jsx`, ada beberapa konstanta yang bisa disesuaikan:

```js
const WINDOW_SIZE = 1.0;          // panjang tiap window analisis (detik)
const MIN_ENERGY = 0.12;          // minimum "energi" nada biar dianggap ada chord
const MIN_SEGMENT_DURATION = 0.75; // segmen lebih pendek dari ini digabung ke tetangga
```

**Kalau chord kerasa "kedip-kedip" / kecepetan gonta-ganti** → naikkan
`WINDOW_SIZE` (coba 1.5-2.0) atau `MIN_SEGMENT_DURATION`

**Kalau chord yang harusnya kedeteksi malah kelewat/gabung jadi satu** →
turunkan `WINDOW_SIZE` (coba 0.5-0.75)

**Kalau banyak muncul "N.C." (no chord) padahal ada musiknya** → turunkan
`MIN_ENERGY`

---

## Batasan yang perlu diketahui

- **Paling akurat buat aransemen yang jelas** (gitar/piano dengan chord
  yang jelas) — full band mix yang padat bisa bikin deteksi kurang presisi
  karena banyak nada saling tumpang tindih
- **Cuma mengenali mayor & minor** — chord kompleks (7th, sus, dim, aug,
  add9, dst) bakal dibulatkan ke mayor/minor terdekat
- **Drum/perkusi nggak ngaruh ke deteksi** — chord detection cuma
  ngeliat nada pitch, bukan ritme
- **Reverb berat bisa bikin bingung model** — rekaman kering (dry) lebih
  bersih hasilnya
- Proses ~5-15 detik buat lagu 3 menit di laptop biasa, tergantung device

---

## Referensi

- Model: https://github.com/spotify/basic-pitch (Apache-2.0)
- Package browser: https://github.com/spotify/basic-pitch-ts
- Demo resmi Spotify: https://basicpitch.spotify.com
