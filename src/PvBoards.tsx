import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Expand, Minus, Plus, Scaling, ScanEye } from 'lucide-react';
import { ChessBoard, type Arrow, type BoardTheme } from './ChessBoard';
import { type Slot, type UciInfo, fromUci, legalPv, scoreLabel } from './uci';

const MIN_BOARD = 160;
const MAX_BOARD = 760;
const STEP = 20;
const clampBoard = (value: number) => Math.min(MAX_BOARD, Math.max(MIN_BOARD, Math.round(value / 10) * 10));

export interface PvBoardSizes {
  white: number;
  black: number;
}
export interface PvBoardGroupProps {
  names: Record<Slot, string>;
  variations: Record<Slot, UciInfo[]>;
  originFens: Record<Slot, string>;
  currentFen: string;
  sizes: PvBoardSizes;
  onSizeChange: (side: Slot, size: number) => void;
  selectedSlot: Slot;
  onSelectSlot: (slot: Slot) => void;
  flipped: boolean;
  theme: BoardTheme;
  live: boolean;
  mode: 'analysis' | 'arena' | 'tournament';
  expanded?: boolean;
  onExpand?: () => void;
}

/**
 * The full 8×8 board is physically resized by its container's width.
 * No transform:scale, magnifier overlay or painted-upscaled screenshot.
 */
function PvBoard({ slot, names, variations, originFens, currentFen, sizes,
  onSizeChange, selectedSlot, onSelectSlot, flipped, theme, live, mode }: PvBoardGroupProps & { slot: Slot }) {
  const lines = variations[slot];
  const originFen = originFens[slot] || currentFen;
  const [chosenRank, setChosenRank] = useState(1);
  const [ply, setPly] = useState(1);
  const drag = useRef<{ startX: number; startY: number; initial: number } | null>(null);
  const chosenLine = lines.find(item => item.multipv === chosenRank) || lines[0];
  const legal = useMemo(() => legalPv(originFen, chosenLine?.pv || [], 40),
    [originFen, chosenLine?.pv.join(' ')]);
  const currentPly = Math.min(ply, legal.uci.length);
  const boardPosition = useMemo(() => legalPv(originFen, legal.uci, currentPly).fen,
    [originFen, legal.uci.join(' '), currentPly]);
  const lastUci = currentPly > 0 ? fromUci(legal.uci[currentPly - 1]) : null;
  const nextUci = currentPly < legal.uci.length ? fromUci(legal.uci[currentPly]) : null;
  const arrows: Arrow[] = nextUci ? [{ from: nextUci.from, to: nextUci.to,
    color: slot === 'white' ? '#dbed70' : '#64ccec', width: 13, opacity: .74 }] : [];

  useEffect(() => { setChosenRank(1); setPly(1); }, [originFen]);
  const onResizeMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.startX;
    const dy = event.clientY - drag.current.startY;
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    onSizeChange(slot, clampBoard(drag.current.initial + delta));
  };

  const sourceIsCurrent = originFen === currentFen;
  const turn = originFen.split(' ')[1] === 'b' ? 'b' : 'w';
  const active = selectedSlot === slot;
  const status = !lines.length ? 'WAITING FOR PV' :
    !sourceIsCurrent ? 'PREVIOUS SEARCH POSITION' :
    live && mode === 'analysis' ? 'LIVE SAME POSITION' : 'LAST REPORTED PV';

  return <section className={'pv-engine-card ' + slot + (active ? ' active' : '')}
      aria-label={(slot === 'white' ? 'White PV' : 'Black PV') + ' board and moves'}>
    <div className="pv-engine-heading">
      <span className={'pv-side-piece ' + slot} aria-hidden="true">{slot === 'white' ? '♔' : '♚'}</span>
      <div className="pv-engine-headlines">
        <strong>{slot === 'white' ? 'WHITE PV' : 'BLACK PV'}</strong>
        <small title={names[slot]}>{names[slot]}</small>
      </div>
      <button className={'pv-select-engine' + (active ? ' chosen' : '')}
        onClick={() => onSelectSlot(slot)}
        title="Show this engine's metrics, search tree and arrows on the main board">
        <ScanEye size={14} /> {active ? 'FOCUSED' : 'FOCUS'}
      </button>
    </div>
    <div className={'pv-origin-status' + (sourceIsCurrent ? '' : ' old-position')}>
      <i className="pv-status-dot" /> {status}
    </div>
    <div className="pv-board-size-control">
      <label htmlFor={'pv-' + slot + '-board-size'}>ACTUAL BOARD SIZE</label>
      <button aria-label={'Decrease ' + slot + ' PV board size'}
        onClick={() => onSizeChange(slot, clampBoard(sizes[slot] - STEP))}>
        <Minus size={15} />
      </button>
      <input id={'pv-' + slot + '-board-size'} type="range" min={MIN_BOARD} max={MAX_BOARD}
        step="10" value={sizes[slot]}
        onChange={event => onSizeChange(slot, clampBoard(Number(event.target.value)))} />
      <button aria-label={'Increase ' + slot + ' PV board size'}
        onClick={() => onSizeChange(slot, clampBoard(sizes[slot] + STEP))}>
        <Plus size={15} />
      </button>
      <output>{sizes[slot]}px</output>
    </div>
    <div className="pv-large-board-layout">
      <div className="pv-real-board-holder" style={{ width: sizes[slot] + 'px', maxWidth: '100%' }}>
        <ChessBoard fen={boardPosition} flipped={flipped} theme={theme}
          lastMove={lastUci ? [lastUci.from, lastUci.to] : null}
          arrows={arrows} readOnly />
        <button className="pv-board-corner-handle" type="button"
          aria-label={'Drag to resize ' + slot + ' PV chessboard'}
          title="Drag to resize the actual PV board"
          onPointerDown={event => {
            event.preventDefault();
            drag.current = { startX: event.clientX, startY: event.clientY, initial: sizes[slot] };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={onResizeMove}
          onPointerUp={event => {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { drag.current = null; }}>
          <Scaling size={18} />
        </button>
      </div>
    </div>
    <div className="pv-step-navigation">
      <button disabled={currentPly <= 0} onClick={() => setPly(Math.max(0, currentPly - 1))}
        aria-label={'Previous ' + slot + ' PV move'}><ChevronLeft size={17} /></button>
      <div><b>{currentPly}</b> / {legal.uci.length} plies <span>· Preview position</span></div>
      <button disabled={currentPly >= legal.uci.length} onClick={() => setPly(Math.min(legal.uci.length, currentPly + 1))}
        aria-label={'Next ' + slot + ' PV move'}><ChevronRight size={17} /></button>
    </div>
    <div className="pv-engine-lines">
      {lines.length === 0 && <div className="pv-no-lines">No variation yet. In Analysis, both engines examine the current position. In a tournament, each engine's most recent searched position is retained.</div>}
      {lines.map(line => {
        const rendered = legalPv(originFen, line.pv, 30);
        const chosen = chosenLine?.multipv === line.multipv;
        return <button key={line.multipv}
          className={'pv-line-choice' + (chosen ? ' chosen' : '')}
          onClick={() => { setChosenRank(line.multipv); setPly(1); }}>
          <span className="pv-choice-number">PV {line.multipv}</span>
          <span className="pv-choice-score">{scoreLabel(line, turn)}</span>
          <span className="pv-choice-depth">D{line.depth ?? '—'}</span>
          <span className="pv-choice-moves">{rendered.san.length ? rendered.san.join(' ') : 'Pending moves'}</span>
        </button>;
      })}
    </div>
  </section>;
}

export default function PvBoards(props: PvBoardGroupProps) {
  return <div className={'pv-boards-comparison' + (props.expanded ? ' expanded' : '')}>
    {!props.expanded && <div className="pv-comparison-toolbar">
      <div><span className="eyebrow">INDEPENDENT ENGINE BOARDS</span>
        <h3>White + Black PV</h3></div>
      {props.onExpand && <button className="pv-expand-button" onClick={props.onExpand}>
        <Expand size={15} /> Wide dual-board view
      </button>}
    </div>}
    <div className="pv-comparison-grid">
      <PvBoard {...props} slot="white" />
      <PvBoard {...props} slot="black" />
    </div>
    {!props.expanded && <div className="pv-comparison-hint">
      Both full-size boards are independently resizable using each board's
      slider or corner grip. For larger boards, open Wide dual-board view.
    </div>}
  </div>;
}
