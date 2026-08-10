/**
 * patterns
 * --------
 * Preset "pola" cara chord dimainin, diambil dari 2 contoh file .mid yang
 * dikasih user:
 *
 *  - CHORD.mid  -> tiap chord ditahan penuh 1 birama (whole note, block
 *                  chord kayak pad). Ini preset "sustain".
 *  - RYTHM.mid  -> tiap chord di-tap staccato di TIAP ketukan (4x per
 *                  birama kalau durasinya 4 beat), bukan ditahan panjang.
 *                  Dari data mid-nya: tiap hit nyala cuma 16 tick lalu mati,
 *                  gap 112 tick sebelum hit berikutnya -- 16+112 = 128 tick
 *                  = tepat 1 beat (ticks_per_beat file itu 128). Jadi tiap
 *                  hit itu staccato pendek (~1/8 beat) yang jatuh persis di
 *                  awal tiap ketukan. Ini preset "rhythm" / "Ritme".
 *
 * getChordHits() ngubah 1 chord slot (durationBeats) jadi daftar "hit"
 * (offset & panjang dalam beat) sesuai pola yang dipilih. Dipakai bareng
 * sama audioEngine (preview/playback) & midiWriter (export .mid) biar
 * hasil dengar & hasil file .mid konsisten.
 */

export const PATTERNS = {
  sustain: {
    label: "Sustain",
    short: "S",
    description: "Chord ditahan penuh sepanjang durasinya (block chord / pad).",
  },
  rhythm: {
    label: "Ritme",
    short: "R",
    description: "Chord di-tap staccato tiap ketukan (gaya comping/strum).",
  },
};

// Panjang tiap staccam hit di preset "rhythm", dalam satuan beat.
// (16 / 128 tick per beat = 0.125 beat, sesuai RYTHM.mid)
const RHYTHM_HIT_LENGTH_BEATS = 0.125;

/**
 * @param {number} durationBeats total durasi 1 chord slot (dalam beat)
 * @param {string} pattern "sustain" | "rhythm"
 * @returns {Array<{offsetBeats:number, lengthBeats:number}>}
 */
export function getChordHits(durationBeats, pattern) {
  if (pattern === "rhythm") {
    const beatCount = Math.max(1, Math.round(durationBeats));
    return Array.from({ length: beatCount }, (_, i) => ({
      offsetBeats: i,
      lengthBeats: Math.min(RHYTHM_HIT_LENGTH_BEATS, Math.max(0.05, durationBeats - i)),
    }));
  }
  return [{ offsetBeats: 0, lengthBeats: durationBeats }];
}
