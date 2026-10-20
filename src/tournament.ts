import type { EngineEntry } from './engines';
import type { TimeControl } from './timeControls';

export type GameOutcome = '1-0' | '0-1' | '1/2-1/2';
export type TournamentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'stopped';
export interface TournamentGame {
  id: string;
  number: number;
  round: number;
  whiteId: string;
  blackId: string;
  outcome?: GameOutcome;
  termination?: string;
  pgn?: string;
  /** Same key is used by both color legs of a round-robin encounter. */
  openingPairKey?: string;
  /** Frozen, randomly sampled starting position for this game. */
  openingFen?: string;
}
export interface TournamentRun {
  id: string;
  name: string;
  entries: string[];
  schedule: TournamentGame[];
  index: number;
  status: TournamentStatus;
  movetime: number;
  maxPlies: number;
  timeControl?: TimeControl;
  /** Name of the EPD book fixed when this event began; empty for startpos. */
  openingBookName?: string;
}
export interface TournamentConfig {
  entrants: string[];
  cycles: number;
  /** Exact total games to schedule. If absent, legacy cycles are used. */
  gameCount?: number;
  timeControl?: TimeControl;
  doubleRound: boolean;
  movetime: number;
  maxPlies: number;
}
export function createRoundRobin(config: TournamentConfig): TournamentGame[] {
  const entries = [...new Set(config.entrants)];
  if (entries.length < 2) return [];
  if (entries.length > 24) throw new Error('Tournament limit is 24 entrants.');
  const n = entries.length + entries.length % 2;
  const row: (string | null)[] = entries.length % 2 ? [...entries, null] : [...entries];
  const oneLeg: { whiteId: string; blackId: string; round: number }[] = [];
  for (let round = 0; round < n - 1; round++) {
    for (let seat = 0; seat < n / 2; seat++) {
      const a = row[seat], b = row[n - seat - 1];
      if (!a || !b) continue;
      const reverse = (round + seat) % 2 !== 0;
      oneLeg.push({
        whiteId: reverse ? b : a, blackId: reverse ? a : b, round: round + 1
      });
    }
    row.splice(1, 0, row.pop()!);
  }
  const paired = config.doubleRound;
  const perCycle = oneLeg.length * (paired ? 2 : 1);
  const legacyCycles = Math.max(1, Math.min(20, Math.floor(config.cycles)));
  const requested = config.gameCount === undefined
    ? legacyCycles * perCycle : Math.floor(config.gameCount);
  if (!Number.isFinite(requested) || requested < 1 || requested > 50000) {
    throw new Error('Choose between 1 and 50,000 games.');
  }
  const games: TournamentGame[] = [];
  for (let index = 0; index < requested; index++) {
    const cycle = Math.floor(index / perCycle);
    const withinCycle = index % perCycle;
    const pairIndex = Math.floor(withinCycle / (paired ? 2 : 1));
    const returnLeg = paired && withinCycle % 2 === 1;
    const seed = oneLeg[pairIndex];
    // Flip each cycle too, reducing color bias for arbitrary odd totals.
    const swapColors = returnLeg !== (cycle % 2 === 1);
    games.push({
      id: 'g-' + (index + 1),
      number: index + 1,
      round: cycle * (n - 1) * (paired ? 2 : 1) +
        seed.round + (returnLeg ? n - 1 : 0),
      whiteId: swapColors ? seed.blackId : seed.whiteId,
      blackId: swapColors ? seed.whiteId : seed.blackId,
      openingPairKey: cycle + ':' + pairIndex
    });
  }
  return games;
}

export function tournamentTable(run: TournamentRun | null, engines: EngineEntry[]) {
  if (!run) return [];
  return run.entries.map(id => {
    let won = 0, drawn = 0, lost = 0;
    for (const game of run.schedule) {
      if (!game.outcome || (game.whiteId !== id && game.blackId !== id)) continue;
      const whiteScore = game.outcome === '1-0' ? 1 : game.outcome === '0-1' ? 0 : .5;
      const points = game.whiteId === id ? whiteScore : 1 - whiteScore;
      if (points === 1) won++;
      else if (points === 0) lost++;
      else drawn++;
    }
    return {
      id, name: engines.find(x => x.id === id)?.name || id,
      points: won + .5 * drawn, played: won + drawn + lost,
      won, drawn, lost
    };
  }).sort((a,b) => b.points - a.points || b.won - a.won || a.name.localeCompare(b.name));
}
