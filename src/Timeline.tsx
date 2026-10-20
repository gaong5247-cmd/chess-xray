import { useMemo } from 'react';
import type { Slot } from './uci';
export type Metric = 'eval' | 'depth' | 'nodes' | 'speed' | 'hash';
export interface Sample { slot: Slot; depth: number; score: number; nodes: number; nps: number; hash: number; time: number; }
const COLORS = { white: '#b5f273', black: '#55c7f4' };
const labels: Record<Metric, string> = { eval: 'EVALUATION', depth: 'DEPTH', nodes: 'SEARCH NODES', speed: 'SEARCH SPEED', hash: 'HASH OCCUPANCY' };
function measure(p: Sample, metric: Metric): number {
  switch (metric) {
    case 'eval': return Math.max(-800, Math.min(800, p.score));
    case 'depth': return p.depth;
    case 'nodes': return Math.log10(p.nodes + 1);
    case 'speed': return p.nps / 1e6;
    case 'hash': return p.hash / 10;
  }
}
export default function Timeline({ data, metric }: { data: Sample[]; metric: Metric }) {
  const series = useMemo(() => {
    const bySlot = (['white', 'black'] as Slot[]).map(slot => data.filter(d => d.slot === slot));
    const flat = data.map(d => measure(d, metric));
    const min = metric === 'eval' ? -500 : 0;
    const max = metric === 'eval' ? 500 : Math.max(1, ...flat);
    const chart = bySlot.map((values, i) => {
      const last = values.slice(-160);
      const points = last.map((p, j) => {
        const x = (j / Math.max(1, last.length - 1)) * 968 + 16;
        const y = 206 - (Math.max(min, Math.min(max, measure(p, metric))) - min) / (max - min) * 174;
        return x.toFixed(2) + ',' + y.toFixed(2);
      }).join(' ');
      return { slot: (i === 0 ? 'white' : 'black') as Slot, points };
    });
    return { chart, baseline: metric === 'eval' ? 206 - (0 - min) / (max - min) * 174 : 206, max, min };
  }, [data, metric]);
  return <section className="panel graph-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">ENGINE TELEMETRY</span><h3>{labels[metric]}</h3></div>
      <div className="legend"><span><i className="dot lime" /> White</span><span><i className="dot cyan" /> Black</span></div>
    </div>
    <svg viewBox="0 0 1000 232" className="timeline" preserveAspectRatio="none" role="img" aria-label={labels[metric] + ' timeline'}>
      {[0, 1, 2, 3, 4].map(i => <line key={i} x1="16" y1={32 + i * 43.5} x2="984" y2={32 + i * 43.5} stroke="#243449" strokeDasharray="4 6" strokeWidth=".8" />)}
      <line x1="16" y1={series.baseline} x2="984" y2={series.baseline} stroke="#687a92" strokeOpacity=".65" strokeDasharray="6 5" />
      {series.chart.map(({ slot, points }) => <polyline key={slot} points={points} fill="none" stroke={COLORS[slot]} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />)}
      {data.length === 0 && <text x="500" y="125" fill="#71839a" textAnchor="middle" fontSize="18">Start an engine to stream genuine UCI samples</text>}
    </svg>
    <div className="graph-footer"><span>{data.length} recorded samples</span><span>White POV · no synthetic data</span></div>
  </section>;
}
