import * as Tone from "tone";

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
export async function previewChord(midiNotes, preset = "piano", durationSec = 1.1) {
  const s = await ensureSynth(preset);
  const freqs = midiNotes.map((n) => Tone.Frequency(n, "midi").toFrequency());
  s.triggerAttackRelease(freqs, durationSec);
}

/**
 * Mainin seluruh progresi berurutan sesuai BPM & durasi tiap chord.
 * onStep(index) dipanggil (approx, via setTimeout) tiap giliran chord baru mulai.
 * Return fungsi `stop()` buat batalin sisa jadwal + matiin suara yang lagi nyala.
 */
export async function playSequence(chords, bpm, preset = "piano", onStep, onDone) {
  const s = await ensureSynth(preset);
  const secondsPerBeat = 60 / bpm;
  const timers = [];
  let t = Tone.now() + 0.05;

  chords.forEach((chord, idx) => {
    const dur = chord.durationBeats * secondsPerBeat;
    const freqs = chord.notes.map((n) => Tone.Frequency(n, "midi").toFrequency());
    s.triggerAttackRelease(freqs, dur * 0.92, t);
    const delayMs = (t - Tone.now()) * 1000;
    timers.push(setTimeout(() => onStep?.(idx), Math.max(0, delayMs)));
    t += dur;
  });

  const totalMs = (t - Tone.now()) * 1000;
  timers.push(setTimeout(() => onDone?.(), Math.max(0, totalMs)));

  return () => {
    timers.forEach(clearTimeout);
    s.releaseAll();
  };
}
