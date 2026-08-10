import { useCallback, useEffect, useRef, useState } from "react";
import { X, Minus, Plus, Download, Trash2, Music, Play, Square, Volume2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  NATURAL_NOTES,
  SHARP_NOTES,
  QUALITIES,
  chordLabel,
  chordToMidiNotes,
  makeId,
} from "./chordUtils";
import { PATTERNS } from "./patterns";
import ChordDiagram from "./ChordDiagram";
import { downloadMidi } from "./midiWriter";
import { previewChord, playSequence } from "./audioEngine";
import "./chordBuilder.css";

const DEFAULT_DURATION = 4; // beats (1 birama di 4/4)

export default function ChordBuilder() {
  const [quality, setQuality] = useState("major");
  const [pattern, setPattern] = useState("sustain");
  const [patternMenuOpen, setPatternMenuOpen] = useState(false);
  const patternMenuRef = useRef(null);
  const [octave, setOctave] = useState(4);
  const [bpm, setBpm] = useState(120);
  const [bpmInput, setBpmInput] = useState("120");
  const [octaveInput, setOctaveInput] = useState("4");
  const [sequence, setSequence] = useState([]);
  const [songName, setSongName] = useState("");
  const [instrument, setInstrument] = useState("piano"); // "piano" | "synth"
  const [diagramView, setDiagramView] = useState("guitar"); // "guitar" | "piano"
  const [playingIndex, setPlayingIndex] = useState(null);
  const stopPlaybackRef = useRef(null);

  // Index chord yang lagi ditampilin di carousel diagram (bukan diagramView).
  // Beda dari playingIndex: activeDiagramIndex juga jalan sendiri (auto
  // bergantian) pas nggak ada playback, sedangkan playingIndex cuma keisi
  // pas tombol Play beneran ditekan.
  const [activeDiagramIndex, setActiveDiagramIndex] = useState(0);
  // Naik tiap kali user navigasi manual (panah/dot) -- dipakai buat "reset"
  // timer auto-advance biar nggak langsung ke-skip abis user baru aja klik.
  const [manualNavTick, setManualNavTick] = useState(0);

  // Klik kunci -> chord baru selalu ditambahin ke PALING BAWAH list (bukan di atas).
  const addChord = useCallback(
    (root, q) => {
      previewChord(chordToMidiNotes(root, q, octave), instrument, pattern);
      setSequence((prev) => [
        ...prev,
        { id: makeId(), root, quality: q, durationBeats: DEFAULT_DURATION, pattern },
      ]);
    },
    [octave, instrument, pattern]
  );

  const removeChord = (id) => {
    setSequence((prev) => prev.filter((c) => c.id !== id));
  };

  const moveChord = (index, dir) => {
    setSequence((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const changeDuration = (id, delta) => {
    setSequence((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, durationBeats: Math.min(16, Math.max(1, c.durationBeats + delta)) }
          : c
      )
    );
  };

  // BPM & Oktaf dibiarin ngetik bebas (string) dulu, baru di-clamp pas blur
  // -- kalau di-clamp tiap keystroke, ngetik "120" kepotong jadi "40" duluan
  // pas baru ngetik "1" karena langsung dipaksa ke nilai minimum.
  const handleBpmChange = (val) => {
    if (/^\d*$/.test(val)) setBpmInput(val);
  };

  const commitBpm = () => {
    const n = Math.min(300, Math.max(40, Number(bpmInput) || 120));
    setBpm(n);
    setBpmInput(String(n));
  };

  const handleOctaveChange = (val) => {
    if (/^\d*$/.test(val)) setOctaveInput(val);
  };

  const commitOctave = () => {
    const n = Math.min(6, Math.max(2, Number(octaveInput) || 4));
    setOctave(n);
    setOctaveInput(String(n));
  };

  const stopPlayback = useCallback(() => {
    stopPlaybackRef.current?.();
    stopPlaybackRef.current = null;
    setPlayingIndex(null);
  }, []);

  const clearAll = () => {
    stopPlayback();
    setSequence([]);
  };

  const handlePlaySequence = async () => {
    if (playingIndex !== null) {
      stopPlayback();
      return;
    }
    if (sequence.length === 0) return;
    const chords = sequence.map((c) => ({
      notes: chordToMidiNotes(c.root, c.quality, octave),
      durationBeats: c.durationBeats,
      pattern: c.pattern,
    }));
    const stop = await playSequence(chords, bpm, instrument, setPlayingIndex, stopPlayback);
    stopPlaybackRef.current = stop;
  };

  const handlePreviewChip = (c) => {
    previewChord(chordToMidiNotes(c.root, c.quality, octave), instrument, c.pattern);
  };

  // Matiin suara & timer kalau pindah tab / komponen unmount
  useEffect(() => stopPlayback, [stopPlayback]);

  // Jaga activeDiagramIndex tetap valid kalau chord dihapus/direset.
  useEffect(() => {
    setActiveDiagramIndex((i) => Math.min(i, Math.max(0, sequence.length - 1)));
  }, [sequence.length]);

  // Pas sequence lagi diputar (Play), carousel diagram IKUT chord yang
  // lagi bunyi -- slide ke kiri otomatis ngikutin progresi playback.
  useEffect(() => {
    if (playingIndex !== null) setActiveDiagramIndex(playingIndex);
  }, [playingIndex]);

  // Pas idle (nggak lagi playback), diagram tetap bergantian sendiri tiap
  // beberapa detik -- ini yang bikin view chord-nya "muncul gantian" biar
  // nggak diam kalau progresinya banyak & nggak keliatan semua sekaligus.
  useEffect(() => {
    if (playingIndex !== null || sequence.length < 2) return;
    const id = setInterval(() => {
      setActiveDiagramIndex((i) => (i + 1) % sequence.length);
    }, 2400);
    return () => clearInterval(id);
  }, [playingIndex, sequence.length, manualNavTick]);

  const goToDiagram = (idx) => {
    setActiveDiagramIndex(idx);
    setManualNavTick((t) => t + 1);
  };
  const prevDiagram = () =>
    goToDiagram((activeDiagramIndex - 1 + sequence.length) % sequence.length);
  const nextDiagram = () => goToDiagram((activeDiagramIndex + 1) % sequence.length);

  // Tutup dropdown pola kalau klik di luar dropdown-nya.
  useEffect(() => {
    if (!patternMenuOpen) return;
    const handleClickOutside = (e) => {
      if (patternMenuRef.current && !patternMenuRef.current.contains(e.target)) {
        setPatternMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [patternMenuOpen]);

  const handleDownload = () => {
    if (sequence.length === 0) return;
    const chords = sequence.map((c) => ({
      notes: chordToMidiNotes(c.root, c.quality, octave),
      durationBeats: c.durationBeats,
      pattern: c.pattern,
    }));
    const filename = songName.trim()
      ? `${songName.trim().replace(/\s+/g, "-").toLowerCase()}.mid`
      : "progresi-chord.mid";
    downloadMidi(chords, bpm, filename);
  };

  return (
    <div className="cb-page">
      <header className="cb-header">
        <div className="cb-eyebrow">
          <Music size={14} strokeWidth={2.5} />
          <span>Manual Chord Builder</span>
        </div>
        <h1 className="cb-h1">Susun progresi, download .midi</h1>
        <p className="cb-lead">
          Klik kunci buat nambahin ke progresi &mdash; tiap chord baru masuk ke
          paling bawah list. Nggak ada AI, nggak ada server, murni disusun manual.
        </p>
      </header>

      <section className="cb-panel">
        <div className="cb-panel-head">
          <h2 className="cb-h2">Pilih kunci</h2>
          <div className="cb-panel-head-controls">
            <div className="cb-quality-toggle" role="group" aria-label="Suara preview">
              {["piano", "synth"].map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`cb-quality-btn cb-instrument-${name} ${instrument === name ? "is-active" : ""}`}
                  onClick={() => setInstrument(name)}
                >
                  {name === "piano" ? "Piano" : "Synth"}
                </button>
              ))}
            </div>
            <div className="cb-inline-group">
              <div className="cb-quality-toggle" role="group" aria-label="Jenis chord">
                {Object.entries(QUALITIES).map(([key, q]) => (
                  <button
                    key={key}
                    type="button"
                    className={`cb-quality-btn cb-quality-${key} ${quality === key ? "is-active" : ""}`}
                    onClick={() => setQuality(key)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <div className="cb-pattern-dropdown" ref={patternMenuRef}>
                <button
                  type="button"
                  className="cb-pattern-select"
                  onClick={() => setPatternMenuOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={patternMenuOpen}
                  title={PATTERNS[pattern]?.description}
                >
                  <span>{PATTERNS[pattern]?.label}</span>
                  <ChevronDown size={14} className={`cb-pattern-caret ${patternMenuOpen ? "is-open" : ""}`} />
                </button>
                {patternMenuOpen && (
                  <div className="cb-pattern-menu" role="listbox">
                    {Object.entries(PATTERNS).map(([key, p]) => (
                      <button
                        key={key}
                        type="button"
                        role="option"
                        aria-selected={pattern === key}
                        className={`cb-pattern-option ${pattern === key ? "is-active" : ""}`}
                        onClick={() => {
                          setPattern(key);
                          setPatternMenuOpen(false);
                        }}
                      >
                        <span className="cb-pattern-option-label">{p.label}</span>
                        <span className="cb-pattern-option-desc">{p.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="cb-piano" aria-label="Piano kunci">
          {NATURAL_NOTES.map((note, i) => (
            <div className="cb-piano-slot" key={note}>
              <button
                type="button"
                className={`cb-key cb-key-white cb-key-${quality}`}
                onClick={() => addChord(note, quality)}
              >
                <span className="cb-key-label">{chordLabel(note, quality)}</span>
              </button>
              {SHARP_NOTES[i] && (
                <button
                  type="button"
                  className={`cb-key cb-key-black cb-key-${quality}`}
                  onClick={() => addChord(SHARP_NOTES[i], quality)}
                >
                  <span className="cb-key-label">{chordLabel(SHARP_NOTES[i], quality)}</span>
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="cb-hint">Klik kunci buat nambah chord ke paling bawah progresi</p>
      </section>

      <section className="cb-panel">
        <div className="cb-panel-head">
          <h2 className="cb-h2">Progresi kamu</h2>
          <div className="cb-panel-head-controls">
            <button
              type="button"
              className={`cb-btn cb-btn-secondary cb-btn-sm ${playingIndex !== null ? "is-playing" : ""}`}
              onClick={handlePlaySequence}
              disabled={sequence.length === 0}
            >
              {playingIndex !== null ? <Square size={14} /> : <Play size={14} />}
              {playingIndex !== null ? "Stop" : "Play"}
            </button>
            <button type="button" className="cb-btn cb-btn-secondary cb-btn-sm" onClick={clearAll} disabled={sequence.length === 0}>
              <Trash2 size={14} />
              Bersihin
            </button>
          </div>
        </div>

        <div className="cb-sequence">
          {sequence.length === 0 && (
            <div className="cb-empty">Belum ada chord. Klik kunci di atas buat mulai nyusun.</div>
          )}
          {sequence.map((c, idx) => (
            <div
              key={c.id}
              className={`cb-chip cb-chip-${c.quality} ${playingIndex === idx ? "is-playing" : ""}`}
            >
              <span className="cb-chip-order">{idx + 1}</span>
              <button
                type="button"
                className="cb-chip-preview"
                onClick={() => handlePreviewChip(c)}
                aria-label="Preview suara chord ini"
              >
                <Volume2 size={13} />
              </button>
              <span className="cb-chip-label">{chordLabel(c.root, c.quality)}</span>
              <span className="cb-chip-pattern" title={PATTERNS[c.pattern]?.description}>
                {PATTERNS[c.pattern]?.short ?? "S"}
              </span>
              <div className="cb-chip-duration">
                <button type="button" onClick={() => changeDuration(c.id, -1)} aria-label="Kurangi durasi">
                  <Minus size={12} />
                </button>
                <span>{c.durationBeats}</span>
                <button type="button" onClick={() => changeDuration(c.id, 1)} aria-label="Tambah durasi">
                  <Plus size={12} />
                </button>
              </div>
              <div className="cb-chip-move">
                <button type="button" onClick={() => moveChord(idx, -1)} disabled={idx === 0} aria-label="Pindah ke atas">
                  <ChevronUp size={14} />
                </button>
                <button type="button" onClick={() => moveChord(idx, 1)} disabled={idx === sequence.length - 1} aria-label="Pindah ke bawah">
                  <ChevronDown size={14} />
                </button>
              </div>
              <button type="button" className="cb-chip-remove" onClick={() => removeChord(c.id)} aria-label="Hapus chord">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="cb-panel">
        <div className="cb-panel-head">
          <h2 className="cb-h2">Diagram chord</h2>
          <div className="cb-quality-toggle" role="group" aria-label="Tampilan diagram">
            {[
              { key: "guitar", label: "Gitar" },
              { key: "piano", label: "Piano" },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`cb-quality-btn ${diagramView === opt.key ? "is-active" : ""}`}
                onClick={() => setDiagramView(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {sequence.length === 0 ? (
          <div className="cb-empty">Diagram bakal nongol di sini abis kamu nambah chord.</div>
        ) : (
          <>
            <div className="cb-diagram-carousel">
              <button
                type="button"
                className="cb-diagram-nav"
                onClick={prevDiagram}
                disabled={sequence.length < 2}
                aria-label="Chord sebelumnya"
              >
                <ChevronLeft size={16} />
              </button>

              <div className="cb-diagram-viewport">
                <div
                  className="cb-diagram-track"
                  style={{ transform: `translateX(-${activeDiagramIndex * 100}%)` }}
                >
                  {sequence.map((c, idx) => (
                    <div
                      key={c.id}
                      className={`cb-diagram-slide ${playingIndex === idx ? "is-playing" : ""}`}
                    >
                      <span className="cb-diagram-slide-index">
                        {idx + 1} / {sequence.length}
                      </span>
                      <ChordDiagram root={c.root} quality={c.quality} view={diagramView} />
                      <span className="cb-diagram-card-label">{chordLabel(c.root, c.quality)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                className="cb-diagram-nav"
                onClick={nextDiagram}
                disabled={sequence.length < 2}
                aria-label="Chord berikutnya"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {sequence.length > 1 && (
              <div className="cb-diagram-dots" role="tablist" aria-label="Pilih chord">
                {sequence.map((c, idx) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={activeDiagramIndex === idx}
                    aria-label={`Lihat diagram chord ${chordLabel(c.root, c.quality)}`}
                    className={`cb-diagram-dot-btn ${activeDiagramIndex === idx ? "is-active" : ""}`}
                    onClick={() => goToDiagram(idx)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="cb-panel cb-export">
        <div className="cb-export-fields">
          <label className="cb-field">
            <span className="cb-field-label">Nama file</span>
            <input
              type="text"
              className="cb-input"
              placeholder="progresi-chord"
              value={songName}
              onChange={(e) => setSongName(e.target.value)}
            />
          </label>
          <label className="cb-field">
            <span className="cb-field-label">Tempo (BPM)</span>
            <input
              type="number"
              className="cb-input cb-input-num"
              min={40}
              max={300}
              value={bpmInput}
              onChange={(e) => handleBpmChange(e.target.value)}
              onBlur={commitBpm}
            />
          </label>
          <label className="cb-field">
            <span className="cb-field-label">Oktaf</span>
            <input
              type="number"
              className="cb-input cb-input-num"
              min={2}
              max={6}
              value={octaveInput}
              onChange={(e) => handleOctaveChange(e.target.value)}
              onBlur={commitOctave}
            />
          </label>
        </div>
        <button type="button" className="cb-btn cb-btn-primary" onClick={handleDownload} disabled={sequence.length === 0}>
          <Download size={16} />
          Download .midi
        </button>
      </section>
    </div>
  );
}
