import { useMemo, useState } from 'react';
import { ChessBoard, type BoardTheme } from './ChessBoard';
import { legalPv, scoreLabel, type UciInfo } from './uci';
import { GitBranch, Maximize2 } from 'lucide-react';
type Branch = {
  id: string;
  san: string;
  uci: string;
  depth: number;
  path: string[];
  children: Branch[];
  pvRank: number;
  evaluation: string | null;
  x: number;
  y: number;
};
const hues = ['#d5f17f', '#6ad4ea', '#efa8db', '#f3bc7f', '#9d8be2', '#8ee0aa'];
function createTree(fen: string, pvs: UciInfo[]) {
  const root: Branch = { id: '', san: 'ROOT', uci: '', depth: 0, path: [], children: [], pvRank: 0, evaluation: null, x: 65, y: 100 };
  let deepest = 0;
  pvs.slice(0, 6).forEach(pv => {
    const valid = legalPv(fen, pv.pv, 7);
    let parent = root;
    valid.uci.forEach((uci, index) => {
      let node = parent.children.find(x => x.uci === uci);
      if (!node) {
        const path = [...parent.path, uci];
        node = {
          id: path.join(' '), san: valid.san[index], uci, depth: index + 1, path,
          children: [], pvRank: pv.multipv,
          evaluation: index === 0 ? scoreLabel(pv, fen.split(' ')[1] === 'b' ? 'b' : 'w') : null,
          x: 0, y: 0
        };
        parent.children.push(node);
      }
      deepest = Math.max(deepest, index + 1);
      parent = node;
    });
  });
  let leaves = 0;
  const all: Branch[] = [];
  function layout(node: Branch) {
    for (const child of node.children) layout(child);
    node.x = 65 + node.depth * 154;
    if (!node.children.length) node.y = 66 + 65 * leaves++;
    else node.y = (node.children[0].y + node.children[node.children.length - 1].y) / 2;
    all.push(node);
  }
  layout(root);
  return { root, all, width: Math.max(830, 140 + deepest * 154), height: Math.max(170, 130 + Math.max(leaves - 1, 0) * 65) };
}
export default function SearchTree({ fen, pvs, theme, flipped }: {
  fen: string; pvs: UciInfo[]; theme: BoardTheme; flipped: boolean;
}) {
  const tree = useMemo(() => createTree(fen, pvs), [fen, pvs]);
  const [selected, setSelected] = useState('');
  const active = tree.all.find(node => node.id === selected) || tree.root;
  const preview = legalPv(fen, active.path, 8);
  const links = tree.all.flatMap(n => n.children.map(child => ({
    from: n, to: child, key: child.id, color: hues[(child.pvRank - 1) % hues.length]
  })));
  return <section className="panel search-tree-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">MULTIPV EXPLORER · DERIVED FROM ACTUAL LINES</span><h3><GitBranch size={17} /> Search variation tree</h3></div>
      <div className="tree-summary"><Maximize2 size={13} /> {tree.all.length - 1} visible PV nodes</div>
    </div>
    {pvs.length === 0 ? <div className="tree-empty">No principal variations received. Start analysis to populate the variation tree.</div> :
      <div className="tree-scroller">
        <svg width={tree.width} height={tree.height} viewBox={'0 0 ' + tree.width + ' ' + tree.height}
          role="img" aria-label="Shared principal variation moves displayed as a move tree">
          {links.map(link => <path key={link.key}
            d={'M ' + (link.from.x + 39) + ' ' + link.from.y + ' C ' + (link.from.x + 77) + ' ' + link.from.y + ', ' + (link.to.x - 78) + ' ' + link.to.y + ', ' + (link.to.x - 39) + ' ' + link.to.y}
            fill="none" stroke={link.color} strokeWidth="2.5" opacity=".6" />)}
          {tree.all.map(node => {
            const activeNode = active.id === node.id;
            return <g key={node.id} className="tree-node" onClick={() => setSelected(node.id)} tabIndex={0}
              onKeyDown={event => { if (event.key === 'Enter') setSelected(node.id); }}
              aria-label={'PV move ' + node.san} role="button">
              <rect x={node.x - 38} y={node.y - 19} width="76" height="38" rx="7"
                stroke={activeNode ? '#d5f17f' : '#3c556c'} strokeWidth={activeNode ? 2.5 : 1}
                fill={activeNode ? '#33442d' : '#182c3e'} />
              <text x={node.x} y={node.y + 4} fill={activeNode ? '#ebffb4' : '#e1eaf4'}
                fontSize="12" fontWeight="750" textAnchor="middle">{node.san}</text>
              {node.evaluation && <text x={node.x} y={node.y - 26} textAnchor="middle" fill="#aec4d2" fontSize="10">{node.evaluation}</text>}
            </g>;
          })}
        </svg>
      </div>}
    <div className="tree-inspector">
      <ChessBoard fen={preview.fen} mini theme={theme} flipped={flipped} />
      <div>
        <span className="eyebrow">SELECTED VARIATION</span>
        <strong>{active.path.length ? active.path.map((_, i) => legalPv(fen, active.path.slice(0, i + 1), i + 1).san[i]).join(' ') : 'Current position'}</strong>
        <small>{active.path.length} PLIES FOLLOWED · {active.pvRank ? 'PV #' + active.pvRank : 'ROOT POSITION'}</small>
        <p>This is a trie of MultiPV lines, not a full engine node trace. Full alpha-beta search trees require engine-side instrumentation.</p>
      </div>
    </div>
  </section>;
}
