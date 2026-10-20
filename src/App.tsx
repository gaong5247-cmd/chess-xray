import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Chess } from 'chess.js';
import appPackage from '../package.json';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Activity, ArrowLeftRight, BarChart3, ChevronRight, CircleHelp, ClipboardCopy,
  Cpu, Download, Eye, FileInput, FolderOpen, Gauge, GitBranch, HardDrive,
  Layers3, Pause, Play, Radio, RotateCcw, Settings2, ShieldCheck, Swords,
  Trophy, Zap, SlidersHorizontal
} from 'lucide-react';
import { ChessBoard, type Arrow, type BoardTheme } from './ChessBoard';
import { assignOpeningPositions, makeEpdBook, type EpdBook, type EpdBookSample, type OpeningMode } from './epd';
import Timeline, { type Metric, type Sample } from './Timeline';
import SearchTree from './SearchTree';
import ControlCenter, {
  type ControlTab, loadLayout, persistLayout, clamp, type LayoutPrefs
} from './ControlCenter';
import {
  type EngineEntry, BUILTIN_ID, loadEngines, saveEngines, parseOptionLine,
  newEngineId, uniqueEngineName
} from './engines';
import {
  createRoundRobin, type TournamentConfig, type TournamentRun, type GameOutcome
} from './tournament';
import {
  type Slot, type UciInfo, type XrayTelemetry,
  fromUci, legalPv, parseUciInfo, parseXrayTelemetry, scoreLabel, shortNumber, whiteEval
} from './uci';
import {
  ANCHOR_NAME, ANCHOR_RATING, loadStandings, recordResult, saveStandings
} from './elo';

type Mode = 'analysis' | 'arena' | 'tournament';
type ArrowMode = 'off' | 'best' | 'top3' | 'hikaru';
type Packet = { slot: Slot | 'inspect'; line: string };
type SlotMap<T> = Record<Slot, T>;
const slots: Slot[] = ['white', 'black'];
const START = new Chess().fen();
const defaultPaths: SlotMap<string> = { white: '__bundled__', black: '__bundled__' };
const defaultNames: SlotMap<string> = { white: ANCHOR_NAME, black: ANCHOR_NAME };
const baseInfo: SlotMap<UciInfo | undefined> = { white: undefined, black: undefined };
const palette = ['#ecf47b', '#47d5ec', '#fa8bbf', '#f2ad66', '#a78bfa', '#73e0b4'];

function Banner({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}
function formatName(name: string) {
  return name.length > 28 ? name.slice(0, 26) + '…' : name;
}
function fileName(path: string) {
  return path === '__bundled__' ? 'Bundled · Stockfish 19'
    : path.split(/[\\/]/).pop() || path;
}

export default function App() {
  const chess = useRef(new Chess());
  const [fen, setFen] = useState(START);
  const [fenInput, setFenInput] = useState(START);
  const [moveSan, setMoveSan] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [mode, setMode] = useState<Mode>('analysis');
  const modeRef = useRef<Mode>('analysis');
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  const [ready, setReady] = useState<SlotMap<boolean>>({ white: false, black: false });
  const readyRef = useRef<SlotMap<boolean>>({ white: false, black: false });
  const searching = useRef<Slot | null>(null);
  const [paths, setPaths] = useState<SlotMap<string>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('chess-xray-engine-paths') || 'null');
      if (value && typeof value === 'object' && 'white' in value && 'black' in value &&
        typeof value.white === 'string' && typeof value.black === 'string') {
        return { white: value.white, black: value.black };
      }
    } catch { /* fresh installation */ }
    return defaultPaths;
  });
  const pathsRef = useRef<SlotMap<string>>(defaultPaths);
  const [names, setNames] = useState<SlotMap<string>>(defaultNames);
  const namesRef = useRef<SlotMap<string>>(defaultNames);
  const [available, setAvailable] = useState(true);
  const [infos, setInfos] = useState<SlotMap<UciInfo | undefined>>(baseInfo);
  const [pvs, setPvs] = useState<SlotMap<UciInfo[]>>({ white: [], black: [] });
  const [telemetry, setTelemetry] = useState<SlotMap<XrayTelemetry | null>>({ white: null, black: null });
  const [samples, setSamples] = useState<Sample[]>([]);
  const lastSample = useRef<SlotMap<number>>({ white: 0, black: 0 });
  const [lines, setLines] = useState<string[]>([]);
  const [standings, setStandings] = useState(loadStandings);
  const [result, setResult] = useState<string | null>(null);
  const [notice, setNotice] = useState('READY · Select ANALYZE to connect the bundled Stockfish 19 engine.');
  const [arrowMode, setArrowMode] = useState<ArrowMode>('best');
  const [selectedSlot, setSelectedSlot] = useState<Slot>('white');
  const [flipped, setFlipped] = useState(false);
  const [boardTheme, setBoardTheme] = useState<BoardTheme>('broadcast');
  const [metric, setMetric] = useState<Metric>('eval');
  const [multipv, setMultipv] = useState(3);
  const [depth, setDepth] = useState(14);
  const [threads, setThreads] = useState(2);
  const [hash, setHash] = useState(128);
  const [epdBook, setEpdBook] = useState<EpdBook | null>(null);
  const [epdLoading, setEpdLoading] = useState(false);
  const [epdError, setEpdError] = useState<string | null>(null);
  const bookRequest = useRef(0);
  const [openingMode, setOpeningMode] = useState<OpeningMode>(() =>
    localStorage.getItem('chess-xray-opening-mode') === 'epd' ? 'epd' : 'startpos');
  const [pairBookColors, setPairBookColors] = useState(() =>
    localStorage.getItem('chess-xray-paired-epd') !== 'false');
  const [controlTab, setControlTab] = useState<ControlTab | null>(null);
  const [layout, setLayout] = useState<LayoutPrefs>(loadLayout);
  const [engines, setEngines] = useState<EngineEntry[]>(loadEngines);
  const enginesRef = useRef<EngineEntry[]>(engines);
  const assignedRef = useRef<SlotMap<string>>({ white: BUILTIN_ID, black: BUILTIN_ID });
  const inspectingRef = useRef<string | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [tournament, setTournament] = useState<TournamentRun | null>(null);
  const tournamentRef = useRef<TournamentRun | null>(null);
  const nextTournamentGameRef = useRef<((resume: boolean) => Promise<void>) | null>(null);
  const config = useRef({ multipv, depth, threads, hash });
  useEffect(() => { config.current = { multipv, depth, threads, hash }; }, [multipv, depth, threads, hash]);
  useEffect(() => { pathsRef.current = paths; localStorage.setItem('chess-xray-engine-paths', JSON.stringify(paths)); }, [paths]);
  useEffect(() => { namesRef.current = names; }, [names]);
  useEffect(() => {
    enginesRef.current = engines;
    saveEngines(engines);
  }, [engines]);
  useEffect(() => { persistLayout(layout); }, [layout]);
  useEffect(() => {
    localStorage.setItem('chess-xray-opening-mode', openingMode);
  }, [openingMode]);
  useEffect(() => {
    localStorage.setItem('chess-xray-paired-epd', String(pairBookColors));
  }, [pairBookColors]);

  const loadBookFromPath = useCallback(async (path: string, enableEpd: boolean): Promise<void> => {
    const request = ++bookRequest.current;
    setEpdLoading(true);
    setEpdError(null);
    try {
      const scanned = await invoke<EpdBookSample>('load_epd_book', { path });
      const loaded = makeEpdBook(scanned);
      if (request !== bookRequest.current) return;
      setEpdBook(loaded);
      localStorage.setItem('chess-xray-epd-path', path);
      if (enableEpd) setOpeningMode('epd');
      setNotice('EPD BOOK LOADED · ' + loaded.name + ' · ' + loaded.usablePositions.length +
        ' playable FENs sampled from ' + loaded.candidateLines + ' candidate lines.');
    } catch (error) {
      if (request !== bookRequest.current) return;
      const message = String(error);
      setEpdBook(null);
      setEpdError(message);
      setNotice('EPD BOOK ERROR · ' + message);
    } finally {
      if (request === bookRequest.current) setEpdLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('chess-xray-epd-path');
    if (saved) void loadBookFromPath(saved, false);
  }, [loadBookFromPath]);

  const chooseEpdBook = async (): Promise<void> => {
    try {
      const path = await open({
        multiple: false, directory: false,
        filters: [{ name: 'EPD opening positions', extensions: ['epd'] }]
      });
      if (typeof path === 'string') await loadBookFromPath(path, true);
    } catch (error) {
      setEpdError(String(error));
    }
  };
  const reloadEpdBook = async (): Promise<void> => {
    if (epdBook) await loadBookFromPath(epdBook.path, false);
  };
  const clearEpdBook = () => {
    bookRequest.current++;
    setEpdLoading(false);
    setEpdBook(null);
    setEpdError(null);
    setOpeningMode('startpos');
    localStorage.removeItem('chess-xray-epd-path');
    setNotice('EPD BOOK CLEARED · Tournament games will use the standard starting position.');
  };

  const send = useCallback(async (slot: Slot, command: string) => {
    try {
      await invoke('send_uci', { slot, command });
    } catch (error) {
      setNotice('UCI ERROR · ' + String(error));
    }
  }, []);

  const stopEngines = useCallback(async () => {
    liveRef.current = false;
    searching.current = null;
    setLive(false);
    readyRef.current = { white: false, black: false };
    setReady({ white: false, black: false });
    await Promise.all(slots.map(async slot => {
      try { await invoke('stop_engine', { slot }); } catch { /* engine not active */ }
    }));
  }, []);

  const searchAnalysis = useCallback(async () => {
    if (!liveRef.current || modeRef.current !== 'analysis' || !readyRef.current.white) return;
    await send('white', 'stop');
    await send('white', 'position fen ' + chess.current.fen());
    await send('white', 'go infinite');
  }, [send]);

  const requestArenaMove = useCallback(async () => {
    if (!liveRef.current || !['arena', 'tournament'].includes(modeRef.current)) return;
    const slot: Slot = chess.current.turn() === 'w' ? 'white' : 'black';
    if (!readyRef.current[slot] || searching.current) return;
    searching.current = slot;
    await send(slot, 'position fen ' + chess.current.fen());
    const think = modeRef.current === 'tournament' && tournamentRef.current
      ? 'go movetime ' + tournamentRef.current.movetime
      : 'go depth ' + config.current.depth;
    await send(slot, think);
  }, [send]);

  const commitMove = useCallback((from: string, to: string, promotion = 'q') => {
    try {
      const move = chess.current.move({ from, to, promotion });
      if (!move) return false;
      setFen(chess.current.fen());
      setFenInput(chess.current.fen());
      setMoveSan(chess.current.history());
      setLastMove([from, to]);
      setPvs({ white: [], black: [] });
      setInfos({ white: undefined, black: undefined });
      return true;
    } catch { return false; }
  }, []);

  const finishArena = useCallback((moveCap = false) => {
    const game = chess.current;
    let whitePoints: 0 | 0.5 | 1 = 0.5;
    if (game.isCheckmate() && !moveCap) whitePoints = game.turn() === 'w' ? 0 : 1;
    const label = game.isCheckmate() && !moveCap
      ? 'CHECKMATE · ' + (whitePoints === 1 ? 'WHITE WINS' : 'BLACK WINS')
      : moveCap ? 'DRAW · MAX PLY LIMIT'
      : 'DRAW · ' + (game.isStalemate() ? 'STALEMATE' : 'REPETITION / RULE');
    const outcome: GameOutcome = whitePoints === 1 ? '1-0' : whitePoints === 0 ? '0-1' : '1/2-1/2';
    setResult(label);
    searching.current = null;
    liveRef.current = false;
    setLive(false);
    const next = recordResult(loadStandings(), namesRef.current.white, namesRef.current.black, whitePoints);
    saveStandings(next);
    setStandings(next);
    slots.forEach(slot => { void send(slot, 'stop'); });
    const running = tournamentRef.current;
    if (modeRef.current === 'tournament' && running && running.status === 'running') {
      const index = running.index;
      const schedule = running.schedule.map((item, idx) =>
        idx === index ? { ...item, outcome, termination: label, pgn: game.pgn() } : item);
      const finished = index + 1 >= schedule.length;
      const updated: TournamentRun = {
        ...running, index: index + 1, schedule, status: finished ? 'completed' : 'running'
      };
      tournamentRef.current = updated;
      setTournament(updated);
      setNotice(finished
        ? 'TOURNAMENT COMPLETED · ' + updated.schedule.length + ' games finished and rated.'
        : 'TOURNAMENT · Game ' + (index + 1) + ' finished (' + outcome + '). Advancing to next pairing.');
      if (!finished) window.setTimeout(() => {
        const current = tournamentRef.current;
        if (current?.status === 'running' && current.index === index + 1) {
          void nextTournamentGameRef.current?.(false);
        }
      }, 350);
    } else {
      setNotice(label + ' · Game recorded in local standings.');
    }
  }, [send]);

  const handleLine = useCallback((packet: Packet) => {
    const { slot, line } = packet;
    if (slot === 'inspect') {
      const id = inspectingRef.current;
      if (!id) return;
      const parsed = parseOptionLine(line);
      if (parsed) setEngines(previous => previous.map(engine => {
        if (engine.id !== id) return engine;
        const options = engine.availableOptions.filter(opt => opt.name !== parsed.name);
        return { ...engine, availableOptions: [...options, parsed] };
      }));
      if (line === 'uciok') {
        inspectingRef.current = null;
        setInspectingId(null);
        setNotice('UCI INSPECTION COMPLETED · Available engine options have been saved.');
        void invoke('stop_engine', { slot: 'inspect' });
      }
      return;
    }
    if (modeRef.current !== 'tournament' && line.startsWith('id name ')) {
      const rawName = line.slice('id name '.length).trim();
      const name = /^Stockfish 19(\s|$)/i.test(rawName) ? ANCHOR_NAME : rawName;
      namesRef.current = { ...namesRef.current, [slot]: name };
      setNames(prev => ({ ...prev, [slot]: name }));
    }
    if (line === 'uciok') {
      void (async () => {
        await send(slot, 'setoption name Threads value ' + config.current.threads);
        await send(slot, 'setoption name Hash value ' + config.current.hash);
        await send(slot, 'setoption name MultiPV value ' +
          (modeRef.current === 'analysis' && slot === 'white' ? config.current.multipv : 1));
        const entry = enginesRef.current.find(e => e.id === assignedRef.current[slot]);
        if (entry) for (const [key, value] of Object.entries(entry.options)) {
          if (!key.includes('\n') && !key.includes('\r') &&
              !value.includes('\n') && !value.includes('\r')) {
            await send(slot, 'setoption name ' + key + ' value ' + value);
          }
        }
        await send(slot, 'isready');
      })();
    }
    if (line === 'readyok') {
      readyRef.current = { ...readyRef.current, [slot]: true };
      setReady({ ...readyRef.current });
      if (liveRef.current && modeRef.current === 'analysis' && slot === 'white') {
        void searchAnalysis();
      } else if (liveRef.current && (modeRef.current === 'arena' || modeRef.current === 'tournament')) {
        void requestArenaMove();
      }
    }
    const xray = parseXrayTelemetry(line);
    if (xray) setTelemetry(prev => ({ ...prev, [slot]: xray }));
    const info = parseUciInfo(line);
    if (info && (info.depth !== undefined || info.pv.length > 0)) {
      if (info.multipv === 1) {
        setInfos(prev => ({ ...prev, [slot]: info }));
        const score = whiteEval(info, chess.current.turn());
        const now = Date.now();
        if (score !== null && now - lastSample.current[slot] > 160) {
          lastSample.current[slot] = now;
          setSamples(prev => [...prev, {
            slot, score, depth: info.depth ?? 0, nodes: info.nodes ?? 0,
            nps: info.nps ?? 0, hash: info.hashfull ?? 0, time: info.time ?? 0
          }].slice(-320));
        }
      }
      if (info.pv.length > 0) {
        setPvs(prev => {
          const old = prev[slot].filter(item => item.multipv !== info.multipv);
          return { ...prev, [slot]: [...old, info].sort((a, b) => a.multipv - b.multipv).slice(0, 12) };
        });
      }
    }
    if (line.startsWith('bestmove ') && (modeRef.current === 'arena' || modeRef.current === 'tournament') &&
      liveRef.current && searching.current === slot) {
      searching.current = null;
      const move = fromUci(line.split(/\s+/)[1] || '');
      if (!move || !commitMove(move.from, move.to, move.promotion)) {
        setNotice('ENGINE ERROR · Illegal or unavailable bestmove from ' + namesRef.current[slot]);
        liveRef.current = false;
        setLive(false);
        return;
      }
      const reachedLimit = modeRef.current === 'tournament' && tournamentRef.current !== null &&
        chess.current.history().length >= tournamentRef.current.maxPlies;
      if (chess.current.isGameOver() || reachedLimit) finishArena(reachedLimit);
      else void requestArenaMove();
    }
    if (line.startsWith('info ') || line.startsWith('bestmove ')) {
      setLines(prev => [slot.toUpperCase() + '  ' + line, ...prev].slice(0, 85));
    }
  }, [commitMove, finishArena, requestArenaMove, searchAnalysis, send]);

  useEffect(() => {
    const unlisten: UnlistenFn[] = [];
    let cancelled = false;
    Promise.all([
      listen<Packet>('uci-line', event => handleLine(event.payload)),
      listen<Slot | 'inspect'>('uci-closed', event => {
        const slot = event.payload;
        if (slot === 'inspect') {
          if (inspectingRef.current) setNotice('UCI INSPECTION CLOSED before engine handshake completed.');
          inspectingRef.current = null;
          setInspectingId(null);
          return;
        }
        readyRef.current = { ...readyRef.current, [slot]: false };
        setReady({ ...readyRef.current });
      }),
      listen<Packet>('uci-stderr', event => {
        setLines(prev => [event.payload.slot.toUpperCase() + ' [stderr] ' + event.payload.line, ...prev].slice(0, 85));
      })
    ]).then(fns => { if (cancelled) fns.forEach(fn => fn()); else unlisten.push(...fns); })
      .catch(error => setNotice('ENGINE EVENTS · ' + String(error)));
    invoke<boolean>('bundled_engine_available').then(setAvailable).catch(() => setAvailable(false));
    return () => { cancelled = true; unlisten.forEach(fn => fn()); };
  }, [handleLine]);

  const clearTelemetry = () => {
    setPvs({ white: [], black: [] });
    setInfos({ white: undefined, black: undefined });
    setTelemetry({ white: null, black: null });
    setSamples([]);
    setLines([]);
    setResult(null);
  };
  const resetGame = async () => {
    await stopEngines();
    chess.current = new Chess();
    setFen(START);
    setFenInput(START);
    setLastMove(null);
    setMoveSan([]);
    clearTelemetry();
    setNotice('BOARD RESET · Select ANALYZE to begin.');
  };
  const startAnalysis = async () => {
    await stopEngines();
    modeRef.current = 'analysis';
    setMode('analysis');
    clearTelemetry();
    liveRef.current = true;
    setLive(true);
    setNotice('CONNECTING · Starting UCI analysis session…');
    try {
      await invoke('launch_engine', { slot: 'white', path: pathsRef.current.white });
    } catch (error) {
      liveRef.current = false;
      setLive(false);
      setNotice('ENGINE START FAILED · ' + String(error));
    }
  };
  const startArena = async () => {
    await stopEngines();
    chess.current = new Chess();
    setFen(START);
    setFenInput(START);
    setMoveSan([]);
    setLastMove(null);
    clearTelemetry();
    modeRef.current = 'arena';
    setMode('arena');
    liveRef.current = true;
    setLive(true);
    setNotice('ARENA LIVE · Starting two independent UCI processes…');
    try {
      await Promise.all(slots.map(slot =>
        invoke('launch_engine', { slot, path: pathsRef.current[slot] })));
    } catch (error) {
      setNotice('MATCH START FAILED · ' + String(error));
      await stopEngines();
    }
  };
  const launchTournamentGame = async (resume: boolean): Promise<void> => {
    const current = tournamentRef.current;
    if (!current || current.status !== 'running') return;
    const pairing = current.schedule[current.index];
    if (!pairing) return;
    const whiteEntry = enginesRef.current.find(e => e.id === pairing.whiteId);
    const blackEntry = enginesRef.current.find(e => e.id === pairing.blackId);
    if (!whiteEntry || !blackEntry) {
      tournamentRef.current = { ...current, status: 'paused' };
      setTournament(tournamentRef.current);
      setNotice('TOURNAMENT PAUSED · An entrant is missing from the engine library.');
      return;
    }
    await stopEngines();
    if (tournamentRef.current?.status !== 'running') return;
    if (!resume) {
      const opening = pairing.openingFen || START;
      chess.current = new Chess(opening);
      setFen(chess.current.fen());
      setFenInput(chess.current.fen());
      setMoveSan([]);
      setLastMove(null);
    }
    const selectedPaths = { white: whiteEntry.path, black: blackEntry.path };
    const selectedNames = { white: whiteEntry.name, black: blackEntry.name };
    pathsRef.current = selectedPaths;
    namesRef.current = selectedNames;
    assignedRef.current = { white: whiteEntry.id, black: blackEntry.id };
    setPaths(selectedPaths);
    setNames(selectedNames);
    clearTelemetry();
    modeRef.current = 'tournament';
    setMode('tournament');
    searching.current = null;
    liveRef.current = true;
    setLive(true);
    setNotice('TOURNAMENT LIVE · Game ' + pairing.number + '/' + current.schedule.length
      + ' · ' + whiteEntry.name + ' vs ' + blackEntry.name
      + (pairing.openingFen ? ' · EPD book position' : ' · Standard start')
      + (resume ? ' (resumed)' : ''));
    try {
      await Promise.all(slots.map(slot => invoke('launch_engine', {
        slot, path: selectedPaths[slot]
      })));
    } catch (error) {
      const prior = tournamentRef.current;
      if (prior) {
        tournamentRef.current = { ...prior, status: 'paused' };
        setTournament(tournamentRef.current);
      }
      await stopEngines();
      setNotice('TOURNAMENT PAUSED · Engine launch failed: ' + String(error));
    }
  };
  nextTournamentGameRef.current = launchTournamentGame;

  const startTournament = async (settings: TournamentConfig): Promise<void> => {
    const unique = [...new Set(settings.entrants)];
    if (unique.length < 2) throw new Error('Add and select at least 2 different engines.');
    if (unique.some(id => !enginesRef.current.some(engine => engine.id === id))) {
      throw new Error('Every tournament participant must exist in the Engines library.');
    }
    if (epdLoading) throw new Error('Finish loading the EPD book before starting the tournament.');
    if (openingMode === 'epd' && !epdBook) {
      throw new Error('Choose a valid EPD opening book first.');
    }
    const planned = createRoundRobin({ ...settings, entrants: unique });
    const schedule = openingMode === 'epd' && epdBook
      ? assignOpeningPositions(planned, epdBook.usablePositions, pairBookColors)
      : planned;
    if (!schedule.length) throw new Error('Could not generate a tournament schedule.');
    await stopEngines();
    const run: TournamentRun = {
      id: 'event-' + Date.now(), name: 'Chess X-Ray Round Robin',
      entries: unique, schedule, index: 0, status: 'running',
      movetime: clamp(settings.movetime, 100, 60000),
      maxPlies: clamp(settings.maxPlies, 40, 600),
      openingBookName: openingMode === 'epd' ? epdBook?.name : undefined
    };
    tournamentRef.current = run;
    setTournament(run);
    await launchTournamentGame(false);
  };
  const pauseTournament = async (): Promise<void> => {
    const run = tournamentRef.current;
    if (!run || run.status !== 'running') return;
    tournamentRef.current = { ...run, status: 'paused' };
    setTournament(tournamentRef.current);
    await stopEngines();
    setNotice('TOURNAMENT PAUSED · Resume will restart engines from the current board position.');
  };
  const resumeTournament = async (): Promise<void> => {
    const run = tournamentRef.current;
    if (!run || run.status !== 'paused') return;
    tournamentRef.current = { ...run, status: 'running' };
    setTournament(tournamentRef.current);
    await launchTournamentGame(true);
  };
  const stopTournament = async (): Promise<void> => {
    const run = tournamentRef.current;
    if (run) {
      tournamentRef.current = { ...run, status: 'stopped' };
      setTournament(tournamentRef.current);
    }
    await stopEngines();
    setNotice('TOURNAMENT STOPPED · Finished games remain in the local rating table.');
  };
  const switchMode = async (next: 'analysis' | 'arena') => {
    if (tournamentRef.current?.status === 'running') await pauseTournament();
    else await stopEngines();
    modeRef.current = next;
    setMode(next);
  };

  const addEngine = async (): Promise<void> => {
    try {
      const picked = await open({ multiple: false, directory: false,
        filters: [{ name: 'UCI Chess Engine', extensions: ['exe'] }] });
      if (typeof picked !== 'string') return;
      const name = uniqueEngineName(enginesRef.current, fileName(picked).replace(/\.exe$/i, ''));
      const created: EngineEntry = {
        id: newEngineId(), name, path: picked, options: {}, availableOptions: []
      };
      enginesRef.current = [...enginesRef.current, created];
      setEngines(enginesRef.current);
      setNotice('ENGINE ADDED · ' + name + '. Open Engines to inspect its UCI options.');
    } catch (error) { setNotice('ENGINE IMPORT FAILED · ' + String(error)); }
  };
  const removeEngine = (id: string) => {
    if (tournamentRef.current?.status === 'running' || tournamentRef.current?.status === 'paused') {
      setNotice('STOP THE TOURNAMENT before removing registered entrants.');
      return;
    }
    if (id === BUILTIN_ID) return;
    enginesRef.current = enginesRef.current.filter(x => x.id !== id);
    setEngines(enginesRef.current);
  };
  const renameEngine = (id: string, name: string) => {
    if (id === BUILTIN_ID) return;
    enginesRef.current = enginesRef.current.map(e => e.id === id ? { ...e, name: name.slice(0, 80) } : e);
    setEngines(enginesRef.current);
  };
  const editEngineOption = (id: string, name: string, value: string) => {
    enginesRef.current = enginesRef.current.map(engine => engine.id === id ? {
      ...engine, options: { ...engine.options, [name]: value.slice(0, 200) }
    } : engine);
    setEngines(enginesRef.current);
  };
  const inspectEngine = async (id: string): Promise<void> => {
    const entry = enginesRef.current.find(engine => engine.id === id);
    if (!entry || inspectingRef.current) return;
    inspectingRef.current = id;
    setInspectingId(id);
    enginesRef.current = enginesRef.current.map(engine =>
      engine.id === id ? { ...engine, availableOptions: [] } : engine);
    setEngines(enginesRef.current);
    setNotice('READING UCI OPTIONS · ' + entry.name);
    try {
      await invoke('launch_engine', { slot: 'inspect', path: entry.path });
    } catch (error) {
      inspectingRef.current = null;
      setInspectingId(null);
      setNotice('UCI INSPECTION FAILED · ' + String(error));
    }
  };
  const assignEngine = (id: string, slot: Slot) => {
    const entry = enginesRef.current.find(engine => engine.id === id);
    if (!entry) return;
    if (tournamentRef.current?.status === 'running') {
      setNotice('PAUSE THE TOURNAMENT before assigning a new active engine.');
      return;
    }
    if (liveRef.current) void stopEngines();
    assignedRef.current = { ...assignedRef.current, [slot]: id };
    pathsRef.current = { ...pathsRef.current, [slot]: entry.path };
    namesRef.current = { ...namesRef.current, [slot]: entry.name };
    setPaths(pathsRef.current);
    setNames(namesRef.current);
    setNotice(entry.name + ' assigned to ' + slot + '. Restart UCI analysis/match to apply.');
  };

  const chooseEngine = async (slot: Slot) => {
    try {
      const picked = await open({ multiple: false, directory: false,
        filters: [{ name: 'Windows chess engine executable', extensions: ['exe'] }] });
      if (typeof picked !== 'string') return;
      if (liveRef.current) await stopEngines();
      setPaths(prev => ({ ...prev, [slot]: picked }));
      const same = enginesRef.current.find(entry => entry.path === picked);
      const entry: EngineEntry = same || {
        id: newEngineId(),
        name: uniqueEngineName(enginesRef.current, fileName(picked).replace(/\.exe$/i, '')),
        path: picked, options: {}, availableOptions: []
      };
      if (!same) {
        enginesRef.current = [...enginesRef.current, entry];
        setEngines(enginesRef.current);
      }
      assignedRef.current = { ...assignedRef.current, [slot]: entry.id };
      setNames(prev => ({ ...prev, [slot]: entry.name }));
      namesRef.current = { ...namesRef.current, [slot]: entry.name };
      setNotice('ENGINE SELECTED · ' + fileName(picked) + '. Restart analysis or arena.');
    } catch (error) { setNotice('FILE PICKER · ' + String(error)); }
  };
  const loadFen = async () => {
    try {
      const next = new Chess(fenInput.trim());
      await stopEngines();
      chess.current = next;
      setFen(next.fen());
      setMoveSan(next.history());
      setLastMove(null);
      clearTelemetry();
      setNotice('FEN LOADED · Position validated; press ANALYZE.');
    } catch (error) { setNotice('INVALID FEN · ' + String(error)); }
  };
  const manualMove = (from: string, to: string) => {
    if (modeRef.current !== 'analysis' && liveRef.current) return;
    if (commitMove(from, to)) {
      setPvs({ white: [], black: [] });
      setInfos({ white: undefined, black: undefined });
      if (liveRef.current) void searchAnalysis();
    }
  };
  const exportPgn = async () => {
    const pgn = chess.current.pgn();
    try {
      await navigator.clipboard.writeText(pgn || chess.current.fen());
      setNotice('COPIED · ' + (pgn ? 'PGN' : 'FEN') + ' copied to clipboard.');
    } catch { setNotice('CLIPBOARD NOT AVAILABLE · Try copying FEN manually.'); }
  };

  const activeSlot: Slot = mode === 'analysis' ? 'white' : selectedSlot;
  const primary = infos[activeSlot];
  const turn = chess.current.turn();
  const evaluation = whiteEval(primary, turn);
  const blackPct = evaluation === null ? 50 : Math.max(3, Math.min(97, 50 - evaluation / 18));
  const mainArrows = useMemo<Arrow[]>(() => {
    if (arrowMode === 'off') return [];
    const currentPvs = pvs[mode === 'analysis' ? 'white' : selectedSlot];
    if (arrowMode === 'best') {
      const move = fromUci(currentPvs[0]?.pv[0] || '');
      return move ? [{ from: move.from, to: move.to, color: palette[0], width: 14 }] : [];
    }
    const result: Arrow[] = [];
    const maxPv = arrowMode === 'hikaru' ? 5 : 3;
    const maxPly = arrowMode === 'hikaru' ? 9 : 1;
    currentPvs.slice(0, maxPv).forEach((pv, index) => {
      const legal = legalPv(fen, pv.pv, maxPly);
      legal.uci.forEach((uci, j) => {
        const move = fromUci(uci);
        if (move) result.push({
          from: move.from, to: move.to,
          color: palette[(index + j) % palette.length],
          opacity: arrowMode === 'hikaru' ? 0.37 + (j < 2 ? 0.28 : 0) : 0.75,
          width: arrowMode === 'hikaru' ? 8 : 11
        });
      });
    });
    return result;
  }, [arrowMode, fen, mode, pvs, selectedSlot]);

  const currentPvs = pvs[activeSlot];
  const engineMetrics = [
    { label: 'DEPTH / SEL', value: (primary?.depth ?? '—') + ' / ' + (primary?.seldepth ?? '—'), icon: <Layers3 size={16} /> },
    { label: 'SEARCH NODES', value: shortNumber(primary?.nodes), icon: <GitBranch size={16} /> },
    { label: 'SPEED', value: shortNumber(primary?.nps) + ' n/s', icon: <Zap size={16} /> },
    { label: 'HASH OCCUPANCY', value: primary?.hashfull === undefined ? '—' : (primary.hashfull / 10).toFixed(1) + '%', icon: <HardDrive size={16} /> },
    { label: 'TABLEBASE HITS', value: shortNumber(primary?.tbhits), icon: <ShieldCheck size={16} /> },
    { label: 'TIME', value: primary?.time === undefined ? '—' : (primary.time / 1000).toFixed(1) + 's', icon: <Gauge size={16} /> }
  ];
  const xray = telemetry[activeSlot];
  const xrayItems = [
    { label: 'TT HIT RATE', value: xray?.ttHits !== undefined && xray.ttProbes ? (100 * xray.ttHits / xray.ttProbes).toFixed(1) + '%' : 'UNAVAILABLE' },
    { label: 'BETA CUTOFFS', value: shortNumber(xray?.betaCutoffs) },
    { label: 'NULL MOVE CUTS', value: shortNumber(xray?.nullMoveCuts) },
    { label: 'LMR REDUCTIONS', value: shortNumber(xray?.lmrReductions) }
  ];

  return <div className={'app-root' + (layout.boardFocus ? ' board-focus' : '')}
    style={{
      '--pv-width': 'min(' + layout.pvWidth + 'px, max(300px, calc(100vw - 820px)))',
      '--board-max': layout.boardSize + 'px',
      '--pv-mini': layout.pvBoardSize + 'px',
      '--pv-font': layout.pvFontSize + 'px'
    } as CSSProperties}>
    <header className="topbar">
      <nav className="app-menubar" aria-label="Main application menu">
        <button onClick={() => setControlTab('configure')}><SlidersHorizontal size={14}/> Configure</button>
        <button onClick={() => setControlTab('tournament')}><Trophy size={14}/> Tournament</button>
        <button onClick={() => setControlTab('engines')}><Cpu size={14}/> Engines</button>
      </nav>
      <div className="brand"><div className="brand-mark"><Eye size={21} /></div>
        <div><b>CHESS<span>X-RAY</span></b><small>ENGINE OBSERVATORY</small></div></div>
      <nav className="topnav" aria-label="Application modes">
        <button className={mode === 'analysis' ? 'nav-active' : ''} onClick={() => void switchMode('analysis')}>
          <Activity size={16} /> Analysis</button>
        <button className={mode === 'arena' ? 'nav-active' : ''} onClick={() => void switchMode('arena')}>
          <Swords size={16} /> Arena</button>
        <button className={mode === 'tournament' ? 'nav-active' : ''} onClick={() => setControlTab('tournament')}>
          <Trophy size={16} /> Event</button>
      </nav>
      <div className="top-actions"><span className="version-pill">v{appPackage.version}</span>
        <span className={'live-pill' + (live ? ' live' : '')}><i /> {live ? 'LIVE SESSION' : 'STANDBY'}</span></div>
    </header>

    <div className="workspace">
      <aside className="sidebar left-sidebar">
        <div className="sidebar-section">
          <Banner>ENGINE CONTROL</Banner>
          {slots.map(slot => <div className="engine-picker" key={slot}>
            <div className="picker-heading"><span className={'slot-dot ' + slot} /> {slot.toUpperCase()} ENGINE
              <span className={'connection ' + (ready[slot] ? 'ok' : '')}>{ready[slot] ? 'READY' : 'OFFLINE'}</span></div>
            <strong title={names[slot]}>{formatName(names[slot])}</strong>
            <div className="engine-path">{fileName(paths[slot])}</div>
            <div className="picker-actions">
              <button onClick={() => setControlTab('engines')}><Cpu size={14} /> Library</button>
              <button title="Browse engine EXE" onClick={() => void chooseEngine(slot)}><FolderOpen size={14} /></button>
              <button title="Restore Stockfish 19" onClick={async () => {
                if (liveRef.current) await stopEngines();
                setPaths(prev => ({ ...prev, [slot]: '__bundled__' }));
                setNames(prev => ({ ...prev, [slot]: ANCHOR_NAME }));
                assignedRef.current = { ...assignedRef.current, [slot]: BUILTIN_ID };
                namesRef.current = { ...namesRef.current, [slot]: ANCHOR_NAME };
              }}><RotateCcw size={14} /></button>
            </div>
          </div>)}
          {!available && <p className="warning">Bundled engine was not found. Run npm run prepare:engine on Windows.</p>}
        </div>
        <div className="sidebar-section">
          <Banner><Settings2 size={12} /> SEARCH SETTINGS</Banner>
          <div className="setting"><label htmlFor="depth">Match depth</label><output>{depth}</output>
            <input id="depth" type="range" min="2" max="30" value={depth} onChange={e => setDepth(Number(e.target.value))} disabled={live && mode === 'arena'} /></div>
          <div className="setting"><label htmlFor="mpv">MultiPV lines</label><output>{multipv}</output>
            <input id="mpv" type="range" min="1" max="8" value={multipv} onChange={e => setMultipv(Number(e.target.value))} disabled={live} /></div>
          <div className="double-setting">
            <label>Threads<input type="number" value={threads} min="1" max="64" onChange={e => setThreads(Math.max(1, Math.min(64, Number(e.target.value) || 1)))} disabled={live} /></label>
            <label>Hash (MB)<input type="number" value={hash} min="16" max="4096" onChange={e => setHash(Math.max(16, Math.min(4096, Number(e.target.value) || 16)))} disabled={live} /></label>
          </div>
          <div className="control-stack">
            <button className="primary-action" onClick={() => {
              if (mode === 'tournament') setControlTab('tournament');
              else void (mode === 'analysis' ? startAnalysis() : startArena());
            }}><Play size={16} fill="currentColor" /> {mode === 'analysis' ? 'START ANALYSIS' : mode === 'arena' ? 'START MATCH' : 'TOURNAMENT CONTROL'}</button>
            <button className="secondary-action" onClick={() => void stopEngines()} disabled={!live}><Pause size={16} /> Stop engines</button>
          </div>
        </div>
        <div className="sidebar-section compact">
          <Banner>DISPLAY OPTIONS</Banner>
          <label className="simple-label">Arrow overlay</label>
          <select value={arrowMode} onChange={e => setArrowMode(e.target.value as ArrowMode)}>
            <option value="off">Off</option>
            <option value="best">Best move only</option>
            <option value="top3">Top 3 candidates</option>
            <option value="hikaru">Hikaru mode · arrow storm</option>
          </select>
          <label className="simple-label">Board palette</label>
          <select value={boardTheme} onChange={e => setBoardTheme(e.target.value as BoardTheme)}>
            <option value="broadcast">Broadcast · olive</option>
            <option value="classic">Classic · walnut</option>
            <option value="blue">Ice blue</option>
          </select>
        </div>
        <div className="sidebar-bottom">
          <div className="info-note"><CircleHelp size={17} /><span>Internal TT / NNUE values require opt-in <b>Stockless X-Ray telemetry</b>. Standard UCI does not expose them.</span></div>
        </div>
      </aside>

      <main className="main-content">
        <div className="content-title"><div><Banner>THE LIVE ENGINE LABORATORY</Banner>
          <h1>{mode === 'analysis' ? 'Position analysis' : mode === 'tournament' ? 'Tournament broadcast' : 'Engine championship'}<span className="text-lime">.</span></h1>
          <p>{mode === 'analysis' ? 'Inspect principal variations, board geometry and real search activity.' :
            mode === 'tournament' ? 'Watch registered UCI engines compete in a scheduled event.' :
            'Run a local depth-limited UCI duel with a persistent rating table.'}</p></div>
          <div className="title-actions">
            <button onClick={() => setFlipped(f => !f)}><ArrowLeftRight size={16} /> Flip board</button>
            <button onClick={() => {
              if (mode === 'tournament' && tournamentRef.current?.status === 'running') {
                setControlTab('tournament');
                return;
              }
              void resetGame();
            }}><RotateCcw size={16} /> New game</button>
          </div></div>

        <div className="match-banner">
          <div className="player-title"><span className="player-color white" /> <div><b>{formatName(names.white)}</b><small>WHITE ENGINE</small></div></div>
          <div className="match-center"><span className="eyebrow">LIVE EVALUATION · WHITE POV</span>
            <strong className="score-large">{scoreLabel(mode !== 'analysis' ? infos[chess.current.turn() === 'w' ? 'white' : 'black'] : infos.white, turn)}</strong>
            <span className="position-label">{chess.current.isCheck() ? 'CHECK' : 'POSITION EVALUATION'}</span></div>
          <div className="player-title right"><div><b>{formatName(names.black)}</b><small>BLACK ENGINE</small></div><span className="player-color black" /></div>
        </div>

        <div className="board-size-strip"><span><SlidersHorizontal size={14}/> MAIN BOARD SIZE</span>
          <input aria-label="Main board size" type="range" min="320" max="1100" step="10"
            value={layout.boardSize} onChange={event => setLayout(prev => ({ ...prev, boardSize: Number(event.target.value) }))}/>
          <output>{layout.boardSize}px</output>
          {mode === 'tournament' && tournament && <span className="broadcast-round">
            GAME {Math.min(tournament.index + 1, tournament.schedule.length)} / {tournament.schedule.length}
            {' · '}{tournament.openingBookName ? 'EPD: ' + tournament.openingBookName : 'STARTPOS'}</span>}
        </div>
        <div className="board-and-insight">
          <div className="board-cluster">
            <div className="board-with-bar">
              <div className="eval-bar" title="Visualized from actual UCI score, not a winning probability">
                <div className="black-eval" style={{ height: blackPct + '%' }} />
                <span className="eval-bar-text">{evaluation === null ? '50%' : (100 - blackPct).toFixed(0) + '%'}</span>
              </div>
              <ChessBoard fen={fen} lastMove={lastMove} arrows={mainArrows} flipped={flipped} theme={boardTheme} onMove={manualMove} />
            </div>
            <div className="board-foot">
              <div><span className="turn-indicator" /> {turn === 'w' ? 'WHITE TO MOVE' : 'BLACK TO MOVE'} <span className="mini-dot">·</span> {moveSan.length} PLIES</div>
              <div className="board-buttons">
                <button title="Copy PGN" onClick={() => void exportPgn()}><ClipboardCopy size={15} /> PGN</button>
                <button title="Swap perspective" onClick={() => setFlipped(f => !f)}><ArrowLeftRight size={15} /></button>
              </div>
            </div>
          </div>
          <div className="position-panel">
            <div className="panel-heading inline"><div><Banner>UCI ENGINE STREAM</Banner><h3>Search monitor</h3></div><Radio className={live ? 'pulse-icon' : ''} size={19} /></div>
            <div className="stat-grid">
              {engineMetrics.map(item => <div className="stat-cell" key={item.label}><div className="stat-label">{item.icon}{item.label}</div><div className="stat-value">{item.value}</div></div>)}
            </div>
            <div className="mini-section"><Banner>WIN / DRAW / LOSS</Banner>
              {primary?.wdl ? <div className="wdl-bar">
                <span style={{ width: primary.wdl[0] / 10 + '%' }} />
                <span style={{ width: primary.wdl[1] / 10 + '%' }} />
                <span style={{ width: primary.wdl[2] / 10 + '%' }} />
              </div> : <div className="wdl-empty">No WDL data provided</div>}
              <p>UCI-reported WDL · engine perspective</p></div>
            <div className="mini-section fen-section"><Banner>FEN POSITION</Banner>
              <div className="fen-input"><input aria-label="FEN" value={fenInput} onChange={e => setFenInput(e.target.value)} />
                <button onClick={() => void loadFen()} title="Load FEN"><FileInput size={17} /></button></div>
              <p>Validates position before loading</p></div>
            {result && <div className="result-pill">{result}</div>}
          </div>
        </div>

        <div className="metric-toolbar"><div className="metric-tabs">
          {([['eval', 'Eval'], ['depth', 'Depth'], ['nodes', 'Nodes'], ['speed', 'Speed'], ['hash', 'Hash']] as [Metric, string][]).map(([key, text]) =>
            <button key={key} className={metric === key ? 'tab-active' : ''} onClick={() => setMetric(key)}>{text}</button>)}
        </div><span className="chart-note"><BarChart3 size={15} /> Live performance timeline</span></div>
        <Timeline data={samples} metric={metric} />
        <SearchTree fen={fen} pvs={currentPvs} theme={boardTheme} flipped={flipped} />
        <section className="panel standings-panel">
          <div className="panel-heading"><div><Banner>LOCAL MATCH RESULTS</Banner><h3><Trophy size={18} /> Engine rankings</h3></div>
            <span className="source-pill">CCRL 40/15 ANCHOR</span></div>
          <div className="rankings-wrapper"><table><thead><tr>
            <th>RANK</th><th>ENGINE</th><th>ELO</th><th>GAMES</th><th>W</th><th>D</th><th>L</th>
          </tr></thead><tbody>{standings.map((item, i) =>
            <tr key={item.name}><td className="rank-no">{String(i + 1).padStart(2, '0')}</td>
              <td><strong>{item.name}</strong>{item.isAnchor && <span className="anchor-tag">OFFICIAL ANCHOR</span>}</td>
              <td className="elo-value">{item.elo}{!item.isAnchor && <span className="provisional-marker">*</span>}</td>
              <td>{item.played}</td><td>{item.wins}</td><td>{item.draws}</td><td>{item.losses}</td></tr>)}</tbody></table></div>
          <div className="rankings-footer">Stockfish 19 = 3650 on CCRL 40/15 (4 CPU, 2026-10-16). * Other ratings: provisional, locally estimated Elo (K=32), not official CCRL measurements.</div>
        </section>
      </main>

      <aside className="sidebar right-sidebar">
        <div className="pv-resize-handle" role="separator" aria-label="Drag to resize PV panel"
          title="Drag left or right to resize PV panel"
          onMouseDown={event => {
            event.preventDefault();
            const startX = event.clientX;
            const startWidth = layout.pvWidth;
            const move = (next: MouseEvent) => setLayout(current =>
              ({ ...current, pvWidth: clamp(startWidth + startX - next.clientX, 280, 850) }));
            const up = () => {
              window.removeEventListener('mousemove', move);
              window.removeEventListener('mouseup', up);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
          }}><span/></div>
        <section className="right-section pv-primary-section">
          <div className="pv-width-toolbar"><SlidersHorizontal size={13}/>
            <label>PV panel</label>
            <input aria-label="PV panel width" type="range" min="280" max="850" step="10"
              value={layout.pvWidth} onChange={event => setLayout(prev => ({ ...prev, pvWidth: Number(event.target.value) }))}/>
            <output>{layout.pvWidth}px</output>
          </div>
          <div className="panel-heading"><div><Banner>PRINCIPAL VARIATIONS</Banner><h3><GitBranch size={18} /> Candidate moves</h3></div><span className="source-pill">MULTIPV {mode === 'analysis' ? multipv : 1}</span></div>
          {mode !== 'analysis' && <div className="slot-selector"><button className={selectedSlot === 'white' ? 'selected' : ''} onClick={() => setSelectedSlot('white')}>WHITE PV</button>
            <button className={selectedSlot === 'black' ? 'selected' : ''} onClick={() => setSelectedSlot('black')}>BLACK PV</button></div>}
          <div className="pv-list">
            {currentPvs.length === 0 && <div className="empty-state"><GitBranch size={36} /><b>Waiting for PV data</b><span>Start analysis to inspect the engine's search lines in real time.</span></div>}
            {currentPvs.map((line, i) => {
              const legal = legalPv(fen, line.pv, 14);
              const preview = legalPv(fen, line.pv, 5);
              return <div className={'pv-card pv-' + (i + 1)} key={line.multipv}>
                <div className="pv-header"><span className="pv-index">#{line.multipv}</span><strong>{scoreLabel(line, turn)}</strong><span className="pv-depth">D {line.depth ?? '—'}</span></div>
                <div className="pv-detail"><ChessBoard fen={preview.fen} mini flipped={flipped} theme={boardTheme} />
                  <div><div className="pv-sequence">{legal.san.length ? legal.san.join(' ') : 'Waiting for legal line...'}</div>
                    {legal.uci[0] && <button className="pv-apply" onClick={() => {
                      const move = fromUci(legal.uci[0]);
                      if (move) manualMove(move.from, move.to);
                    }}>Play first move <ChevronRight size={14} /></button>}</div></div>
              </div>;
            })}
          </div>
        </section>
        <section className="right-section xray-section">
          <div className="panel-heading"><div><Banner>SEARCH INTERNALS</Banner><h3><Eye size={18} /> X-Ray telemetry</h3></div><span className="source-pill muted">OPT-IN</span></div>
          <div className="xray-stats">{xrayItems.map(item => <div key={item.label}>
            <span>{item.label}</span><b className={item.value === 'UNAVAILABLE' || item.value === '—' ? 'unavailable' : ''}>{item.value}</b>
          </div>)}</div>
          <p className="xray-explainer">The standard UCI protocol does not provide TT hit rate, search cut counts or NNUE decomposition. These fields require <code>info string xray &#123;...&#125;</code> emitted by an instrumented engine; values are never inferred.</p>
          {xray?.nnue && <div className="nnue-stats">{Object.entries(xray.nnue).map(([key, value]) => <div key={key}>{key} <b>{value.toFixed(2)}</b></div>)}</div>}
        </section>
        <section className="right-section log-section">
          <div className="panel-heading"><div><Banner>ENGINE PROTOCOL</Banner><h3><Cpu size={18} /> Live UCI log</h3></div><span className="source-pill muted">{lines.length} lines</span></div>
          <div className="console">{lines.slice(0, 24).map((line, index) => <div key={index}>{line}</div>)}{lines.length === 0 && <span>Engine output will appear here.</span>}</div>
        </section>
      </aside>
    </div>
    {controlTab && <ControlCenter
      tab={controlTab} onTab={setControlTab} onClose={() => setControlTab(null)}
      layout={layout} onLayout={setLayout} engines={engines}
      onAddEngine={addEngine} onRemoveEngine={removeEngine} onRenameEngine={renameEngine}
      onInspectEngine={inspectEngine} inspectingId={inspectingId}
      onOption={editEngineOption} onAssign={assignEngine}
      tournament={tournament}
      epdBook={epdBook} epdLoading={epdLoading} epdError={epdError}
      openingMode={openingMode} onOpeningMode={setOpeningMode}
      pairBookColors={pairBookColors} onPairBookColors={setPairBookColors}
      onChooseEpdBook={chooseEpdBook} onReloadEpdBook={reloadEpdBook}
      onClearEpdBook={clearEpdBook} onStartTournament={startTournament}
      onPauseTournament={pauseTournament} onResumeTournament={resumeTournament}
      onStopTournament={stopTournament} />}
    <footer className="statusbar"><span><i className={'status-dot' + (live ? ' active' : '')} />{notice}</span>
      <div><span>RUST / TAURI 2</span><span className="footer-sep">/</span><span>UCI NATIVE</span><span className="footer-sep">/</span><span><Download size={12} /> OFFLINE STOCKFISH 19</span></div></footer>
  </div>;
}
