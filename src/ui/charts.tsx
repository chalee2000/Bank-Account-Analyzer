// กราฟ SVG/HTML เขียนเองตามหลัก dataviz: เส้น 2px, แท่ง ≤24px ปลายมน 4px, ตารางเส้นบาง, tooltip เมื่อ hover
// สีมาจาก CSS variables (--s1…, --q1…) ที่ปรับตามโหมดสว่าง/มืดอยู่แล้ว
import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { fmtBaht, formatThaiDate, fmtInt, fmtDuration } from '../core/thai';
import { useElementWidth } from './common';

export const compact = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${trim(n / 1e6)} ล้าน`;
  if (a >= 1e3) return `${trim(n / 1e3)}K`;
  return String(Math.round(n));
};
const trim = (x: number) => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString();

export function niceMax(max: number): { max: number; ticks: number[] } {
  if (max <= 0) return { max: 1, ticks: [0, 1] };
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  const step = (f <= 1 ? 0.2 : f <= 2 ? 0.5 : f <= 5 ? 1 : 2) * exp;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks };
}

interface Tip { x: number; y: number; content: ComponentChildren; below?: boolean }

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  return { tip, setTip };
}

function TipBox({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return <div class={'tooltip' + (tip.below ? ' below' : '')} style={{ left: `${tip.x}px`, top: `${tip.y}px` }}>{tip.content}</div>;
}

// ---------------- Line / area (daily flows) ----------------
export interface Series {
  name: string;
  color: string;
  values: number[];
}

export function LineChart(props: {
  xs: number[]; // epoch ms (ต้นช่วง)
  series: Series[];
  height?: number;
  xLabel: (x: number) => string;
  xTipLabel: (x: number) => string;
  area?: boolean;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const { tip, setTip } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const H = props.height ?? 220;
  const m = { l: 44, r: 12, t: 10, b: 24 };
  const iw = Math.max(50, width - m.l - m.r);
  const ih = H - m.t - m.b;
  const n = props.xs.length;
  const max = Math.max(0, ...props.series.flatMap((s) => s.values));
  const { max: ymax, ticks } = niceMax(max);
  const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => m.t + ih - (v / ymax) * ih;
  const xTickIdx = useMemo(() => {
    const maxTicks = Math.max(2, Math.floor(iw / 84));
    const step = Math.max(1, Math.ceil((n - 1) / (maxTicks - 1)));
    const out: number[] = [];
    for (let i = 0; i < n; i += step) out.push(i);
    return out;
  }, [n, iw]);

  const onMove = (e: MouseEvent | TouchEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const cx = 'touches' in e ? e.touches[0]!.clientX : (e as MouseEvent).clientX;
    const px = cx - rect.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
    setHover(i);
    setTip({
      x: x(i),
      y: Math.min(...props.series.map((s) => y(s.values[i] ?? 0))),
      content: (
        <>
          <b>{props.xTipLabel(props.xs[i]!)}</b>
          {props.series.map((s) => (
            <div class="kv" key={s.name}>
              <span><i style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: s.color, marginRight: '6px' }} />{s.name}</span>
              <span class="num">{fmtBaht(s.values[i] ?? 0)}</span>
            </div>
          ))}
        </>
      ),
    });
  };

  return (
    <div class="chart" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${H}`} height={H} role="img"
        aria-label={`กราฟเส้น ${props.series.map((s) => s.name).join(' และ ')} รายช่วงเวลา`}
        onMouseMove={onMove} onTouchMove={onMove} onMouseLeave={() => { setHover(null); setTip(null); }}
      >
        <g class="grid">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} />
              <text x={m.l - 6} y={y(t) + 4} text-anchor="end">{compact(t)}</text>
            </g>
          ))}
        </g>
        {xTickIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 6} text-anchor={i === 0 ? 'start' : 'middle'}>{props.xLabel(props.xs[i]!)}</text>
        ))}
        {props.series.map((s) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          return (
            <g key={s.name}>
              {props.area && n > 1 && (
                <polygon points={`${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}`} fill={s.color} opacity="0.1" />
              )}
              <polyline points={pts} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
              {n === 1 && <circle cx={x(0)} cy={y(s.values[0]!)} r="4" fill={s.color} />}
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="var(--border-strong)" />
            {props.series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4.5" fill={s.color} stroke="var(--surface-1)" stroke-width="2" />
            ))}
          </g>
        )}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

// ---------------- Horizontal bars (top counterparties etc.) ----------------
export interface BarDatum {
  id: string;
  label: string;
  value: number;
  sub?: string;
  color?: string;
  tip?: string;
}

export function BarList(props: {
  data: BarDatum[];
  format?: (v: number) => string;
  onClick?: (d: BarDatum) => void;
  max?: number;
}) {
  const max = props.max ?? Math.max(1, ...props.data.map((d) => d.value));
  const fmt = props.format ?? ((v: number) => fmtBaht(v));
  return (
    <div role="list">
      {props.data.map((d) => (
        <div
          class="bar-row" role="listitem" key={d.id} title={d.tip ?? `${d.label}: ${fmt(d.value)}`}
          style={props.onClick ? 'cursor:pointer' : undefined} onClick={() => props.onClick?.(d)}
        >
          <div class="ellipsis">
            {d.label}
            {d.sub && <span class="muted tiny" style="margin-left:6px">{d.sub}</span>}
          </div>
          <div class="bar-track" aria-hidden="true">
            <div class="bar-fill" style={{ width: `${Math.max(1, (d.value / max) * 100)}%`, background: d.color ?? 'var(--s1)' }} />
          </div>
          <div class="num">{fmt(d.value)}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Heatmap (weekday × hour) ----------------
const WD = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

export function Heatmap(props: { grid: number[][]; counts: number[][]; unit: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const { tip, setTip } = useTip();
  const left = 30;
  const top = 16;
  const cw = Math.max(8, Math.floor((width - left) / 24));
  const ch = 22;
  const max = Math.max(1, ...props.grid.flat());
  const levels = ['var(--q1)', 'var(--q2)', 'var(--q3)', 'var(--q4)', 'var(--q5)', 'var(--q6)', 'var(--q7)'];
  const color = (v: number) => (v <= 0 ? 'var(--surface-3)' : levels[Math.min(levels.length - 1, Math.floor((v / max) * levels.length))]!);
  return (
    <div class="chart" ref={ref}>
      <svg viewBox={`0 0 ${left + cw * 24} ${top + ch * 7 + 4}`} height={top + ch * 7 + 4} role="img" aria-label="แผนที่ความร้อนของจำนวนเงินแยกตามวันในสัปดาห์และชั่วโมง">
        {Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? <text key={h} x={left + h * cw + cw / 2} y={11} text-anchor="middle">{h}</text> : null))}
        {WD.map((d, r) => (
          <g key={d}>
            <text x={left - 6} y={top + r * ch + ch / 2 + 4} text-anchor="end">{d}</text>
            {props.grid[r]!.map((v, h) => (
              <rect
                key={h} x={left + h * cw + 1} y={top + r * ch + 1} width={cw - 2} height={ch - 2} rx="3" fill={color(v)}
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect();
                  setTip({
                    x: e.clientX - box.left, y: e.clientY - box.top,
                    content: (<><b>วัน{WD[r]} {String(h).padStart(2, '0')}:00–{String(h).padStart(2, '0')}:59</b><div class="kv"><span>{props.unit}</span><span class="num">{fmtBaht(v)}</span></div><div class="kv"><span>จำนวนรายการ</span><span class="num">{fmtInt(props.counts[r]![h]!)}</span></div></>),
                  });
                }}
                onMouseLeave={() => setTip(null)}
              />
            ))}
          </g>
        ))}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

// ---------------- Column histogram ----------------
export function Columns(props: { labels: string[]; values: number[]; tips?: string[]; height?: number; format?: (v: number) => string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const { tip, setTip } = useTip();
  const H = props.height ?? 150;
  const m = { l: 34, r: 6, t: 8, b: 30 };
  const n = props.values.length;
  const slot = (width - m.l - m.r) / Math.max(1, n);
  const bw = Math.min(24, slot - 6);
  const { max, ticks } = niceMax(Math.max(...props.values, 0));
  const ih = H - m.t - m.b;
  const y = (v: number) => m.t + ih - (v / max) * ih;
  return (
    <div class="chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${H}`} height={H} role="img">
        <g class="grid">
          {ticks.map((t) => (
            <g key={t}><line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} /><text x={m.l - 5} y={y(t) + 4} text-anchor="end">{compact(t)}</text></g>
          ))}
        </g>
        {props.values.map((v, i) => {
          const cx = m.l + slot * i + slot / 2;
          const h = Math.max(v > 0 ? 2 : 0, (v / max) * ih);
          const r = Math.min(4, h);
          return (
            <g key={i}>
              <path
                d={`M${cx - bw / 2},${m.t + ih} V${m.t + ih - h + r} a${r},${r} 0 0 1 ${r},-${r} h${bw - 2 * r} a${r},${r} 0 0 1 ${r},${r} V${m.t + ih} Z`}
                fill="var(--s1)"
              />
              <rect
                x={cx - slot / 2} y={m.t} width={slot} height={ih} fill="transparent"
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect();
                  setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content: <><b>{props.labels[i]}</b><div class="kv"><span>ค่า</span><span class="num">{(props.format ?? fmtInt)(v)}</span></div>{props.tips?.[i] && <div class="muted">{props.tips[i]}</div>}</> });
                }}
                onMouseLeave={() => setTip(null)}
              />
              <text x={cx} y={H - 12} text-anchor="middle">{props.labels[i]}</text>
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

// ---------------- Priority component bars ----------------
const COMP_LABELS: Record<string, string> = {
  volume: 'ปริมาณเงิน', frequency: 'ความถี่', flowThrough: 'Flow-through', quickHolding: 'ถือเงินสั้น',
  degree: 'Degree', betweenness: 'Betweenness', signals: 'สัญญาณ',
};
export function ComponentBars({ comps }: { comps: Record<string, number> }) {
  const keys = Object.keys(COMP_LABELS);
  const tip = keys.map((k) => `${COMP_LABELS[k]}: ${Math.round((comps[k] ?? 0) * 100)}%`).join('\n');
  return (
    <svg width="84" height="22" viewBox="0 0 84 22" role="img" aria-label={tip}>
      <title>{tip}</title>
      {keys.map((k, i) => {
        const h = Math.max(1.5, (comps[k] ?? 0) * 20);
        return <rect key={k} x={i * 12 + 1} y={21 - h} width="9" height={h} rx="2" fill="var(--s1)" opacity={0.35 + 0.65 * (comps[k] ?? 0)} />;
      })}
    </svg>
  );
}
export { COMP_LABELS };

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div class="legend">
      {items.map((i) => <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>)}
    </div>
  );
}

export function durLabel(ms: number | null): string {
  return fmtDuration(ms);
}

export function dayLabel(ts: number): string {
  return formatThaiDate(ts).replace(/ \d{4}$/, '');
}
