---
title: Chord Analysis API
emoji: 🎼
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# Chord Analysis API

Backend deteksi chord: HPSS → beat-synced chroma CQT → template matching
(major/minor/dominant7) → Viterbi smoothing.

## Endpoint

`POST /analyze` — kirim file audio (`multipart/form-data`, field name `file`).

Response:

```json
{
  "duration": 245.3,
  "tempo": 118.4,
  "chords": [
    { "time": 0.51, "chord": "C" },
    { "time": 4.53, "chord": "G" }
  ]
}
```

Chord "N" artinya diam / gak ada nada jelas terdeteksi di titik itu.
