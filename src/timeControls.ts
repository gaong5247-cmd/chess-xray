/**
 * Tournament time controls.
 *
 * "Infinite" is a user-facing untimed search mode, NOT a UCI keyword that
 * can safely be combined with finite depth/nodes limits. UCI go infinite
 * requires the GUI to send stop, while go depth N nodes M ends
 * automatically at the first cap reached.
 */
export type SearchMode = 'clock' | 'movetime' | 'infinite';
export type Slot = 'white' | 'black';
export interface TimeControl {
  mode: SearchMode;
  initialSeconds: number;
  incrementSeconds: number;
  movetimeMs: number;
  /** 0 means unrestricted. */
  depthLimit: number;
  /** 0 means unrestricted. */
  nodesLimit: number;
}
export type ClockTimes = Record<Slot, number>;
export const DEFAULT_TIME_CONTROL: TimeControl = {
  mode: 'clock',
  initialSeconds: 180,
  incrementSeconds: 2,
  movetimeMs: 1000,
  depthLimit: 0,
  nodesLimit: 0
};

function integer(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new Error('Time control must be a finite number.');
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
export function sanitizeTimeControl(tc: TimeControl): TimeControl {
  if (!['clock', 'movetime', 'infinite'].includes(tc.mode)) {
    throw new Error('Unsupported time control type.');
  }
  return {
    mode: tc.mode,
    initialSeconds: integer(tc.initialSeconds, 1, 86400),
    incrementSeconds: Math.max(0, Math.min(3600, Number(tc.incrementSeconds) || 0)),
    movetimeMs: integer(tc.movetimeMs, 50, 600000),
    depthLimit: integer(tc.depthLimit, 0, 255),
    nodesLimit: integer(tc.nodesLimit, 0, 1000000000000)
  };
}
export function needsManualStop(tc: TimeControl): boolean {
  return tc.mode === 'infinite' && tc.depthLimit === 0 && tc.nodesLimit === 0;
}
export function newGameClocks(tc: TimeControl): ClockTimes {
  const ms = Math.floor(sanitizeTimeControl(tc).initialSeconds * 1000);
  return { white: ms, black: ms };
}
export function timeSpent(remainingMs: number, elapsedMs: number, incrementMs: number): number {
  return Math.max(0, Math.floor(remainingMs) - Math.max(0, Math.floor(elapsedMs))) +
    Math.max(0, Math.floor(incrementMs));
}
export function buildGoCommand(tc: TimeControl, clocks: ClockTimes): string {
  const control = sanitizeTimeControl(tc);
  switch (control.mode) {
    case 'clock': {
      const wtime = integer(clocks.white, 0, 86400000);
      const btime = integer(clocks.black, 0, 86400000);
      const inc = integer(control.incrementSeconds * 1000, 0, 3600000);
      return 'go wtime ' + wtime + ' btime ' + btime + ' winc ' + inc + ' binc ' + inc;
    }
    case 'movetime':
      return 'go movetime ' + control.movetimeMs;
    case 'infinite': {
      const limits = [
        control.depthLimit > 0 ? 'depth ' + control.depthLimit : null,
        control.nodesLimit > 0 ? 'nodes ' + control.nodesLimit : null
      ].filter(Boolean);
      return limits.length ? 'go ' + limits.join(' ') : 'go infinite';
    }
  }
}
export function formatClock(milliseconds: number): string {
  const ms = Math.max(0, Math.floor(milliseconds));
  const whole = Math.floor(ms / 1000);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return minutes.toString().padStart(2, '0') + ':' + seconds.toString().padStart(2, '0') +
    (ms < 60000 ? '.' + Math.floor((ms % 1000) / 100).toString() : '');
}
