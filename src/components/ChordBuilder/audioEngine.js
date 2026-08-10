import * as Tone from "tone";
import { getChordHits } from "./patterns";

/**
 * audioEngine
 * -----------
 * Preview suara buat chord builder, murni synth (osilator + envelope) via
 * Tone.js -- bukan sample piano beneran (biar nggak ada file audio gede yang
 * perlu didownload), tapi cukup buat "denger" progresi pas nyusun.
 *
 * 2 preset:
 *  - piano: gelombang triangle, attack cepat & decay pendek -> kesan "plink"
 *           kayak piano/keys
 *  - synth: gelombang sawtooth, attack & release lebih panjang -> kesan pad
 */
const PRESETS = {
  piano: {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.004, decay: 0.35, sustain: 0.05, release: 0.6 },
  },
  synth: {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.02, decay: 0.2, sustain: 0.35, release: 1.4 },
  },
};

let synth = null;
let currentPreset = null;
let started = false;

async function ensureSynth(preset) {
  if (!started) {
    await Tone.start();
    started = true;
  }
  if (!synth || currentPreset !== preset) {
    if (synth) synth.dispose();
    synth = new Tone.PolySynth(Tone.Synth, PRESETS[preset]).toDestination();
    synth.volume.value = -8;
    currentPreset = preset;
  }
  return synth;
}

/** Preview satu chord (dipanggil pas tap/drop kunci, atau tombol play per-chip). */
export async function previewChord(midiNotes, preset = "piano", pattern = "sustain", durationSec = 1.1) {
  const s = await ensureSynth(preset);
  const freqs = midiNotes.map((n) => Tone.Frequency(n, "midi").toFrequency());
  if (pattern === "rhythm") {
    // Preview pola ritme: mainin 2 hit staccato singkat biar kerasa "gaya"-nya
    // tanpa nunggu lama tiap klik kunci.
    s.triggerAttackRelease(freqs, 0.12);
    setTimeout(() => s.triggerAttackRelease(freqs, 0.12), 220);
    return;
  }
  s.triggerAttackRelease(freqs, durationSec);
}

/**
 * Mainin seluruh progresi berurutan sesuai BPM & durasi tiap chord.
 * onStep(index) dipanggil tiap giliran chord baru mulai.
 * Return fungsi `stop()` buat batalin sisa jadwal + matiin suara yang lagi nyala.
 *
 * PENTING: chord2 berikutnya JANGAN langsung dijadwalin semua ke Tone.js
 * pakai waktu depan (s.triggerAttackRelease(freqs, dur, futureTime)) --
 * begitu dipanggil, Web Audio API udah "mengunci" not itu buat bunyi
 * nanti, dan releaseAll() pas stop nggak bisa membatalkan not yang
 * belum sempat mulai. Makanya walau timer di-clear, chord berikutnya
 * tetep kebunyi sendiri. Solusinya: tiap chord baru di-trigger dari
 * dalem callback setTimeout (waktu "sekarang", bukan waktu depan), jadi
 * begitu di-stop, chord yang belum gilirannya emang belum pernah
 * dijadwalin ke audio engine sama sekali.
 *
 * Tiap chord slot juga dipecah jadi beberapa "hit" sesuai pola
 * (sustain = 1 hit panjang, rhythm = beberapa hit staccato tiap ketukan),
 * lihat patterns.js.
 */
export async function playSequence(chords, bpm, preset = "piano", onStep, onDone) {
  const s = await ensureSynth(preset);
  const secondsPerBeat = 60 / bpm;
  const timers = [];
  let stopped = false;
  let elapsedMs = 0;

  chords.forEach((chord, idx) => {
    const chordStartMs = elapsedMs;
    const durMs = chord.durationBeats * secondsPerBeat * 1000;
    const hits = getChordHits(chord.durationBeats, chord.pattern);
    const freqs = chord.notes.map((n) => Tone.Frequency(n, "midi").toFrequency());

    hits.forEach((hit) => {
      const hitDelayMs = chordStartMs + hit.offsetBeats * secondsPerBeat * 1000;
      const hitLenSec = hit.lengthBeats * secondsPerBeat * 0.9;
      timers.push(
        setTimeout(() => {
          if (stopped) return;
          s.triggerAttackRelease(freqs, hitLenSec);
        }, hitDelayMs)
      );
    });

    timers.push(
      setTimeout(() => {
        if (!stopped) onStep?.(idx);
      }, chordStartMs)
    );

    elapsedMs += durMs;
  });

  timers.push(
    setTimeout(() => {
      if (!stopped) onDone?.();
    }, elapsedMs)
  );

  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
    // Matiin semua not yang lagi nyala saat ini juga.
    s.releaseAll();
  };
}
