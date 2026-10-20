import type { EngineEntry } from './engines';

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
  /** Name of the EPD book fixed when this event began; empty for startpos. */
  openingBookName?: string;
}
export interface TournamentConfig {
  entrants: string[];
  cycles: number;
  doubleRound: boolean;
  movetime: number;
  maxPlies: number;
}
export function createRoundRobin(config: TournamentConfig): TournamentGame[] {
  const entries = [...new Set(config.entrants)];
  if (entries.length < 2) return [];
  if (entries.length > 24) throw new Error('Tournament limit is 24 entrants.');
  const cycles = Math.max(1, Math.min(20, Math.floor(config.cycles)));
  const n = entries.length + entries.length % 2;
  const row: (string | null)[] = entries.length % 2 ? [...entries, null] : [...entries];
  const oneLeg: { whiteId: string; blackId: string; round: number }[] = [];
  for (let round = 0; round < n - 1; round++) {
    for (let seat = 0; seat < n / 2; seat++) {
      const a = row[seat], b = row[n - seat - 1];
      if (!a || !b) continue;
      // Switch white/black to reduce the first-leg color imbalance.
      const reverse = (round + seat) % 2 !== 0;
      oneLeg.push({ whiteId: reverse ? b : a, blackId: reverse ? a : b, round: round + 1 });
    }
    row.splice(1, 0, row.pop()!);
  }
  const roundsPerLeg = n - 1;
  const games: TournamentGame[] = [];
  for (let cycle = 0; cycle < cycles; cycle++) {
    const roundOffset = cycle * roundsPerLeg * (config.doubleRound ? 2 : 1);
    for (const [pairIndex, game] of oneLeg.entries()) {
      games.push({
        id: 'g-' + (games.length + 1),
        number: games.length + 1, round: roundOffset + game.round,
        whiteId: game.whiteId, blackId: game.blackId,
        openingPairKey: cycle + ':' + pairIndex
      });
    }
    if (config.doubleRound) {
      for (const [pairIndex, game] of oneLeg.entries()) {
        games.push({
          id: 'g-' + (games.length + 1),
          number: games.length + 1, round: roundOffset + roundsPerLeg + game.round,
          whiteId: game.blackId, blackId: game.whiteId,
          openingPairKey: cycle + ':' + pairIndex
        });
      }
    }
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
