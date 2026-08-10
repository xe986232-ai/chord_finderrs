/**
 * chordUtils
 * ----------
 * Mapping nada (root note) + quality (major/minor) -> nomor MIDI note.
 * Dipakai buat nyusun progresi chord manual yang nanti di-render jadi file .midi.
 */

// 12 nada kromatik, index-nya = jarak semitone dari C.
export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

// Susunan piano: nada natural (white key) & nada sharp (black key), lengkap
// sama posisi celahnya (nggak ada black key setelah E dan setelah B).
export const NATURAL_NOTES = ["C", "D", "E", "F", "G", "A", "B"];
export const SHARP_NOTES = ["C#", "D#", null, "F#", "G#", "A#", null];

export const QUALITIES = {
  major: { label: "Major", interval: [0, 4, 7], suffix: "" },
  minor: { label: "Minor", interval: [0, 3, 7], suffix: "m" },
};

/** Nama chord buat ditampilkan, misal "C#" + "minor" -> "C#m" */
export function chordLabel(root, quality) {
  return `${root}${QUALITIES[quality].suffix}`;
}

/**
 * Bangun array nomor MIDI note buat satu chord.
 * octave 4 -> "C4" = MIDI 60 (konvensi umum: (octave+1)*12 + semitone).
 */
export function chordToMidiNotes(root, quality, octave = 4) {
  const rootIndex = NOTE_NAMES.indexOf(root);
  if (rootIndex === -1) return [];
  const rootMidi = (octave + 1) * 12 + rootIndex;
  return QUALITIES[quality].interval.map((iv) => rootMidi + iv);
}

/** Bikin id unik ringan buat key React & drag tracking. */
export function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
