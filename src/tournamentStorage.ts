/**
 * IndexedDB event journal. Store one immutable schedule and write only tiny
 * progress/result/snapshot records after that; a 50,000-game event does not
 * rewrite its entire schedule on every move.
 *
 * Local/offline only. Nothing is uploaded or transmitted to any server.
 */
import type { TournamentGame, TournamentRun, TournamentStatus } from './tournament';
import type { ClockTimes } from './timeControls';
import type { EngineEntry } from './engines';

const DATABASE = 'chess-xray-tournament-v1';
const VERSION = 1;
const ACTIVE_EVENT_KEY = 'chess-xray-active-tournament-id';
const stores = {
  events: 'events',
  progress: 'progress',
  results: 'results',
  snapshots: 'snapshots'
} as const;

export interface GameSnapshot {
  id: string;
  number: number;
  initialFen: string;
  moves: string[];
  clocks: ClockTimes;
  savedAt: number;
}
interface StoredEvent {
  id: string;
  run: TournamentRun;
  createdAt: number;
}
interface StoredProgress {
  id: string;
  status: TournamentStatus;
  index: number;
  updatedAt: number;
}
interface StoredGameResult {
  key: string;
  eventId: string;
  number: number;
  outcome: NonNullable<TournamentGame['outcome']>;
  termination: string;
  pgn: string;
}
export interface RecoveredTournament {
  run: TournamentRun;
  snapshot: GameSnapshot | null;
  interrupted: boolean;
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.addEventListener('complete', () => resolve(), { once: true });
    tx.addEventListener('abort', () => reject(tx.error || new Error('Database transaction aborted')), { once: true });
    tx.addEventListener('error', () => reject(tx.error || new Error('Database transaction failed')), { once: true });
  });
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Database request failed'));
  });
}
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(stores.events))
        db.createObjectStore(stores.events, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(stores.progress))
        db.createObjectStore(stores.progress, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(stores.results)) {
        const gameStore = db.createObjectStore(stores.results, { keyPath: 'key' });
        gameStore.createIndex('eventId', 'eventId', { unique: false });
      }
      if (!db.objectStoreNames.contains(stores.snapshots))
        db.createObjectStore(stores.snapshots, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Unable to open IndexedDB'));
    req.onblocked = () => reject(new Error('Tournament database is locked by another app instance'));
  });
}

export async function startSavedTournament(run: TournamentRun): Promise<void> {
  const db = await openDatabase();
  try {
    const tx = db.transaction([stores.events, stores.progress, stores.snapshots], 'readwrite');
    const finished = complete(tx);
    const event: StoredEvent = { id: run.id, run: { ...run, schedule: run.schedule.map(g => ({
      ...g, outcome: undefined, termination: undefined, pgn: undefined
    })) }, createdAt: Date.now() };
    const progress: StoredProgress = {
      id: run.id, status: run.status, index: run.index, updatedAt: Date.now()
    };
    tx.objectStore(stores.events).put(event);
    tx.objectStore(stores.progress).put(progress);
    tx.objectStore(stores.snapshots).delete(run.id);
    await finished;
    localStorage.setItem(ACTIVE_EVENT_KEY, run.id);
  } finally { db.close(); }
}

export async function saveTournamentStatus(run: TournamentRun): Promise<void> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(stores.progress, 'readwrite');
    const finished = complete(tx);
    tx.objectStore(stores.progress).put({
      id: run.id, index: run.index, status: run.status, updatedAt: Date.now()
    } satisfies StoredProgress);
    await finished;
  } finally { db.close(); }
}

export async function saveCurrentGame(snapshot: GameSnapshot): Promise<void> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(stores.snapshots, 'readwrite');
    const finished = complete(tx);
    tx.objectStore(stores.snapshots).put(snapshot);
    await finished;
  } finally { db.close(); }
}

export async function finishSavedGame(run: TournamentRun, game: TournamentGame): Promise<void> {
  if (!game.outcome || !game.number || game.number > run.schedule.length) {
    throw new Error('Cannot save an unfinished or unknown tournament game.');
  }
  const db = await openDatabase();
  try {
    const tx = db.transaction([stores.progress, stores.results, stores.snapshots], 'readwrite');
    const finished = complete(tx);
    tx.objectStore(stores.results).put({
      key: run.id + ':' + game.number, eventId: run.id,
      number: game.number, outcome: game.outcome,
      termination: game.termination || '', pgn: game.pgn || ''
    } satisfies StoredGameResult);
    tx.objectStore(stores.progress).put({
      id: run.id, index: run.index, status: run.status, updatedAt: Date.now()
    } satisfies StoredProgress);
    tx.objectStore(stores.snapshots).delete(run.id);
    await finished;
  } finally { db.close(); }
}

export async function recoverSavedTournament(): Promise<RecoveredTournament | null> {
  const id = localStorage.getItem(ACTIVE_EVENT_KEY);
  if (!id) return null;
  const db = await openDatabase();
  try {
    const tx = db.transaction([stores.events, stores.progress, stores.results, stores.snapshots], 'readonly');
    const finished = complete(tx);
    const eventPromise = request<StoredEvent | undefined>(tx.objectStore(stores.events).get(id));
    const progressPromise = request<StoredProgress | undefined>(tx.objectStore(stores.progress).get(id));
    const resultsPromise = request<StoredGameResult[]>(
      tx.objectStore(stores.results).index('eventId').getAll(IDBKeyRange.only(id))
    );
    const snapshotPromise = request<GameSnapshot | undefined>(tx.objectStore(stores.snapshots).get(id));
    const [event, progress, results, snapshot] = await Promise.all([
      eventPromise, progressPromise, resultsPromise, snapshotPromise
    ]);
    await finished;
    if (!event || !progress) return null;
    const byNumber = new Map(results.map(game => [game.number, game]));
    const schedule = event.run.schedule.map(game => {
      const saved = byNumber.get(game.number);
      return saved ? {
        ...game, outcome: saved.outcome, termination: saved.termination, pgn: saved.pgn
      } : game;
    });
    const interrupted = progress.status === 'running';
    const status = interrupted ? 'paused' : progress.status;
    const index = Math.max(0, Math.min(progress.index, schedule.length));
    const run = { ...event.run, schedule, index, status };
    const active = snapshot && snapshot.number === index + 1 ? snapshot : null;
    return { run, snapshot: active, interrupted };
  } finally { db.close(); }
}

function tag(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ').slice(0, 240);
}
export function tournamentToPgn(run: TournamentRun, engines: EngineEntry[]): string {
  const name = (id: string) => engines.find(e => e.id === id)?.name || id;
  const games = run.schedule.filter(g => !!g.outcome);
  return games.map(game => {
    const headers = [
      '[Event "' + tag(run.name) + '"]',
      '[Site "Chess X-Ray Local"]',
      '[Round "' + game.round + '"]',
      '[White "' + tag(name(game.whiteId)) + '"]',
      '[Black "' + tag(name(game.blackId)) + '"]',
      '[Result "' + game.outcome + '"]'
    ];
    if (game.termination) headers.push('[Termination "' + tag(game.termination) + '"]');
    if (game.openingFen) {
      headers.push('[SetUp "1"]');
      headers.push('[FEN "' + tag(game.openingFen) + '"]');
    }
    const body = (game.pgn || '').replace(/^\s*\[[^\]]+\]\s*$/gm, '')
      .trim().replace(/\s+(?:1-0|0-1|1\/2-1\/2|\*)\s*$/, '');
    return headers.join('\n') + '\n\n' + (body ? body + ' ' : '') + game.outcome;
  }).join('\n\n\n') + (games.length ? '\n' : '');
}
