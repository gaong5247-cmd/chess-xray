import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Check, ChevronRight, Cpu, FolderPlus, Gauge, LayoutGrid,
  Pause, Play, RotateCcw, Settings2, SlidersHorizontal,
  Swords, Trash2, Trophy, X, BookOpen, FileText, RefreshCcw
} from 'lucide-react';
import type { EngineEntry, UciOption } from './engines';
import type { EpdBook, OpeningMode } from './epd';
import { createRoundRobin, tournamentTable, type TournamentConfig, type TournamentRun } from './tournament';

export type ControlTab = 'configure' | 'tournament' | 'engines';
export interface LayoutPrefs {
  boardSize: number;
  pvWidth: number;
  pvBoardSize: number;
  pvFontSize: number;
  boardFocus: boolean;
}
export const DEFAULT_LAYOUT: LayoutPrefs = {
  boardSize: 760, pvWidth: 460, pvBoardSize: 136, pvFontSize: 13, boardFocus: true
};
const LAYOUT_KEY = 'chess-xray-layout-v1';
export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
export function loadLayout(): LayoutPrefs {
  try {
    const object = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null') as Partial<LayoutPrefs> | null;
    if (!object) return { ...DEFAULT_LAYOUT };
    return {
      boardSize: clamp(Number(object.boardSize) || 760, 320, 1100),
      pvWidth: clamp(Number(object.pvWidth) || 460, 280, 850),
      pvBoardSize: clamp(Number(object.pvBoardSize) || 136, 72, 260),
      pvFontSize: clamp(Number(object.pvFontSize) || 13, 10, 21),
      boardFocus: object.boardFocus !== false
    };
  } catch { return { ...DEFAULT_LAYOUT }; }
}
export function persistLayout(pref: LayoutPrefs) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(pref));
}

type ControlProps = {
  tab: ControlTab;
  onTab: (tab: ControlTab) => void;
  onClose: () => void;
  layout: LayoutPrefs;
  onLayout: (layout: LayoutPrefs) => void;
  engines: EngineEntry[];
  onAddEngine: () => Promise<void>;
  onRemoveEngine: (id: string) => void;
  onRenameEngine: (id: string, name: string) => void;
  onInspectEngine: (id: string) => Promise<void>;
  inspectingId: string | null;
  onOption: (id: string, name: string, value: string) => void;
  onAssign: (id: string, slot: 'white' | 'black') => void;
  tournament: TournamentRun | null;
  epdBook: EpdBook | null;
  epdLoading: boolean;
  epdError: string | null;
  openingMode: OpeningMode;
  onOpeningMode: (mode: OpeningMode) => void;
  pairBookColors: boolean;
  onPairBookColors: (value: boolean) => void;
  onChooseEpdBook: () => Promise<void>;
  onReloadEpdBook: () => Promise<void>;
  onClearEpdBook: () => void;
  onStartTournament: (config: TournamentConfig) => Promise<void>;
  onPauseTournament: () => Promise<void>;
  onResumeTournament: () => Promise<void>;
  onStopTournament: () => Promise<void>;
};

const panels: { key: ControlTab; label: string; sub: string }[] = [
  { key: 'configure', label: 'Configure', sub: 'Workspace / display' },
  { key: 'tournament', label: 'Tournament', sub: 'Engine event manager' },
  { key: 'engines', label: 'Engines', sub: 'UCI engine library' }
];

function NumericSlider({ label, value, min, max, step = 1, suffix = 'px', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string;
  onChange: (value: number) => void;
}) {
  return <div className="layout-setting">
    <div className="layout-setting-title"><label>{label}</label><output>{value}{suffix}</output></div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))} />
    <div className="range-ends"><span>{min}{suffix}</span><span>{max}{suffix}</span></div>
  </div>;
}

function EditUciOption({ engine, option, onOption }: {
  engine: EngineEntry; option: UciOption; onOption: ControlProps['onOption'];
}) {
  const current = engine.options[option.name] ?? option.defaultValue ?? (option.type === 'check' ? 'false' : '');
  return <div className="uci-option-row">
    <div className="uci-option-description"><strong>{option.name}</strong><small>{option.type.toUpperCase()}
      {option.min !== undefined && option.max !== undefined ? ' · ' + option.min + '–' + option.max : ''}</small></div>
    {option.type === 'check' ? <input type="checkbox" checked={current === 'true'} onChange={event =>
      onOption(engine.id, option.name, String(event.target.checked))} /> :
    option.type === 'combo' ? <select value={current} onChange={event => onOption(engine.id, option.name, event.target.value)}>
      {(!option.variants || !option.variants.includes(current)) && <option value={current}>{current || '(default)'}</option>}
      {(option.variants || []).map(x => <option key={x} value={x}>{x}</option>)}
    </select> :
    option.type === 'button' ? <span className="uci-option-na">Button options cannot be persisted</span> :
    <input type={option.type === 'spin' ? 'number' : 'text'}
      min={option.min} max={option.max} value={current}
      onChange={event => onOption(engine.id, option.name, event.target.value)} />}
  </div>;
}

export default function ControlCenter(props: ControlProps) {
  const {
    tab, onTab, onClose, layout, onLayout, engines, onAddEngine,
    onRemoveEngine, onRenameEngine, onInspectEngine, inspectingId,
    onOption, onAssign, tournament, onStartTournament,
    onPauseTournament, onResumeTournament, onStopTournament,
    epdBook, epdLoading, epdError, openingMode, onOpeningMode,
    pairBookColors, onPairBookColors, onChooseEpdBook, onReloadEpdBook, onClearEpdBook
  } = props;
  const [engineId, setEngineId] = useState<string>(engines[0]?.id || '');
  const [selectedEntrants, setSelectedEntrants] = useState<string[]>(() =>
    tournament?.entries ?? engines.map(e => e.id));
  const [cycles, setCycles] = useState(1);
  const [doubleRound, setDoubleRound] = useState(true);
  const [movetime, setMovetime] = useState(1000);
  const [maxPlies, setMaxPlies] = useState(260);
  const [error, setError] = useState('');
  const selectedEngine = engines.find(e => e.id === engineId) || engines[0];

  useEffect(() => { function onEsc(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  } window.addEventListener('keydown', onEsc); return () => window.removeEventListener('keydown', onEsc); }, [onClose]);
  const config = useMemo<TournamentConfig>(() => ({
    entrants: selectedEntrants.filter(id => engines.some(e => e.id === id)),
    cycles, doubleRound, movetime, maxPlies
  }), [selectedEntrants, engines, cycles, doubleRound, movetime, maxPlies]);
  const preview = useMemo(() => createRoundRobin(config), [config]);
  const tournamentRows = useMemo(() => tournamentTable(tournament, engines), [tournament, engines]);
  const updateLayout = (key: keyof LayoutPrefs, value: number | boolean) =>
    onLayout({ ...layout, [key]: value });
  const toggleEntrant = (id: string, checked: boolean) =>
    setSelectedEntrants(prev => checked ? [...new Set([...prev, id])] : prev.filter(value => value !== id));
  const runNewEvent = async () => {
    try {
      setError('');
      if (config.entrants.length < 2) throw new Error('Select at least 2 registered engines.');
      await onStartTournament(config);
    } catch (exception) { setError(String(exception)); }
  };

  return <div className="control-overlay" role="presentation" onMouseDown={e => {
    if (e.target === e.currentTarget) onClose();
  }}>
    <section className="control-dialog" role="dialog" aria-modal="true" aria-label="Chess X-Ray Control Center">
      <div className="control-top">
        <div><span className="eyebrow">CHESS X-RAY / COMMAND CENTER</span><h2>{panels.find(x => x.key === tab)?.label}</h2></div>
        <button className="control-close" onClick={onClose} aria-label="Close command center"><X size={20}/></button>
      </div>
      <div className="control-content">
        <nav className="control-rail" aria-label="Control center sections">
          {panels.map(panel => <button key={panel.key} className={tab === panel.key ? 'chosen' : ''}
            onClick={() => { onTab(panel.key); setError(''); }}>
            <span>{panel.key === 'configure' ? <SlidersHorizontal size={17} /> :
              panel.key === 'tournament' ? <Trophy size={17} /> : <Cpu size={17} />}</span>
            <span><b>{panel.label}</b><small>{panel.sub}</small></span><ChevronRight size={15}/></button>)}
          <div className="rail-foot">Native desktop engine controls<br/>Tauri + Rust / UCI</div>
        </nav>
        <div className="control-main">
          {tab === 'configure' && <>
            <div className="control-section-title"><LayoutGrid size={20}/><div><h3>Workspace layout</h3>
              <p>Make the chess board and PV column as large as you like. Your settings are saved locally.</p></div></div>
            <div className="layout-grid">
              <NumericSlider label="Main board maximum size" value={layout.boardSize} min={320} max={1100} step={10}
                onChange={value => updateLayout('boardSize', value)} />
              <NumericSlider label="Right PV panel width" value={layout.pvWidth} min={280} max={850} step={10}
                onChange={value => updateLayout('pvWidth', value)} />
              <NumericSlider label="PV preview board size" value={layout.pvBoardSize} min={72} max={260} step={4}
                onChange={value => updateLayout('pvBoardSize', value)} />
              <NumericSlider label="PV move text size" value={layout.pvFontSize} min={10} max={21} suffix="px"
                onChange={value => updateLayout('pvFontSize', value)} />
            </div>
            <label className="toggle-row"><input type="checkbox" checked={layout.boardFocus}
              onChange={e => updateLayout('boardFocus', e.target.checked)}/>
              <span><b>Board-first layout</b><small>Show the main board at full center-column width; move search stats below it.</small></span></label>
            <div className="layout-tips"><Gauge size={17}/> You can also drag the grip on the left edge of the PV panel to resize it directly. Sizes are persistent across launches.</div>
            <div className="control-buttons"><button className="plain-control-button" onClick={() => onLayout({ ...DEFAULT_LAYOUT })}>
              <RotateCcw size={15}/> Reset default layout</button>
              <button className="affirm-control-button" onClick={onClose}><Check size={15}/> Apply layout</button></div>
          </>}

          {tab === 'engines' && <>
            <div className="control-section-title"><Cpu size={20}/><div><h3>UCI engine library</h3>
              <p>Add Windows engine executables, read UCI options, and assign engines for analysis or tournaments.</p></div></div>
            <div className="engine-manager">
              <div className="engine-list">
                <button className="add-engine" onClick={() => void onAddEngine()}><FolderPlus size={16}/> Add UCI engine (.exe)</button>
                {engines.map(engine => <button key={engine.id} className={'engine-library-item ' + (selectedEngine?.id === engine.id ? 'selected' : '')}
                  onClick={() => setEngineId(engine.id)}>
                  <Cpu size={16}/><span><strong>{engine.name}</strong><small>{engine.builtin ? 'Built-in · Stockfish 19' :
                    engine.path.split(/[\\/]/).pop()}</small></span>
                  <ChevronRight size={14}/></button>)}
              </div>
              <div className="engine-detail">
                {!selectedEngine ? <div>No engine selected</div> : <>
                  <span className="eyebrow">ENGINE CONFIGURATION</span>
                  <label className="editor-label">Display name</label>
                  <input className="full-editor" value={selectedEngine.name} disabled={selectedEngine.builtin}
                    onChange={e => onRenameEngine(selectedEngine.id, e.target.value)} />
                  <label className="editor-label">Executable</label>
                  <div className="path-preview" title={selectedEngine.path}>{selectedEngine.path === '__bundled__'
                    ? 'Bundled Stockfish 19 · x86-64 universal' : selectedEngine.path}</div>
                  <div className="control-buttons wrap-buttons">
                    <button className="plain-control-button" disabled={inspectingId !== null}
                      onClick={() => void onInspectEngine(selectedEngine.id)}>
                      <Activity size={14}/>{inspectingId === selectedEngine.id ? 'Reading UCI…' : 'Inspect UCI options'}</button>
                    <button className="plain-control-button" onClick={() => onAssign(selectedEngine.id, 'white')}>Use as White</button>
                    <button className="plain-control-button" onClick={() => onAssign(selectedEngine.id, 'black')}>Use as Black</button>
                    {!selectedEngine.builtin && <button className="danger-control-button" onClick={() => {
                      onRemoveEngine(selectedEngine.id);
                      setEngineId(engines.find(x => x.id !== selectedEngine.id)?.id ?? '');
                    }}><Trash2 size={14}/> Remove</button>}
                  </div>
                  <div className="uci-options-heading"><h4>UCI options ({selectedEngine.availableOptions.length})</h4>
                    <span>Read from engine handshake</span></div>
                  <div className="uci-options">
                    {selectedEngine.availableOptions.length === 0 && <div className="uci-empty">
                      Click <b>Inspect UCI options</b> to read this engine's available settings. The options will be saved to the engine profile.
                    </div>}
                    {selectedEngine.availableOptions.map(option => <EditUciOption
                      key={option.name} engine={selectedEngine} option={option} onOption={onOption} />)}
                  </div>
                  <p className="fine-print">Custom options are applied on the next engine launch. Supported UCI types: spin, check, string and combo. Invalid options are rejected by the engine itself.</p>
                </>}
              </div>
            </div>
          </>}

          {tab === 'tournament' && <>
            <div className="control-section-title"><Trophy size={20}/><div><h3>Local tournament manager</h3>
              <p>Select all participating UCI engines and play a full round-robin tournament with alternating colors.</p></div></div>
            {tournament && <div className="tournament-current">
              <div><span className="eyebrow">CURRENT TOURNAMENT</span>
                <strong>{tournament.status.toUpperCase()} · {Math.min(tournament.index, tournament.schedule.length)} / {tournament.schedule.length} games finished</strong>
              </div><div className="event-progress"><span style={{width: (100 * tournament.index / Math.max(1, tournament.schedule.length)) + '%'}}/></div>
              <div className="event-actions">
                {tournament.status === 'running' && <button onClick={() => void onPauseTournament()}><Pause size={14}/> Pause</button>}
                {tournament.status === 'paused' && <button onClick={() => void onResumeTournament()}><Play size={14}/> Resume current game</button>}
                {(tournament.status === 'running' || tournament.status === 'paused') &&
                  <button className="danger-control-button" onClick={() => void onStopTournament()}>End event</button>}
              </div>
            </div>}
            <div className="opening-book-panel">
              <div className="opening-book-title">
                <BookOpen size={19} />
                <div><b>Opening book</b><span>Random starting positions for every matchup</span></div>
                <span className="source-pill">{openingMode === 'epd' ? 'RANDOM EPD' : 'STARTPOS'}</span>
              </div>
              <div className="opening-book-modes">
                <label><input type="radio" name="opening-mode" checked={openingMode === 'startpos'}
                    onChange={() => onOpeningMode('startpos')}/> Standard starting position</label>
                <label><input type="radio" name="opening-mode" checked={openingMode === 'epd'}
                    disabled={!epdBook || epdLoading} onChange={() => onOpeningMode('epd')}/>
                    Random FEN from EPD</label>
              </div>
              <div className="opening-book-controls">
                <button className="plain-control-button" disabled={epdLoading}
                  onClick={() => void onChooseEpdBook()}><FileText size={15}/>
                  {epdLoading ? 'Reading book…' : 'Select .epd file'}</button>
                <button className="plain-control-button" disabled={epdLoading || !epdBook}
                  onClick={() => void onReloadEpdBook()}><RefreshCcw size={14}/> Resample</button>
                <button className="plain-control-button" disabled={epdLoading || !epdBook}
                  onClick={onClearEpdBook}>Clear book</button>
              </div>
              {epdBook && <div className="book-loaded">
                <div className="book-loaded-title"><FileText size={15}/><strong title={epdBook.path}>{epdBook.name}</strong>
                  <span>READY</span></div>
                <div className="book-stat-row">
                  <span><b>{epdBook.candidateLines.toLocaleString()}</b> candidate lines</span>
                  <span><b>{epdBook.usablePositions.length.toLocaleString()}</b> playable sampled FENs</span>
                  <span><b>{epdBook.rejectedSamples.toLocaleString()}</b> rejected in sample</span>
                </div>
                <p>{epdBook.totalLines.toLocaleString()} lines scanned · at most {epdBook.sampledLines.toLocaleString()} retained in memory (uniform reservoir sample across file)</p>
                <div className="book-fen-preview" title={epdBook.usablePositions[0]}>Example FEN: {epdBook.usablePositions[0]}</div>
              </div>}
              {!epdBook && !epdLoading && <p className="book-hint">Choose a .epd text book containing FEN positions. Invalid or finished positions are excluded from sampled candidates.</p>}
              {epdError && <p className="book-error" role="alert">{epdError}</p>}
              <label className="event-check book-pair-check"><input type="checkbox" checked={pairBookColors}
                onChange={event => onPairBookColors(event.target.checked)}/>
                Reuse the same FEN in reversed-color pairing (recommended for fairness)</label>
              <p className="book-note">EPD supports 4-field positions with optional opcodes and full 6-field FEN lines. Each scheduled game receives a frozen opening FEN.</p>
            </div>
            <div className="tournament-layout">
              <div>
                <h4>Participants <span>{config.entrants.length} selected</span></h4>
                <div className="entrants">{engines.map(engine => <label key={engine.id}>
                  <input type="checkbox" checked={config.entrants.includes(engine.id)}
                    onChange={event => toggleEntrant(engine.id, event.target.checked)}/>
                  <span>{engine.name}</span><small>{engine.builtin ? 'Built-in' : 'UCI executable'}</small></label>)}</div>
                <button className="add-engine inline-add" onClick={() => onTab('engines')}><FolderPlus size={14}/> Add more engines</button>
              </div>
              <div>
                <h4>Event settings</h4>
                <div className="event-settings">
                  <label>Tournament cycles<input type="number" value={cycles} min={1} max={20} onChange={e => setCycles(clamp(Number(e.target.value) || 1, 1, 20))}/></label>
                  <label>Time per move (ms)<input type="number" value={movetime} min={100} max={60000} step={100} onChange={e => setMovetime(clamp(Number(e.target.value) || 100, 100, 60000))}/></label>
                  <label>Max plies / game<input type="number" value={maxPlies} min={40} max={600} step={10} onChange={e => setMaxPlies(clamp(Number(e.target.value) || 40, 40, 600))}/></label>
                  <label className="event-check"><input type="checkbox" checked={doubleRound} onChange={e => setDoubleRound(e.target.checked)}/> Play reversed-color return legs</label>
                </div>
                <div className="tournament-preview"><Swords size={15}/><strong>{preview.length} scheduled games</strong>
                  <span>Round robin · fixed think time · local Elo estimates</span></div>
                <button className="affirm-control-button tournament-start" disabled={config.entrants.length < 2 || epdLoading ||
                  (openingMode === 'epd' && !epdBook) || tournament?.status === 'running'} onClick={() => void runNewEvent()}>
                  <Play size={16}/> Start new tournament
                </button>
                {error && <p className="warning">{error}</p>}
              </div>
            </div>
            {tournament && <>
              <h4 className="event-table-heading">Tournament standings</h4>
              <div className="event-table-scroll"><table><thead><tr><th>Pos</th><th>Engine</th><th>Pts</th><th>GP</th><th>W</th><th>D</th><th>L</th></tr></thead>
                <tbody>{tournamentRows.map((row,i) => <tr key={row.id}>
                  <td>{i+1}</td><td>{row.name}</td><td><b>{row.points}</b></td>
                  <td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td>
                </tr>)}</tbody></table></div>
              <h4 className="event-table-heading">Game schedule and results</h4>
              <div className="event-table-scroll game-list"><table><thead><tr>
                <th>#</th><th>Round</th><th>White</th><th>Black</th><th>Opening FEN</th><th>Result</th></tr></thead>
                <tbody>{tournament.schedule.map((game,i) => <tr key={game.id}
                  className={i === tournament.index ? 'current-game' : ''}>
                  <td>{game.number}</td><td>{game.round}</td>
                  <td>{engines.find(e => e.id === game.whiteId)?.name || game.whiteId}</td>
                  <td>{engines.find(e => e.id === game.blackId)?.name || game.blackId}</td>
                  <td><code className="book-schedule-fen" title={game.openingFen || 'Standard start'}>
                    {game.openingFen ? game.openingFen.split(' ')[0] : 'startpos'}</code></td>
                  <td>{game.outcome || (i === tournament.index && tournament.status === 'running' ? 'LIVE' : '—')}</td>
                </tr>)}</tbody></table></div>
            </>}
          </>}
        </div>
      </div>
    </section>
  </div>;
}
