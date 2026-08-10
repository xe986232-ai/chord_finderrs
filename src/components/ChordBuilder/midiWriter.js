/**
 * midiWriter
 * ----------
 * Encoder Standard MIDI File (SMF) format 0 minimal, ditulis manual byte-by-byte.
 * Sengaja nggak pake library eksternal (midi-writer-js dkk) biar nol dependency
 * tambahan -- cukup buat kebutuhan "progresi chord -> .mid" doang.
 *
 * Referensi format: header chunk "MThd" + satu track chunk "MTrk" isinya
 * event note-on/note-off + tempo meta event, di-encode pake delta-time
 * variable-length quantity (VLQ) sesuai spek MIDI 1.0.
 */

import { getChordHits } from "./patterns";

const TICKS_PER_BEAT = 480;

function writeVarLen(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  // eslint-disable-next-line no-cond-assign
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }
  return bytes;
}

function u32(n) {
  return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function u16(n) {
  return [(n >> 8) & 0xff, n & 0xff];
}

function stringBytes(str) {
  return Array.from(str).map((c) => c.charCodeAt(0));
}

/**
 * @param {Array<{notes:number[], durationBeats:number, pattern?:string}>} chords
 *   urutan chord, tiap elemen berisi daftar nomor MIDI note, durasinya dalam
 *   satuan beat (ketukan), dan pola pemutarannya ("sustain" default | "rhythm").
 * @param {number} bpm tempo lagu.
 * @returns {Uint8Array} isi file .mid siap didownload.
 */
export function buildMidiFile(chords, bpm = 120) {
  // 1) Kumpulin semua event (note-on / note-off) dengan waktu absolut (dalam tick).
  const events = [];
  let cursorTicks = 0;

  for (const chord of chords) {
    const hits = getChordHits(chord.durationBeats, chord.pattern);
    for (const hit of hits) {
      const onTick = Math.round(cursorTicks + hit.offsetBeats * TICKS_PER_BEAT);
      const offTick = Math.round(onTick + hit.lengthBeats * TICKS_PER_BEAT);
      for (const note of chord.notes) {
        events.push({ time: onTick, type: "on", note });
      }
      for (const note of chord.notes) {
        events.push({ time: offTick, type: "off", note });
      }
    }
    cursorTicks += Math.round(chord.durationBeats * TICKS_PER_BEAT);
  }

  // Urutin berdasarkan waktu; kalau waktu sama, note-off duluan baru note-on
  // (biar re-trigger note yang sama di chord berurutan gak "nabrak").
  events.sort((a, b) => a.time - b.time || (a.type === "off" ? -1 : 1));

  // 2) Encode jadi byte track: tempo meta event dulu, baru semua note event.
  const trackBytes = [];

  // Tempo meta event: FF 51 03 + microseconds per quarter note (24-bit)
  const microsPerBeat = Math.round(60000000 / bpm);
  trackBytes.push(...writeVarLen(0), 0xff, 0x51, 0x03,
    (microsPerBeat >> 16) & 0xff, (microsPerBeat >> 8) & 0xff, microsPerBeat & 0xff);

  let lastTime = 0;
  const VELOCITY = 96;
  for (const ev of events) {
    const delta = ev.time - lastTime;
    lastTime = ev.time;
    trackBytes.push(...writeVarLen(delta));
    if (ev.type === "on") {
      trackBytes.push(0x90, ev.note, VELOCITY); // Note On, channel 0
    } else {
      trackBytes.push(0x80, ev.note, 0x40); // Note Off, channel 0
    }
  }

  // End of track meta event
  trackBytes.push(...writeVarLen(0), 0xff, 0x2f, 0x00);

  // 3) Susun chunk header + track.
  const headerChunk = [
    ...stringBytes("MThd"),
    ...u32(6),
    ...u16(0), // format 0 (single track)
    ...u16(1), // 1 track
    ...u16(TICKS_PER_BEAT),
  ];

  const trackChunk = [
    ...stringBytes("MTrk"),
    ...u32(trackBytes.length),
    ...trackBytes,
  ];

  return new Uint8Array([...headerChunk, ...trackChunk]);
}

/** Trigger download file .mid langsung dari browser, tanpa server. */
export function downloadMidi(chords, bpm, filename = "progresi-chord.mid") {
  const bytes = buildMidiFile(chords, bpm);
  const blob = new Blob([bytes], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
