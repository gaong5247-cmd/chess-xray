import { Chess } from 'chess.js';

export type Slot = 'white' | 'black';
export interface UciInfo {
  depth?: number;
  seldepth?: number;
  multipv: number;
  score?: { type: 'cp' | 'mate'; value: number; bound?: 'lower' | 'upper' };
  time?: number;
  nodes?: number;
  nps?: number;
  hashfull?: number;
  tbhits?: number;
  wdl?: [number, number, number];
  pv: string[];
}
export interface XrayTelemetry {
  ttHits?: number;
  ttProbes?: number;
  betaCutoffs?: number;
  nullMoveCuts?: number;
  lmrReductions?: number;
  nnue?: Record<string, number>;
}
function numberAfter(tokens: string[], key: string): number | undefined {
  const index = tokens.indexOf(key);
  if (index < 0 || index + 1 >= tokens.length) return undefined;
  const n = Number(tokens[index + 1]);
  return Number.isFinite(n) ? n : undefined;
}
export function parseUciInfo(line: string): UciInfo | null {
  if (!line.startsWith('info ') || line.startsWith('info string ')) return null;
  const tokens = line.split(/\s+/);
  const scoreIndex = tokens.indexOf('score');
  const kind = tokens[scoreIndex + 1];
  const scoreValue = Number(tokens[scoreIndex + 2]);
  const bound: 'lower' | 'upper' | undefined = tokens.includes('lowerbound') ? 'lower'
    : tokens.includes('upperbound') ? 'upper' : undefined;
  const pvIndex = tokens.indexOf('pv');
  const wdlIndex = tokens.indexOf('wdl');
  const wdlValues = tokens.slice(wdlIndex + 1, wdlIndex + 4).map(Number);
  const multipv = numberAfter(tokens, 'multipv') ?? 1;
  return {
    depth: numberAfter(tokens, 'depth'),
    seldepth: numberAfter(tokens, 'seldepth'),
    multipv,
    score: scoreIndex >= 0 && (kind === 'cp' || kind === 'mate') && Number.isFinite(scoreValue)
      ? { type: kind, value: scoreValue, bound } : undefined,
    time: numberAfter(tokens, 'time'),
    nodes: numberAfter(tokens, 'nodes'),
    nps: numberAfter(tokens, 'nps'),
    hashfull: numberAfter(tokens, 'hashfull'),
    tbhits: numberAfter(tokens, 'tbhits'),
    wdl: wdlIndex >= 0 && wdlValues.length === 3 && wdlValues.every(Number.isFinite)
      ? wdlValues as [number, number, number] : undefined,
    pv: pvIndex >= 0 ? tokens.slice(pvIndex + 1).filter(x => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x)) : []
  };
}
// Non-standard opt-in Stockless instrumentation:
// info string xray {"ttHits":235,"ttProbes":700,"betaCutoffs":123}
export function parseXrayTelemetry(line: string): XrayTelemetry | null {
  if (!line.startsWith('info string xray ')) return null;
  try {
    const raw: unknown = JSON.parse(line.slice('info string xray '.length));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const data = raw as Record<string, unknown>;
    const out: XrayTelemetry = {};
    const fields = ['ttHits', 'ttProbes', 'betaCutoffs', 'nullMoveCuts', 'lmrReductions'] as const;
    for (const key of fields) {
      if (typeof data[key] === 'number' && Number.isFinite(data[key])) {
        out[key] = data[key] as number;
      }
    }
    if (typeof data.nnue === 'object' && data.nnue && !Array.isArray(data.nnue)) {
      out.nnue = Object.fromEntries(Object.entries(data.nnue).filter(([,v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string,number>;
    }
    return out;
  } catch { return null; }
}
export function fromUci(uci: string) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' };
}
export function legalPv(fen: string, pv: string[], max = 16) {
  const game = new Chess(fen);
  const san: string[] = [];
  const used: string[] = [];
  for (const uci of pv.slice(0, max)) {
    const move = fromUci(uci);
    if (!move) break;
    try {
      const played = game.move(move);
      if (!played) break;
      san.push(played.san);
      used.push(uci);
    } catch { break; }
  }
  return { fen: game.fen(), san, uci: used };
}
// Standard UCI score is always from the side-to-move perspective.
export function whiteEval(info: UciInfo | undefined, turn: 'w' | 'b'): number | null {
  if (!info?.score) return null;
  const cp = info.score.type === 'mate'
    ? (info.score.value > 0 ? 1600 : -1600)
    : info.score.value;
  return turn === 'w' ? cp : -cp;
}
export function scoreLabel(info: UciInfo | undefined, turn: 'w' | 'b') {
  const score = whiteEval(info, turn);
  if (score === null) return '—';
  if (info?.score?.type === 'mate') {
    const value = info.score.value * (turn === 'w' ? 1 : -1);
    return '#' + (value > 0 ? '+' : '') + value;
  }
  return (score >= 0 ? '+' : '') + (score / 100).toFixed(2);
}
export function shortNumber(n: number | undefined) {
  if (n === undefined) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString();
}
