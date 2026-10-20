import { useEffect, useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
export type Arrow = { from: string; to: string; color?: string; opacity?: number; width?: number };
export type BoardTheme = 'broadcast' | 'classic' | 'blue';

function vector(square: string, flipped: boolean): [number, number] {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return [
    (flipped ? 7 - file : file) * 100 + 50,
    (flipped ? rank : 7 - rank) * 100 + 50
  ];
}
function ArrowLayer({ arrows, flipped }: { arrows: Arrow[]; flipped: boolean }) {
  return <svg className="arrow-layer" viewBox="0 0 800 800" preserveAspectRatio="none" aria-hidden="true">
    {arrows.map((arrow, i) => {
      if (!/^[a-h][1-8]$/.test(arrow.from) || !/^[a-h][1-8]$/.test(arrow.to) || arrow.from === arrow.to) return null;
      const [x1, y1] = vector(arrow.from, flipped);
      const [x2, y2] = vector(arrow.to, flipped);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      const endX = x2 - ux * 27, endY = y2 - uy * 27;
      const tipX = x2 - ux * 12, tipY = y2 - uy * 12;
      const baseX = endX - ux * 18, baseY = endY - uy * 18;
      const half = arrow.width ?? 12;
      const points = [
        [tipX, tipY],
        [baseX - uy * (half + 8), baseY + ux * (half + 8)],
        [baseX + uy * (half + 8), baseY - ux * (half + 8)]
      ].map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
      return <g key={i} opacity={arrow.opacity ?? 0.8}>
        <line x1={x1} y1={y1} x2={endX} y2={endY}
          stroke={arrow.color ?? '#e4f66e'} strokeWidth={half} strokeLinecap="round" />
        <polygon points={points} fill={arrow.color ?? '#e4f66e'} />
      </g>;
    })}
  </svg>;
}
export function ChessBoard({ fen, arrows = [], mini = false, flipped = false, theme = 'broadcast', lastMove, onMove, readOnly = false }: {
  fen: string;
  arrows?: Arrow[];
  mini?: boolean;
  readOnly?: boolean;
  flipped?: boolean;
  theme?: BoardTheme;
  lastMove?: [string, string] | null;
  onMove?: (from: string, to: string) => void;
}) {
  const interactive = !mini && !readOnly && !!onMove;
  const game = useMemo(() => { try { return new Chess(fen); } catch { return new Chess(); } }, [fen]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [fen]);
  const valid = useMemo(() => selected ? game.moves({ square: selected as Square, verbose: true }).map(m => m.to) : [], [game, selected]);
  const board = game.board();
  const rows = flipped ? [...board].reverse().map(row => [...row].reverse()) : board;
  const squares = 'abcdefgh';
  const squareName = (x: number, y: number) => (flipped ? squares[7 - x] + (y + 1) : squares[x] + (8 - y));
  const choose = (square: string) => {
    if (!interactive || !onMove) return;
    if (selected && selected !== square && valid.includes(square as Square)) {
      onMove(selected, square);
      setSelected(null);
      return;
    }
    const piece = game.get(square as Square);
    setSelected(piece && piece.color === game.turn() ? square : null);
  };
  return <div className={'chess-board theme-' + theme + (mini ? ' mini-board' : '')}>
    <div className="squares">
      {rows.flatMap((row, y) => row.map((piece, x) => {
        const square = squareName(x, y);
        return <div
          key={square}
          className={'square ' + ((x + y) % 2 ? 'dark' : 'light') +
            (lastMove?.includes(square) ? ' last' : '') +
            (selected === square ? ' selected' : '') +
            (valid.includes(square as Square) ? ' legal' : '')}
          onClick={() => choose(square)}
          onDragOver={!interactive ? undefined : e => e.preventDefault()}
          onDrop={!interactive ? undefined : e => {
            e.preventDefault();
            const from = e.dataTransfer.getData('text/plain');
            if (onMove && /^[a-h][1-8]$/.test(from)) onMove(from, square);
          }}>
          {piece && <img alt={piece.color + piece.type} draggable={interactive}
            onDragStart={e => { if (interactive) e.dataTransfer.setData('text/plain', square); }}
            src={'/pieces/cburnett/' + piece.color + piece.type.toUpperCase() + '.svg'} />}
          {!mini && x === 0 && <span className="rank-label">{flipped ? y + 1 : 8 - y}</span>}
          {!mini && y === 7 && <span className="file-label">{flipped ? squares[7 - x] : squares[x]}</span>}
        </div>;
      }))}
    </div>
    {!mini && <ArrowLayer arrows={arrows} flipped={flipped} />}
  </div>;
}
