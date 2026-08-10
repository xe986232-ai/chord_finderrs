import { getGuitarShape, getPianoHighlight, PIANO_OCTAVE_WHITE, PIANO_OCTAVE_BLACK } from "./chordDiagram";

const STRING_LABELS = ["E", "A", "D", "G", "B", "e"]; // low -> high, kiri ke kanan
const ROWS = 4; // jumlah baris fret yang ditampilin

/** Diagram fretboard gitar, SVG, ukurannya kecil biar muat di chip/kartu. */
function GuitarDiagram({ root, quality }) {
  const shape = getGuitarShape(root, quality);
  const { baseFret, strings } = shape;

  const width = 92;
  const height = 108;
  const padTop = 20; // ruang buat label posisi / nut
  const padSide = 10;
  const fretGap = (height - padTop - 6) / ROWS;
  const stringGap = (width - padSide * 2) / (STRING_LABELS.length - 1);

  // Baris pertama yang ditampilin = fret nomor berapa (real fret number).
  const firstDisplayedFret = baseFret === 0 ? 1 : baseFret;

  const x = (i) => padSide + i * stringGap;
  const y = (rowFromFirst) => padTop + rowFromFirst * fretGap;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="cb-diagram-svg" role="img" aria-label={`Diagram gitar ${shape.label}`}>
      {/* nut (kalau open position) atau label posisi (kalau barre) */}
      {baseFret === 0 ? (
        <rect x={padSide} y={padTop} width={width - padSide * 2} height={3} className="cb-diagram-nut" />
      ) : (
        <text x={2} y={padTop + fretGap * 0.5 + 3} className="cb-diagram-fret-label">
          {baseFret}fr
        </text>
      )}

      {/* garis fret horizontal */}
      {Array.from({ length: ROWS + 1 }, (_, r) => (
        <line
          key={r}
          x1={padSide}
          y1={padTop + r * fretGap}
          x2={width - padSide}
          y2={padTop + r * fretGap}
          className="cb-diagram-fretline"
        />
      ))}

      {/* garis senar vertikal */}
      {STRING_LABELS.map((_, i) => (
        <line key={i} x1={x(i)} y1={padTop} x2={x(i)} y2={height - 6} className="cb-diagram-string" />
      ))}

      {/* open / barre indicator di atas nut buat tiap senar */}
      {strings.map((s, i) => {
        const rowFromFirst = s.fret - firstDisplayedFret;
        if (baseFret === 0 && s.fret === 0) {
          return (
            <circle key={i} cx={x(i)} cy={padTop - 8} r={3} className="cb-diagram-open" />
          );
        }
        if (rowFromFirst < 0 || rowFromFirst >= ROWS) return null;
        return (
          <g key={i}>
            <circle cx={x(i)} cy={y(rowFromFirst) + fretGap / 2} r={7} className="cb-diagram-dot" />
            {s.finger && (
              <text x={x(i)} y={y(rowFromFirst) + fretGap / 2 + 3} className="cb-diagram-finger">
                {s.finger}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Mini keyboard 1 oktaf (C..B), highlight tuts yang jadi bagian chord-nya. */
function PianoDiagram({ root, quality }) {
  const { highlighted } = getPianoHighlight(root, quality);

  return (
    <div className="cb-diagram-piano" role="img" aria-label={`Diagram piano ${root}${quality === "minor" ? "m" : ""}`}>
      {PIANO_OCTAVE_WHITE.map((note, i) => {
        const isOn = highlighted.has(note);
        const isRoot = note === root;
        const blackNote = PIANO_OCTAVE_BLACK[i];
        const blackOn = blackNote && highlighted.has(blackNote);
        const blackIsRoot = blackNote === root;
        return (
          <div className="cb-diagram-piano-slot" key={note}>
            <div className={`cb-diagram-key cb-diagram-key-white ${isOn ? "is-on" : ""} ${isRoot ? "is-root" : ""}`}>
              {isOn && <span className="cb-diagram-key-dot" />}
            </div>
            {blackNote && (
              <div
                className={`cb-diagram-key cb-diagram-key-black ${blackOn ? "is-on" : ""} ${blackIsRoot ? "is-root" : ""}`}
              >
                {blackOn && <span className="cb-diagram-key-dot" />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Entry point: pilih gitar atau piano sesuai `view`. */
export default function ChordDiagram({ root, quality, view }) {
  return view === "piano" ? (
    <PianoDiagram root={root} quality={quality} />
  ) : (
    <GuitarDiagram root={root} quality={quality} />
  );
}
