/**
 * chordDiagram
 * ------------
 * Ngitung data buat gambar diagram chord -- gitar (fretboard) & piano
 * (keyboard) -- murni dari root + quality, TANPA lookup tabel manual per
 * chord (yang ribuan barisnya kalau mau nyakup 12 root x major/minor).
 *
 * GITAR: pake rumus "movable barre chord" bentuk-E (root di senar low-E).
 * Bentuk open E major (022100) & open E minor (022000) digeser sepanjang
 * neck sesuai jarak semitone root-nya dari E -- ini valid krn bentuk barre
 * emang "geser" doang, hasilnya otomatis benar buat root manapun.
 *
 * PIANO: highlight tuts satu oktaf (C..B) sesuai interval quality-nya
 * (root, third, fifth), match ke nama not-nya langsung.
 */

import { NOTE_NAMES, QUALITIES } from "./chordUtils";

// Urutan senar dari kiri (low E) ke kanan (high e), sesuai cara gambar
// diagram chord gitar standar.
const STRING_COUNT = 6;

/**
 * @param {string} root  nama not root, misal "A", "C#"
 * @param {string} quality "major" | "minor"
 * @returns {{
 *   baseFret: number,        // 0 = posisi open (nut kepake)
 *   strings: Array<{ fret: number, finger: number|null }>, // low E -> high e
 *   label: string,
 * }}
 */
export function getGuitarShape(root, quality) {
  const rootIndex = NOTE_NAMES.indexOf(root);
  const eIndex = NOTE_NAMES.indexOf("E");
  const baseFret = (rootIndex - eIndex + 12) % 12; // 0..11

  // Offset fret tiap senar RELATIF ke baseFret, urutan: E A D G B e
  const offsets = quality === "minor" ? [0, 2, 2, 0, 0, 0] : [0, 2, 2, 1, 0, 0];

  let fingers;
  if (baseFret === 0) {
    // Posisi open (chord E asli) -- fingering standar yang biasa diajarin.
    fingers =
      quality === "minor"
        ? [null, 2, 3, null, null, null] // Em: A=2, D=3
        : [null, 2, 3, 1, null, null]; // E: A=2, D=3, G=1
  } else {
    // Barre: telunjuk (1) nge-barre semua senar, sisanya jari 3 & 4.
    fingers =
      quality === "minor"
        ? [1, 3, 4, 1, 1, 1]
        : [1, 3, 4, 2, 1, 1];
  }

  const strings = Array.from({ length: STRING_COUNT }, (_, i) => ({
    fret: baseFret + offsets[i],
    finger: fingers[i],
  }));

  return {
    baseFret,
    strings,
    label: `${root}${QUALITIES[quality].suffix}`,
  };
}

// Layout 1 oktaf piano (C..B): urutan tuts putih & posisi tuts hitam
// (nggak ada hitam setelah E & setelah B).
export const PIANO_OCTAVE_WHITE = ["C", "D", "E", "F", "G", "A", "B"];
export const PIANO_OCTAVE_BLACK = ["C#", "D#", null, "F#", "G#", "A#", null];

/**
 * @param {string} root
 * @param {string} quality
 * @returns {{ highlighted: Set<string>, rootNote: string, label: string }}
 *   highlighted isinya nama not (tanpa oktaf) yang perlu di-highlight di
 *   keyboard 1 oktaf tetap (C..B).
 */
export function getPianoHighlight(root, quality) {
  const rootIndex = NOTE_NAMES.indexOf(root);
  const intervals = QUALITIES[quality].interval;
  const highlighted = new Set(
    intervals.map((iv) => NOTE_NAMES[(rootIndex + iv) % 12])
  );
  return {
    highlighted,
    rootNote: root,
    label: `${root}${QUALITIES[quality].suffix}`,
  };
}
