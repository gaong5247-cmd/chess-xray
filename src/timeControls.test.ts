import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_CONTROL, buildGoCommand, formatClock, needsManualStop,
  newGameClocks, sanitizeTimeControl, timeSpent, type TimeControl
} from './timeControls';
import { createRoundRobin } from './tournament';
import { assignOpeningPositions } from './epd';

describe('tournament UCI search modes', () => {
  it('sends real clock + per-move Fischer increment', () => {
    const tc: TimeControl = { ...DEFAULT_TIME_CONTROL, mode: 'clock', incrementSeconds: 2.5 };
    expect(buildGoCommand(tc, { white: 180000, black: 120000 }))
      .toBe('go wtime 180000 btime 120000 winc 2500 binc 2500');
    expect(newGameClocks(tc)).toEqual({ white: 180000, black: 180000 });
    expect(timeSpent(180000, 5000, 2500)).toBe(177500);
    expect(timeSpent(100, 300, 500)).toBe(500);
  });
  it('has selectable fixed move time not restricted to three minutes', () => {
    expect(buildGoCommand({
      ...DEFAULT_TIME_CONTROL, mode: 'movetime', movetimeMs: 21000
    }, { white: 0, black: 0 })).toBe('go movetime 21000');
  });
  it('uses real UCI infinite only if no depth/nodes caps are specified', () => {
    const tc: TimeControl = { ...DEFAULT_TIME_CONTROL, mode: 'infinite' };
    expect(needsManualStop(tc)).toBe(true);
    expect(buildGoCommand(tc, { white: 0, black: 0 })).toBe('go infinite');
    const depth = { ...tc, depthLimit: 24 };
    expect(needsManualStop(depth)).toBe(false);
    expect(buildGoCommand(depth, { white: 0, black: 0 })).toBe('go depth 24');
    expect(buildGoCommand({ ...tc, nodesLimit: 900000 }, { white: 0, black: 0 }))
      .toBe('go nodes 900000');
    expect(buildGoCommand({ ...depth, nodesLimit: 900000 }, { white: 0, black: 0 }))
      .toBe('go depth 24 nodes 900000');
  });
  it('bounds invalid extreme input and formats live clock correctly', () => {
    const tc = sanitizeTimeControl({
      ...DEFAULT_TIME_CONTROL, mode: 'infinite', depthLimit: 999,
      nodesLimit: 1e20, incrementSeconds: -4
    });
    expect(tc.depthLimit).toBe(255);
    expect(tc.nodesLimit).toBe(1e12);
    expect(tc.incrementSeconds).toBe(0);
    expect(formatClock(180000)).toBe('03:00');
    expect(formatClock(15300)).toBe('00:15.3');
  });
});

describe('exact match count', () => {
  const config = {
    entrants: ['sf19', 'stockless', 'rubichess'],
    gameCount: 19, cycles: 1, doubleRound: true,
    movetime: 1000, maxPlies: 260
  };
  it('schedules precisely requested count even if a round is partial', () => {
    const games = createRoundRobin(config);
    expect(games).toHaveLength(19);
    expect(games.map(g => g.number)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(new Set(games.map(g => g.id)).size).toBe(19);
    for (const g of games) {
      expect(g.whiteId).not.toBe(g.blackId);
    }
  });
  it('mirrors colors for the return leg and reuses the opening FEN', () => {
    const games = createRoundRobin({ ...config, gameCount: 8 });
    for (let i = 0; i + 1 < games.length; i += 2) {
      expect(games[i].whiteId).toBe(games[i + 1].blackId);
      expect(games[i].blackId).toBe(games[i + 1].whiteId);
      expect(games[i].openingPairKey).toBe(games[i + 1].openingPairKey);
    }
    const assigned = assignOpeningPositions(games, [
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    ], true);
    for (let i = 0; i + 1 < assigned.length; i += 2) {
      expect(assigned[i].openingFen).toBe(assigned[i + 1].openingFen);
    }
  });
  it('supports one or many games and validates an upper bound', () => {
    expect(createRoundRobin({ ...config, gameCount: 1 })).toHaveLength(1);
    expect(createRoundRobin({ ...config, gameCount: 501 })).toHaveLength(501);
    expect(() => createRoundRobin({ ...config, gameCount: 50001 })).toThrow();
  });
});
