import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, X, Minus, Plus, Download, Trash2, Music, Play, Square, Volume2 } from "lucide-react";
import {
  NATURAL_NOTES,
  SHARP_NOTES,
  QUALITIES,
  chordLabel,
  chordToMidiNotes,
  makeId,
} from "./chordUtils";
import { downloadMidi } from "./midiWriter";
import { previewChord, playSequence } from "./audioEngine";
import "./chordBuilder.css";

const DRAG_THRESHOLD = 6; // px -- di bawah ini dianggap tap, bukan drag
const DEFAULT_DURATION = 4; // beats (1 birama di 4/4)

/** Hitung index penyisipan berdasarkan posisi X pointer terhadap chip yang ada. */
function resolveDropIndex(container, clientX) {
  if (!container) return 0;
  const chips = Array.from(container.querySelectorAll("[data-chip]"));
  for (let i = 0; i < chips.length; i++) {
    const rect = chips[i].getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return i;
  }
  return chips.length;
}

export default function ChordBuilder() {
  const [quality, setQuality] = useState("major");
  const [octave, setOctave] = useState(4);
  const [bpm, setBpm] = useState(120);
  const [sequence, setSequence] = useState([]);
  const [drag, setDrag] = useState(null); // { kind:'new', root, quality } | { kind:'move', id }
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [hoverIndex, setHoverIndex] = useState(null);
  const [songName, setSongName] = useState("");
  const [instrument, setInstrument] = useState("piano"); // "piano" | "synth"
  const [playingIndex, setPlayingIndex] = useState(null);
  const stopPlaybackRef = useRef(null);

  const sequenceRef = useRef(null);
  const startPos = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);

  const addChord = useCallback(
    (root, q, index) => {
      previewChord(chordToMidiNotes(root, q, octave), instrument);
      setSequence((prev) => {
        const next = [...prev];
        const item = { id: makeId(), root, quality: q, durationBeats: DEFAULT_DURATION };
        const at = index == null ? next.length : index;
        next.splice(at, 0, item);
        return next;
      });
    },
    [octave, instrument]
  );

  const finishDrag = useCallback(
    (clientX) => {
      const idx = resolveDropIndex(sequenceRef.current, clientX);
      setDrag((current) => {
        if (!current) return null;
        if (current.kind === "new") {
          addChord(current.root, current.quality, idx);
        } else if (current.kind === "move") {
          setSequence((prev) => {
            const fromIndex = prev.findIndex((c) => c.id === current.id);
            if (fromIndex === -1) return prev;
            const copy = [...prev];
            const [item] = copy.splice(fromIndex, 1);
            const insertAt = idx > fromIndex ? idx - 1 : idx;
            copy.splice(insertAt, 0, item);
            return copy;
          });
        }
        return null;
      });
      setHoverIndex(null);
    },
    [addChord]
  );

  // Listener global buat drag pointer (jalan pas ada drag aktif -- support mouse & touch sekaligus)
  useEffect(() => {
    if (!drag) return undefined;

    const handleMove = (e) => {
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) movedRef.current = true;
      setPointer({ x: e.clientX, y: e.clientY });
      setHoverIndex(resolveDropIndex(sequenceRef.current, e.clientX));
    };

    const handleUp = (e) => {
      if (!movedRef.current && drag.kind === "new") {
        // Tap doang (nggak digeser) -> langsung tambah ke akhir, ramah buat HP
        addChord(drag.root, drag.quality, sequence.length);
        setDrag(null);
        setHoverIndex(null);
      } else {
        finishDrag(e.clientX);
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, finishDrag, addChord, sequence.length]);

  const startNewDrag = (e, root, q) => {
    e.preventDefault();
    startPos.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    setPointer({ x: e.clientX, y: e.clientY });
    setDrag({ kind: "new", root, quality: q });
  };

  const startMoveDrag = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    startPos.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    setPointer({ x: e.clientX, y: e.clientY });
    setDrag({ kind: "move", id });
  };

  const removeChord = (id) => {
    setSequence((prev) => prev.filter((c) => c.id !== id));
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

  const clearAll = () => {
    stopPlaybackRef.current?.();
    setSequence([]);
  };

  const stopPlayback = useCallback(() => {
    stopPlaybackRef.current?.();
    stopPlaybackRef.current = null;
    setPlayingIndex(null);
  }, []);

  const handlePlaySequence = async () => {
    if (playingIndex !== null) {
      stopPlayback();
      return;
    }
    if (sequence.length === 0) return;
    const chords = sequence.map((c) => ({
      notes: chordToMidiNotes(c.root, c.quality, octave),
      durationBeats: c.durationBeats,
    }));
    const stop = await playSequence(chords, bpm, instrument, setPlayingIndex, stopPlayback);
    stopPlaybackRef.current = stop;
  };

  const handlePreviewChip = (c) => {
    previewChord(chordToMidiNotes(c.root, c.quality, octave), instrument);
  };

  // Matiin suara & timer kalau pindah tab / komponen unmount
  useEffect(() => stopPlayback, [stopPlayback]);

  const handleDownload = () => {
    if (sequence.length === 0) return;
    const chords = sequence.map((c) => ({
      notes: chordToMidiNotes(c.root, c.quality, octave),
      durationBeats: c.durationBeats,
    }));
    const filename = songName.trim()
      ? `${songName.trim().replace(/\s+/g, "-").toLowerCase()}.mid`
      : "progresi-chord.mid";
    downloadMidi(chords, bpm, filename);
  };

  const draggingNew = drag?.kind === "new";
  const draggingGhostLabel = draggingNew ? chordLabel(drag.root, drag.quality) : null;

  return (
    <div className="cb-page">
      <header className="cb-header">
        <div className="cb-eyebrow">
          <Music size={14} strokeWidth={2.5} />
          <span>Manual Chord Builder</span>
        </div>
        <h1 className="cb-h1">Susun progresi, download .midi</h1>
        <p className="cb-lead">
          Ketuk atau seret kunci ke bawah buat nyusun progresi &mdash; tiap kunci
          langsung kedengeran (Piano/Synth). Nggak ada AI, nggak ada server, murni
          disusun manual, tapi cepet dipake langsung di DAW.
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
          </div>
        </div>

        <div className="cb-piano" aria-label="Piano kunci">
          {NATURAL_NOTES.map((note, i) => (
            <div className="cb-piano-slot" key={note}>
              <button
                type="button"
                data-key
                className={`cb-key cb-key-white cb-key-${quality}`}
                onPointerDown={(e) => startNewDrag(e, note, quality)}
              >
                <span className="cb-key-label">{chordLabel(note, quality)}</span>
              </button>
              {SHARP_NOTES[i] && (
                <button
                  type="button"
                  data-key
                  className={`cb-key cb-key-black cb-key-${quality}`}
                  onPointerDown={(e) => startNewDrag(e, SHARP_NOTES[i], quality)}
                >
                  <span className="cb-key-label">{chordLabel(SHARP_NOTES[i], quality)}</span>
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="cb-hint">Tap = langsung nambah ke akhir &middot; Seret = taro di posisi tertentu</p>
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

        <div className="cb-sequence" ref={sequenceRef}>
          {sequence.length === 0 && !draggingNew && (
            <div className="cb-empty">Belum ada chord. Ketuk kunci di atas buat mulai nyusun.</div>
          )}
          {sequence.map((c, idx) => (
            <div key={c.id} className="cb-chip-slot">
              {hoverIndex === idx && drag && <span className="cb-drop-marker" />}
              <div
                data-chip
                className={`cb-chip cb-chip-${c.quality} ${drag?.kind === "move" && drag.id === c.id ? "is-dragging" : ""} ${playingIndex === idx ? "is-playing" : ""}`}
              >
                <span
                  className="cb-chip-grip"
                  onPointerDown={(e) => startMoveDrag(e, c.id)}
                  role="button"
                  aria-label="Geser buat urutin"
                >
                  <GripVertical size={15} />
                </span>
                <button
                  type="button"
                  className="cb-chip-preview"
                  onClick={() => handlePreviewChip(c)}
                  aria-label="Preview suara chord ini"
                >
                  <Volume2 size={13} />
                </button>
                <span className="cb-chip-label">{chordLabel(c.root, c.quality)}</span>
                <div className="cb-chip-duration">
                  <button type="button" onClick={() => changeDuration(c.id, -1)} aria-label="Kurangi durasi">
                    <Minus size={12} />
                  </button>
                  <span>{c.durationBeats}</span>
                  <button type="button" onClick={() => changeDuration(c.id, 1)} aria-label="Tambah durasi">
                    <Plus size={12} />
                  </button>
                </div>
                <button type="button" className="cb-chip-remove" onClick={() => removeChord(c.id)} aria-label="Hapus chord">
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
          {hoverIndex === sequence.length && drag && (
            <span className="cb-drop-marker" />
          )}
        </div>
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
              value={bpm}
              onChange={(e) => setBpm(Math.min(300, Math.max(40, Number(e.target.value) || 120)))}
            />
          </label>
          <label className="cb-field">
            <span className="cb-field-label">Oktaf</span>
            <input
              type="number"
              className="cb-input cb-input-num"
              min={2}
              max={6}
              value={octave}
              onChange={(e) => setOctave(Math.min(6, Math.max(2, Number(e.target.value) || 4)))}
            />
          </label>
        </div>
        <button type="button" className="cb-btn cb-btn-primary" onClick={handleDownload} disabled={sequence.length === 0}>
          <Download size={16} />
          Download .midi
        </button>
      </section>

      {drag && (
        <div
          className={`cb-ghost cb-ghost-${drag.kind === "new" ? drag.quality : sequence.find((c) => c.id === drag.id)?.quality || "major"}`}
          style={{ left: pointer.x, top: pointer.y }}
        >
          {draggingNew ? draggingGhostLabel : chordLabel(
            sequence.find((c) => c.id === drag.id)?.root || "",
            sequence.find((c) => c.id === drag.id)?.quality || "major"
          )}
        </div>
      )}
    </div>
  );
}
