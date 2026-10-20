export interface Standing {
  name: string;
  elo: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  isAnchor?: boolean;
}
export const ANCHOR_NAME = 'Stockfish 19';
export const ANCHOR_RATING = 3650;
const KEY = 'chess-xray-standings-v1';
export function initialStandings(): Standing[] {
  return [{ name: ANCHOR_NAME, elo: ANCHOR_RATING, played: 0, wins: 0, losses: 0, draws: 0, isAnchor: true }];
}
export function loadStandings(): Standing[] {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null') as Standing[] | null;
    if (!Array.isArray(data)) return initialStandings();
    return [...initialStandings(), ...data.filter(x => x && typeof x.name === 'string' && x.name !== ANCHOR_NAME)];
  } catch { return initialStandings(); }
}
export function saveStandings(rows: Standing[]) {
  localStorage.setItem(KEY, JSON.stringify(rows));
}
export function recordResult(rows: Standing[], white: string, black: string, whitePoints: 0 | 0.5 | 1): Standing[] {
  if (white === black) return rows;
  const updated = rows.map(x => ({ ...x }));
  const get = (name: string): Standing => {
    let row = updated.find(x => x.name === name);
    if (!row) {
      row = { name, elo: ANCHOR_RATING, played: 0, wins: 0, losses: 0, draws: 0 };
      updated.push(row);
    }
    return row;
  };
  const w = get(white);
  const b = get(black);
  const expectedWhite = 1 / (1 + Math.pow(10, (b.elo - w.elo) / 400));
  const delta = 32 * (whitePoints - expectedWhite);
  if (!w.isAnchor) w.elo = Math.round(w.elo + delta);
  if (!b.isAnchor) b.elo = Math.round(b.elo - delta);
  for (const [player, points] of [[w, whitePoints], [b, 1 - whitePoints]] as [Standing, number][]) {
    player.played++;
    if (points === 1) player.wins++;
    else if (points === 0) player.losses++;
    else player.draws++;
  }
  return updated.sort((a, b) => b.elo - a.elo);
}
