import { describe, expect, it, afterEach, vi } from 'vitest';
import { Chess } from 'chess.js';
import { makeEpdBook, assignOpeningPositions, randomBookIndex } from './epd';
import { createRoundRobin } from './tournament';

const START = new Chess().fen();
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';
const INVALID = '8/8/8/8/8/8/8/8 w - - 0 1';
const TERMINAL = '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1';

describe('EPD opening book', () => {
  it('accepts playable positions and removes malformed and terminal FENs', () => {
    const book = makeEpdBook({
      path: 'C:\\opening.epd', fileName: 'opening.epd',
      totalLines: 10000, candidateLines: 9999,
      positions: [START, AFTER_E4, AFTER_D4, INVALID, TERMINAL]
    });
    expect(book.usablePositions).toHaveLength(3);
    expect(book.rejectedSamples).toBe(2);
    expect(book.candidateLines).toBe(9999);
    expect(book.totalLines).toBe(10000);
    expect(book.usablePositions).toContain(START);
  });

  it('rejects an EPD sample with no playable starting positions', () => {
    expect(() => makeEpdBook({
      path: 'bad.epd', fileName: 'bad.epd',
      candidateLines: 2, totalLines: 2, positions: [INVALID, TERMINAL]
    })).toThrow(/No playable FEN/);
  });

  it('assigns legal random FENs and same FEN to reversed-color games', () => {
    const schedule = createRoundRobin({
      entrants: ['a', 'b', 'c'], cycles: 2, doubleRound: true,
      movetime: 1000, maxPlies: 200
    });
    expect(schedule).toHaveLength(12);
    const withBooks = assignOpeningPositions(schedule, [START, AFTER_E4, AFTER_D4], true);
    const paired = new Map<string, string>();
    for (const game of withBooks) {
      expect(game.openingFen).toBeDefined();
      expect([START, AFTER_E4, AFTER_D4]).toContain(game.openingFen);
      expect(() => new Chess(game.openingFen)).not.toThrow();
      const key = game.openingPairKey!;
      if (paired.has(key)) expect(game.openingFen).toBe(paired.get(key));
      else paired.set(key, game.openingFen!);
    }
    expect(paired.size).toBe(6);
    expect(schedule.every(game => game.openingFen === undefined)).toBe(true);
  });

  it('can select independently when paired openings are disabled', () => {
    let next = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (values: Uint32Array) => { values[0] = next++; return values; }
    });
    const schedule = createRoundRobin({
      entrants: ['a', 'b'], cycles: 1, doubleRound: true,
      movetime: 1000, maxPlies: 200
    });
    const independent = assignOpeningPositions(schedule, [START, AFTER_E4], false);
    expect(independent.map(g => g.openingFen)).toEqual([START, AFTER_E4]);
  });

  it('chooses indices within bounds', () => {
    for (let i = 0; i < 40; i++) {
      const result = randomBookIndex(3);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(3);
    }
    expect(() => randomBookIndex(0)).toThrow();
  });

  afterEach(() => { vi.unstubAllGlobals(); });
});
