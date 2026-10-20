import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { createRoundRobin, type TournamentRun } from './tournament';
import {
  finishSavedGame, recoverSavedTournament, saveCurrentGame,
  saveTournamentStatus, startSavedTournament, tournamentToPgn
} from './tournamentStorage';
import { DEFAULT_TIME_CONTROL } from './timeControls';
import { BUILTIN } from './engines';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); }
});

let sequence = 0;
function tournament(): TournamentRun {
  return {
    id: 'journal-test-' + (++sequence),
    name: 'Stockless Stress Test',
    entries: ['built-in-stockfish-19', 'stockless'],
    schedule: createRoundRobin({
      entrants: ['built-in-stockfish-19', 'stockless'],
      cycles: 1, gameCount: 4, doubleRound: true,
      movetime: 1000, maxPlies: 260
    }),
    index: 0, status: 'running', movetime: 1000, maxPlies: 260,
    timeControl: { ...DEFAULT_TIME_CONTROL }
  };
}
beforeEach(() => storage.clear());

describe('durable offline tournament journal', () => {
  it('stores event once, keeps ongoing game UCI moves and paused recovery', async () => {
    const run = tournament();
    await startSavedTournament(run);
    const game = new Chess();
    game.move('e4');
    game.move('e5');
    await saveCurrentGame({
      id: run.id, number: 1, initialFen: new Chess().fen(),
      moves: ['e2e4', 'e7e5'],
      clocks: { white: 177500, black: 178200 }, savedAt: Date.now()
    });
    const recovered = await recoverSavedTournament();
    expect(recovered).not.toBeNull();
    expect(recovered!.interrupted).toBe(true);
    expect(recovered!.run.status).toBe('paused');
    expect(recovered!.run.schedule).toHaveLength(4);
    expect(recovered!.snapshot?.moves).toEqual(['e2e4', 'e7e5']);
    expect(recovered!.snapshot?.clocks.white).toBe(177500);
  });
  it('atomically records one completed game and moves to the following pairing', async () => {
    const run = tournament();
    await startSavedTournament(run);
    const finished = {
      ...run.schedule[0], outcome: '1-0' as const, termination: 'White wins',
      pgn: '1. e4 e5 2. Nf3 Nc6'
    };
    const updated = { ...run, index: 1, schedule: [finished, ...run.schedule.slice(1)] };
    await finishSavedGame(updated, finished);
    const restored = await recoverSavedTournament();
    expect(restored?.run.index).toBe(1);
    expect(restored?.run.schedule[0].outcome).toBe('1-0');
    expect(restored?.run.schedule[0].pgn).toContain('Nf3');
    expect(restored?.snapshot).toBe(null);
    await saveTournamentStatus({ ...updated, status: 'paused' });
    expect((await recoverSavedTournament())?.interrupted).toBe(false);
    expect((await recoverSavedTournament())?.run.status).toBe('paused');
  });
  it('exports all completed games as valid PGN with headers and EPD setup', () => {
    const run = tournament();
    run.schedule[0] = {
      ...run.schedule[0], outcome: '1/2-1/2', termination: 'Draw by agreement',
      openingFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      pgn: '[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"]\n\n1... e5 2. Nf3'
    };
    const result = tournamentToPgn(run, [BUILTIN, {
      id: 'stockless', name: 'Stockless 0.9', path: 'C:\\stockless.exe',
      options: {}, availableOptions: []
    }]);
    expect(result).toContain('[White "Stockfish 19"]');
    expect(result).toContain('[Black "Stockless 0.9"]');
    expect(result).toContain('[SetUp "1"]');
    expect(result).toContain('[Result "1/2-1/2"]');
    expect(result).toMatch(/1\.\.\. e5 2\. Nf3 1\/2-1\/2/);
    expect((result.match(/\[FEN "/g) || []).length).toBe(1);
  });
});
