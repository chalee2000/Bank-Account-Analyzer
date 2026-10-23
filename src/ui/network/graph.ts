// สร้างกราฟ Cytoscape จากข้อมูลคดี — ใช้ร่วมกันระหว่างหน้าเครือข่ายและการสร้างภาพสำหรับรายงาน
import type cytoscapeNS from 'cytoscape';
import type { ElementDefinition, StylesheetJson } from 'cytoscape';
import type { AnalysisResult } from '../../core/types';
import type { CaseState, Derived } from '../../store/model';
import { accountLabel } from '../../analysis/ctx';
import { bankDisplay } from '../../core/normalize';
import { fmtBaht } from '../../core/thai';

export type ColorBy = 'bank' | 'community' | 'component';

export interface NetOptions {
  minAmount: number;
  from?: number;
  to?: number;
  showCash: boolean;
  colorBy: ColorBy;
  showManual: boolean;
}

export interface Palette {
  cat: string[];
  gray: string;
  text: string;
  textMuted: string;
  surface: string;
  edge: string;
  edgeStrong: string;
  accent: string;
  warn: string;
}

export function livePalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    cat: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--s${i}`, '#2a78d6')),
    gray: v('--border-strong', '#999'),
    text: v('--text-1', '#111'),
    textMuted: v('--text-3', '#777'),
    surface: v('--surface-1', '#fff'),
    edge: v('--border-strong', '#bbb'),
    edgeStrong: v('--text-3', '#888'),
    accent: v('--accent', '#2a78d6'),
    warn: v('--s4', '#eda100'),
  };
}

export const PRINT_PALETTE: Palette = {
  cat: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  gray: '#9a9a94', text: '#161614', textMuted: '#52514e', surface: '#ffffff', edge: '#b9b8b0', edgeStrong: '#6f6e68', accent: '#2a78d6', warn: '#eda100',
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** เครือข่ายใหญ่มากจะช้า/อ่านยาก — ถ้ามีคู่บัญชีเกินกำหนด คืนยอดขั้นต่ำที่ทำให้เหลือราว maxEdges เส้น (ยอดสูงสุดก่อน) */
export function autoMinAmount(res: AnalysisResult, maxEdges = 1500): number {
  const totals = res.pairs.map((p) => p.total).sort((a, b) => b - a);
  if (totals.length <= maxEdges) return 0;
  return Math.ceil(totals[maxEdges]! );
}

export interface BuiltGraph {
  elements: ElementDefinition[];
  nodeCount: number;
  edgeCount: number;
  legend: { label: string; color: string }[];
}

export function buildElements(d: Derived, res: AnalysisResult, st: CaseState, opts: NetOptions, pal: Palette): BuiltGraph {
  const useRange = opts.from !== undefined || opts.to !== undefined;
  type E = { from: string; to: string; total: number; count: number };
  const pairs = new Map<string, E>();
  if (!useRange) {
    for (const p of res.pairs) pairs.set(p.from + '\u0000' + p.to, p);
  } else {
    for (const t of d.txns) {
      if (t.kind === 'fee' || t.kind === 'interest') continue;
      if (opts.from !== undefined && t.ts < opts.from) continue;
      if (opts.to !== undefined && t.ts > opts.to) continue;
      const k = t.from + '\u0000' + t.to;
      const e = pairs.get(k);
      if (e) { e.total += t.amount; e.count++; } else pairs.set(k, { from: t.from, to: t.to, total: t.amount, count: 1 });
    }
  }

  const keep: E[] = [];
  for (const e of pairs.values()) {
    const a = d.accounts[e.from];
    const b = d.accounts[e.to];
    if (!a || !b || a.kind === 'unknown' || b.kind === 'unknown') continue;
    if (!opts.showCash && (a.kind === 'cash' || b.kind === 'cash')) continue;
    if (e.total < opts.minAmount) continue;
    keep.push(e);
  }

  const nodeIds = new Set<string>();
  for (const e of keep) { nodeIds.add(e.from); nodeIds.add(e.to); }
  // บัญชีที่มี Statement แต่ไม่มีเส้นเชื่อมก็แสดง (เห็นว่าเป็นบัญชีโดดเดี่ยว)
  for (const a of Object.values(d.accounts)) if (a.hasStatement && !useRange) nodeIds.add(a.id);

  // สีตามกลุ่ม
  const groupKey = (id: string): string => {
    const a = d.accounts[id];
    if (!a) return '';
    if (opts.colorBy === 'bank') return a.kind === 'cash' ? 'cash' : a.bank ?? '';
    const m = res.metrics[id];
    if (!m) return a.kind === 'cash' ? 'cash' : 'none';
    return String(opts.colorBy === 'community' ? m.community : m.component);
  };
  const counts = new Map<string, number>();
  for (const id of nodeIds) counts.set(groupKey(id), (counts.get(groupKey(id)) ?? 0) + 1);
  const ranked = [...counts.entries()].filter(([k]) => k && k !== 'cash' && k !== 'none').sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const colorOf = (k: string) => {
    if (k === 'cash' || k === 'none' || !k) return pal.gray;
    const i = ranked.indexOf(k);
    return i >= 0 && i < pal.cat.length ? pal.cat[i]! : pal.gray;
  };
  const legend = ranked.slice(0, pal.cat.length).map((k, i) => ({
    color: pal.cat[i]!,
    label: opts.colorBy === 'bank' ? bankDisplay(k) : opts.colorBy === 'community' ? `ชุมชน ${Number(k) + 1}` : `กลุ่ม ${Number(k) + 1}`,
  }));
  if (ranked.length > pal.cat.length) legend.push({ color: pal.gray, label: 'อื่น ๆ' });

  const maxW = Math.max(1, ...keep.map((e) => e.total));
  const elements: ElementDefinition[] = [];
  for (const id of nodeIds) {
    const a = d.accounts[id]!;
    const m = res.metrics[id];
    const w = m ? m.weightedIn + m.weightedOut : 0;
    const size = a.kind === 'cash' ? 22 : 22 + Math.min(34, Math.log10(1 + w) * 5.5);
    const label = a.kind === 'cash' ? 'เงินสด' : clip(a.label || a.name || accountLabel(a, false), 18);
    elements.push({
      data: {
        id, label, kind: a.kind, size, color: colorOf(groupKey(id)), hasStatement: a.hasStatement ? 1 : 0,
        bridge: m?.isBridge ? 1 : 0, bank: a.bank ?? '',
      },
      classes: a.kind === 'cash' ? 'cash' : '',
    });
  }
  keep.forEach((e, i) => {
    elements.push({
      data: {
        id: 'e' + i, source: e.from, target: e.to, total: e.total, count: e.count,
        width: 1 + 4.5 * (Math.log10(1 + e.total) / Math.log10(1 + maxW)),
        label: `${fmtBaht(e.total)} ฿ ×${e.count}`,
      },
    });
  });

  if (opts.showManual) {
    for (const n of st.manualNodes) {
      elements.push({ data: { id: 'm:' + n.id, label: clip(n.label, 18), kind: 'manual', size: 26, color: pal.warn, hasStatement: 0, bridge: 0, bank: '' }, classes: 'manual' });
    }
    const exists = (id: string) => nodeIds.has(id) || st.manualNodes.some((n) => 'm:' + n.id === id);
    st.manualLinks.forEach((l, i) => {
      const a = st.manualNodes.some((n) => n.id === l.a) ? 'm:' + l.a : l.a;
      const b = st.manualNodes.some((n) => n.id === l.b) ? 'm:' + l.b : l.b;
      if (exists(a) && exists(b)) elements.push({ data: { id: 'ml' + i, source: a, target: b, label: l.label, width: 1.5, total: 0, count: 0 }, classes: 'manual-link' });
    });
  }
  return { elements, nodeCount: nodeIds.size, edgeCount: keep.length, legend };
}

export function makeStyle(pal: Palette): StylesheetJson {
  return [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)', width: 'data(size)', height: 'data(size)', label: 'data(label)', 'font-size': 10,
        'font-family': 'Noto Sans Thai, system-ui, sans-serif', color: pal.text, 'text-valign': 'bottom', 'text-margin-y': 4,
        'text-background-color': pal.surface, 'text-background-opacity': 0.75, 'text-background-padding': '1px',
        'border-width': 'mapData(hasStatement, 0, 1, 1, 3.5)', 'border-color': pal.text, 'border-opacity': 0.75, 'min-zoomed-font-size': 7,
      },
    },
    { selector: 'node.cash', style: { shape: 'round-rectangle', 'border-style': 'dashed' } },
    { selector: 'node.manual', style: { shape: 'diamond', 'border-style': 'dotted', 'border-width': 2 } },
    { selector: 'node[bridge = 1]', style: { 'border-color': pal.accent, 'border-width': 4, 'border-opacity': 1 } },
    {
      selector: 'edge',
      style: {
        width: 'data(width)', 'line-color': pal.edge, 'target-arrow-color': pal.edgeStrong, 'target-arrow-shape': 'triangle', 'arrow-scale': 0.9,
        'curve-style': 'bezier', opacity: 0.85, 'font-size': 9, color: pal.textMuted, 'text-background-color': pal.surface, 'text-background-opacity': 0.9,
        'text-background-padding': '1px', 'font-family': 'Noto Sans Thai, system-ui, sans-serif',
      },
    },
    { selector: 'edge.manual-link', style: { 'line-style': 'dashed', 'line-color': pal.warn, 'target-arrow-color': pal.warn, label: 'data(label)', 'target-arrow-shape': 'none' } },
    { selector: '.faded', style: { opacity: 0.12 } },
    { selector: 'node.hl', style: { 'border-color': pal.accent, 'border-width': 4, 'border-opacity': 1 } },
    { selector: 'edge.hl', style: { 'line-color': pal.accent, 'target-arrow-color': pal.accent, opacity: 1, label: 'data(label)' } },
    { selector: 'node:selected', style: { 'border-color': pal.accent, 'border-width': 5 } },
  ] as unknown as StylesheetJson;
}

export async function loadCytoscape(): Promise<typeof cytoscapeNS> {
  const [{ default: cytoscape }, { default: fcose }] = await Promise.all([import('cytoscape'), import('cytoscape-fcose')]);
  const g = globalThis as unknown as { __cyFcose?: boolean };
  if (!g.__cyFcose) {
    (cytoscape as unknown as { use: (x: unknown) => void }).use(fcose);
    g.__cyFcose = true;
  }
  return cytoscape;
}

export const layoutOptions = (animate = false) => ({
  name: 'fcose', quality: 'default', randomize: true, animate, animationDuration: 400, fit: true, padding: 40,
  nodeRepulsion: 9000, idealEdgeLength: 110, edgeElasticity: 0.35, gravity: 0.3, nodeSeparation: 90, packComponents: true,
});

/** สร้างภาพเครือข่าย PNG (พื้นสว่าง เหมาะกับการพิมพ์) สำหรับรายงาน */
export async function renderNetworkImage(
  d: Derived, res: AnalysisResult, st: CaseState, opts: NetOptions, size = { w: 1500, h: 950 },
): Promise<{ dataUrl: string; nodeCount: number; edgeCount: number; legend: BuiltGraph['legend'] } | null> {
  const built = buildElements(d, res, st, { ...opts, minAmount: Math.max(opts.minAmount, autoMinAmount(res)) }, PRINT_PALETTE);
  if (built.nodeCount === 0) return null;
  const cytoscape = await loadCytoscape();
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${size.w}px;height:${size.h}px;`;
  document.body.appendChild(host);
  try {
    const cy = cytoscape({ container: host, elements: built.elements, style: makeStyle(PRINT_PALETTE), layout: { name: 'null' } as never, headless: false });
    const layout = cy.layout(layoutOptions(false) as never);
    await new Promise<void>((resolve) => { layout.one('layoutstop', () => resolve()); layout.run(); });
    cy.fit(undefined, 30);
    const dataUrl = cy.png({ output: 'base64uri', scale: 1.5, bg: '#ffffff', full: false }) as string;
    cy.destroy();
    return { dataUrl, nodeCount: built.nodeCount, edgeCount: built.edgeCount, legend: built.legend };
  } finally {
    host.remove();
  }
}
