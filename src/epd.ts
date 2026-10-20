import { Chess } from 'chess.js';
import type { TournamentGame } from './tournament';

export interface EpdBookSample {
  path: string;
  fileName: string;
  totalLines: number;
  candidateLines: number;
  positions: string[];
}
export interface EpdBook {
  path: string;
  name: string;
  totalLines: number;
  candidateLines: number;
  sampledLines: number;
  usablePositions: string[];
  rejectedSamples: number;
}
export type OpeningMode = 'startpos' | 'epd';

/**
 * The Rust backend uses a uniform reservoir across all syntactically plausible
 * .epd records. Validate the bounded sample with chess.js on the frontend so
 * FENs lacking kings, already-finished games, etc. never start a tournament.
 */
export function makeEpdBook(sample: EpdBookSample): EpdBook {
  const usablePositions: string[] = [];
  let rejectedSamples = 0;
  for (const raw of sample.positions) {
    try {
      const game = new Chess(raw);
      if (game.isGameOver()) {
        rejectedSamples++;
        continue;
      }
      usablePositions.push(game.fen());
    } catch {
      rejectedSamples++;
    }
  }
  if (usablePositions.length === 0) {
    throw new Error('No playable FEN found in the sampled EPD records. Check that the book contains legal, non-terminal positions.');
  }
  return {
    path: sample.path,
    name: sample.fileName,
    totalLines: sample.totalLines,
    candidateLines: sample.candidateLines,
    sampledLines: sample.positions.length,
    usablePositions,
    rejectedSamples
  };
}

/** Secure, uniform random index without floating-point/Math.random dependence. */
export function randomBookIndex(length: number): number {
  if (!Number.isSafeInteger(length) || length < 1 || length >= 0x100000000) {
    throw new Error('Opening book has an invalid candidate count.');
  }
  const upper = 0x100000000;
  const limit = Math.floor(upper / length) * length;
  let n: number;
  do {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    n = values[0];
  } while (n >= limit);
  return n % length;
}

/**
 * Sample one opening per scheduled game, but reuse it for the reverse-color
 * leg of the same pairing. Store FEN on the schedule, so resuming/refreshing
 * an event cannot accidentally choose a different opening.
 */
export function assignOpeningPositions(
  schedule: TournamentGame[],
  bookPositions: string[],
  usePairedOpenings: boolean
): TournamentGame[] {
  if (bookPositions.length === 0) throw new Error('Select a nonempty EPD opening book.');
  const assigned = new Map<string, string>();
  return schedule.map(game => {
    const key = game.openingPairKey;
    let openingFen = usePairedOpenings && key ? assigned.get(key) : undefined;
    if (!openingFen) {
      openingFen = bookPositions[randomBookIndex(bookPositions.length)];
      if (usePairedOpenings && key) assigned.set(key, openingFen);
    }
    return { ...game, openingFen };
  });
}
