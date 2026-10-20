/** Persisted UCI engine inventory; engine paths are local-only and never uploaded. */
export type UciOptionType = 'check' | 'spin' | 'combo' | 'string' | 'button';
export interface UciOption {
  name: string;
  type: UciOptionType;
  defaultValue?: string;
  min?: number;
  max?: number;
  variants?: string[];
}
export interface EngineEntry {
  id: string;
  name: string;
  path: string;
  options: Record<string, string>;
  availableOptions: UciOption[];
  builtin?: boolean;
}
export const BUILTIN_ID = 'built-in-stockfish-19';
const KEY = 'chess-xray-engines-v2';
export const BUILTIN: EngineEntry = {
  id: BUILTIN_ID, name: 'Stockfish 19', path: '__bundled__',
  options: {}, availableOptions: [], builtin: true
};
export function loadEngines(): EngineEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!Array.isArray(raw)) return [{ ...BUILTIN }];
    const existing = raw.filter((engine): engine is EngineEntry => {
      return !!engine && typeof engine === 'object' &&
        typeof engine.id === 'string' && typeof engine.name === 'string' &&
        typeof engine.path === 'string' && typeof engine.options === 'object' &&
        engine.options !== null && Array.isArray(engine.availableOptions);
    }).map(engine => ({
      ...engine, options: { ...engine.options },
      availableOptions: [...engine.availableOptions]
    }));
    return [{ ...BUILTIN, ...existing.find(e => e.id === BUILTIN_ID) },
      ...existing.filter(e => e.id !== BUILTIN_ID)].slice(0, 48);
  } catch { return [{ ...BUILTIN }]; }
}
export function saveEngines(engines: EngineEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(engines));
}
export function parseOptionLine(line: string): UciOption | null {
  if (!line.startsWith('option name ')) return null;
  const remaining = line.slice('option name '.length);
  const typePos = remaining.indexOf(' type ');
  if (typePos < 1) return null;
  const name = remaining.slice(0, typePos).trim();
  const tail = remaining.slice(typePos + 6);
  const space = tail.indexOf(' ');
  const type = (space < 0 ? tail : tail.slice(0, space)) as UciOptionType;
  if (!['check', 'spin', 'combo', 'string', 'button'].includes(type)) return null;
  const extras = space < 0 ? '' : tail.slice(space + 1);
  const defaultMatch = extras.match(/(?:^| )default (.*?)(?= (?:min|max|var) |$)/);
  const min = extras.match(/(?:^| )min (-?\d+)/);
  const max = extras.match(/(?:^| )max (-?\d+)/);
  const variants = [...extras.matchAll(/(?:^| )var (.*?)(?= (?:var|min|max) |$)/g)].map(x => x[1]);
  return {
    name, type,
    ...(defaultMatch ? { defaultValue: defaultMatch[1] } : {}),
    ...(min ? { min: Number(min[1]) } : {}),
    ...(max ? { max: Number(max[1]) } : {}),
    ...(variants.length ? { variants } : {})
  };
}
export function uniqueEngineName(engines: EngineEntry[], name: string): string {
  const clean = name.trim() || 'UCI Engine';
  let candidate = clean;
  let i = 2;
  while (engines.some(e => e.name.toLowerCase() === candidate.toLowerCase())) {
    candidate = clean + ' (' + i++ + ')';
  }
  return candidate;
}
export function newEngineId(): string {
  return 'uci-' + crypto.randomUUID();
}
