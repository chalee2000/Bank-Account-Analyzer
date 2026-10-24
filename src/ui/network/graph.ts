// สร้างกราฟ Cytoscape จากข้อมูลคดี — ใช้ร่วมกันระหว่างหน้าเครือข่ายและการสร้างภาพสำหรับรายงาน
//
// มุมมองเริ่มต้นคือ "แกนหลัก" (core): บัญชีเจ้าของ Statement + บัญชีที่เชื่อมกับเจ้าของตั้งแต่ 2 รายขึ้นไป
// + คู่บัญชีหลัก (ยอดสูงสุด) ของแต่ละเจ้าของ ส่วนที่เหลือรวมเป็นจุดสรุปเส้นประ "อีก N บัญชี" —
// เครือข่ายจริงมักมีคู่บัญชีที่เกิดรายการครั้งเดียวเป็นพัน ๆ ทำให้ผังเป็นก้อนอ่านโครงสร้างไม่ออก
//
// สี: ตามหลัก dataviz — จำนวนประเภทที่ใช้สีแทนค่าจำกัดไม่เกิน 4 (ชุดที่ผ่านการตรวจแบบทุกคู่) ที่เหลือเป็นสีเทา
// และทุกจุดมีรหัสธนาคาร/เลขท้ายบัญชีบนป้ายชื่อ จึงไม่พึ่งสีอย่างเดียว; ขนาด รูปทรงและเส้นขอบแทนบทบาทซ้ำอีกชั้น
import type cytoscapeNS from 'cytoscape';
import type { ElementDefinition, StylesheetJson } from 'cytoscape';
import type { Account, AnalysisResult } from '../../core/types';
import type { CaseState, Derived } from '../../store/model';
import { bankDisplay, formatAccountNumber } from '../../core/normalize';
import { fmtBaht } from '../../core/thai';

export type ColorBy = 'role' | 'bank' | 'community';
export type Scope = 'core' | 'all';

export interface NetOptions {
  scope: Scope;
  /** แกนหลัก: จำนวนคู่บัญชีสูงสุดที่แสดงต่อเจ้าของหนึ่งราย */
  topPerOwner: number;
  /** ยอดโอนรวมขั้นต่ำของคู่บัญชี (บาท) */
  minAmount: number;
  from?: number;
  to?: number;
  showCash: boolean;
  colorBy: ColorBy;
  showManual: boolean;
  /** แสดงเพื่อนบ้านทั้งหมดของบัญชีเหล่านี้ด้วย (มาจาก "ดูในเครือข่าย") */
  focus?: string[];
}

export interface Palette {
  owner: string;
  shared: string;
  plain: string;
  cash: string;
  agg: string;
  inflow: string;
  outflow: string;
  between: string;
  /** สีของธนาคาร/ชุมชนลำดับ 1–4 (ชุดที่ผ่าน validator แบบทุกคู่) */
  slots: string[];
  neutral: string;
  text: string;
  textMuted: string;
  surface: string;
  accent: string;
  warn: string;
}

export function livePalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    owner: v('--tone-violet', '#6a4df4'),
    shared: v('--s5', '#e87ba4'),
    plain: v('--net-plain', '#8795bd'),
    cash: v('--net-cash', '#9aa0bd'),
    agg: v('--net-agg', '#c3c9e2'),
    inflow: v('--s3', '#1baf7a'),
    outflow: v('--s2', '#eb6834'),
    between: v('--accent', '#5b4ee8'),
    slots: [v('--s7', '#6250d6'), v('--s6', '#008300'), v('--s5', '#e87ba4'), v('--s4', '#eda100')],
    neutral: v('--net-plain', '#8795bd'),
    text: v('--text-1', '#111'),
    textMuted: v('--text-3', '#777'),
    surface: v('--surface-1', '#fff'),
    accent: v('--accent', '#5b4ee8'),
    warn: v('--s4', '#eda100'),
  };
}

export const PRINT_PALETTE: Palette = {
  owner: '#6a4df4', shared: '#e87ba4', plain: '#8795bd', cash: '#9aa0bd', agg: '#c3c9e2',
  inflow: '#1baf7a', outflow: '#eb6834', between: '#5b4ee8',
  slots: ['#6250d6', '#008300', '#e87ba4', '#eda100'], neutral: '#8795bd',
  text: '#161614', textMuted: '#52514e', surface: '#ffffff', accent: '#5b4ee8', warn: '#eda100',
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const last4 = (n: string) => n.replace(/[^0-9X]/g, '').slice(-4);

/** เครือข่ายใหญ่มากจะช้า/อ่านยาก — คืนยอดขั้นต่ำที่ทำให้เหลือราว maxEdges เส้น (ยอดสูงสุดก่อน) ใช้กับมุมมอง "ทั้งหมด" */
export function autoMinAmount(res: AnalysisResult, maxEdges = 1500): number {
  const totals = res.pairs.map((p) => p.total).sort((a, b) => b - a);
  if (totals.length <= maxEdges) return 0;
  return Math.ceil(totals[maxEdges]!);
}

export interface LegendItem {
  label: string;
  color: string;
  shape: 'dot' | 'ring' | 'square' | 'dash' | 'line';
}

export interface BuiltGraph {
  elements: ElementDefinition[];
  nodeCount: number;
  edgeCount: number;
  legend: LegendItem[];
  /** สรุปสั้น ๆ ว่ากำลังแสดงอะไร (เช่น จำนวนบัญชีที่ถูกรวมเป็นจุดสรุป) */
  summary: string;
}

const OWNER_LABEL_FONT = 13;
const OWNER_LABEL_WIDTH = 140;

type Role = 'owner' | 'shared' | 'plain' | 'cash' | 'agg' | 'manual';
type Pair = { from: string; to: string; total: number; count: number };

/** ธนาคารที่มียอดรวมสูงสุดของ "ทั้งคดี" (ไม่ใช่เฉพาะส่วนที่แสดง) — สีจึงไม่เปลี่ยนเมื่อกรองข้อมูล */
function rankBanks(d: Derived): string[] {
  const sum = new Map<string, number>();
  for (const t of d.txns) {
    for (const id of [t.from, t.to]) {
      const b = d.accounts[id]?.bank;
      if (b) sum.set(b, (sum.get(b) ?? 0) + t.amount);
    }
  }
  return [...sum.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

function bankTag(a: Account): string {
  if (!a.bank) return '';
  return a.bank.startsWith('BOT') ? 'ธ.' + a.bank.slice(3) : a.bank;
}

function nodeLabel(a: Account, role: Role): { label: string; full: string } {
  if (a.kind === 'cash') return { label: 'เงินสด', full: a.name ?? 'เงินสด (ATM/สาขา)' };
  const name = (a.label || a.name || '').trim();
  const tail = a.number ? '••' + last4(a.number) : '';
  const head = [bankTag(a), tail].filter(Boolean).join(' ');
  const full = [name, [a.bank ? bankDisplay(a.bank) : '', a.number ? formatAccountNumber(a.number) : ''].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  if (role === 'owner') return { label: [clip(name || head, 24), name ? head : ''].filter(Boolean).join('\n'), full };
  if (role === 'shared') return { label: [clip(name, 16), head].filter(Boolean).join('\n') || head, full };
  return { label: head || clip(name, 14), full };
}

export function buildElements(d: Derived, res: AnalysisResult, st: CaseState, opts: NetOptions, pal: Palette): BuiltGraph {
  const useRange = opts.from !== undefined || opts.to !== undefined;
  const pairs = new Map<string, Pair>();
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

  const keep: Pair[] = [];
  for (const e of pairs.values()) {
    const a = d.accounts[e.from];
    const b = d.accounts[e.to];
    if (!a || !b || a.kind === 'unknown' || b.kind === 'unknown') continue;
    if (!opts.showCash && (a.kind === 'cash' || b.kind === 'cash')) continue;
    if (e.total < opts.minAmount) continue;
    keep.push(e);
  }

  const owners = new Set(Object.values(d.accounts).filter((a) => a.hasStatement && a.kind === 'account').map((a) => a.id));

  // ---- เลือกจุดที่จะแสดง ----
  const nodeIds = new Set<string>();
  const shownEdges: Pair[] = [];
  const agg: { owner: string; dir: 'in' | 'out'; total: number; count: number; accounts: Set<string> }[] = [];
  const sharedIds = new Set<string>();

  // เจ้าของแต่ละรายเชื่อมกับใครบ้าง (รวมสองทิศ)
  const ownersOf = new Map<string, Set<string>>();
  const touch = (other: string, owner: string) => (ownersOf.get(other) ?? ownersOf.set(other, new Set()).get(other)!).add(owner);
  for (const e of keep) {
    if (owners.has(e.from) && !owners.has(e.to)) touch(e.to, e.from);
    if (owners.has(e.to) && !owners.has(e.from)) touch(e.from, e.to);
  }
  for (const [id, os] of ownersOf) if (os.size >= 2 && d.accounts[id]?.kind === 'account') sharedIds.add(id);

  if (opts.scope === 'all') {
    for (const e of keep) { nodeIds.add(e.from); nodeIds.add(e.to); shownEdges.push(e); }
    if (!useRange) for (const o of owners) nodeIds.add(o);
  } else {
    for (const o of owners) nodeIds.add(o);
    // คู่บัญชีหลักของแต่ละเจ้าของ (ยอดรวมสองทิศ สูงสุดก่อน)
    const per = new Map<string, Map<string, number>>();
    for (const e of keep) {
      if (owners.has(e.from) && !owners.has(e.to)) (per.get(e.from) ?? per.set(e.from, new Map()).get(e.from)!).set(e.to, ((per.get(e.from)?.get(e.to)) ?? 0) + e.total);
      if (owners.has(e.to) && !owners.has(e.from)) (per.get(e.to) ?? per.set(e.to, new Map()).get(e.to)!).set(e.from, ((per.get(e.to)?.get(e.from)) ?? 0) + e.total);
    }
    for (const [, m] of per) {
      const top = [...m.entries()].filter(([id]) => d.accounts[id]?.kind === 'account').sort((a, b) => b[1] - a[1]).slice(0, opts.topPerOwner);
      for (const [id] of top) nodeIds.add(id);
    }
    // บัญชีร่วม (เชื่อมหลายเจ้าของ) — แสดงเสมอ (จำกัด 60 รายที่ยอดสูงสุด)
    const sharedTotal = (id: string) => keep.reduce((a, e) => a + (e.from === id || e.to === id ? e.total : 0), 0);
    [...sharedIds].sort((a, b) => sharedTotal(b) - sharedTotal(a)).slice(0, 60).forEach((id) => nodeIds.add(id));
    // จุดเงินสดของเจ้าของ
    if (opts.showCash) for (const e of keep) { if (d.accounts[e.from]?.kind === 'cash' || d.accounts[e.to]?.kind === 'cash') { nodeIds.add(e.from); nodeIds.add(e.to); } }
    // บัญชีที่ผู้ใช้เลือกดู: แสดงเพื่อนบ้านทั้งหมด (สูงสุด 150 ตามยอด)
    for (const f of opts.focus ?? []) {
      if (!d.accounts[f]) continue;
      nodeIds.add(f);
      keep.filter((e) => e.from === f || e.to === f).sort((a, b) => b.total - a.total).slice(0, 150).forEach((e) => { nodeIds.add(e.from); nodeIds.add(e.to); });
    }
    const aggMap = new Map<string, (typeof agg)[number]>();
    for (const e of keep) {
      if (nodeIds.has(e.from) && nodeIds.has(e.to)) { shownEdges.push(e); continue; }
      // เส้นที่ปลายด้านหนึ่งไม่ถูกแสดง → รวมเป็นจุดสรุปของเจ้าของ
      const owner = owners.has(e.from) && nodeIds.has(e.from) ? e.from : owners.has(e.to) && nodeIds.has(e.to) ? e.to : null;
      if (!owner) continue;
      const dir = owner === e.from ? 'out' : 'in';
      const other = owner === e.from ? e.to : e.from;
      const k = owner + '|' + dir;
      const a = aggMap.get(k) ?? { owner, dir, total: 0, count: 0, accounts: new Set<string>() };
      a.total += e.total;
      a.count += e.count;
      a.accounts.add(other);
      aggMap.set(k, a);
    }
    agg.push(...aggMap.values());
  }

  // ---- สี ----
  const bankRank = rankBanks(d);
  const commSize = new Map<number, number>();
  for (const m of Object.values(res.metrics)) commSize.set(m.community, (commSize.get(m.community) ?? 0) + 1);
  const commRank = [...commSize.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const roleOf = (id: string): Role => {
    const a = d.accounts[id]!;
    if (a.kind === 'cash') return 'cash';
    if (owners.has(id)) return 'owner';
    if (sharedIds.has(id)) return 'shared';
    return 'plain';
  };
  const roleColor = (r: Role) => (r === 'owner' ? pal.owner : r === 'shared' ? pal.shared : r === 'cash' ? pal.cash : r === 'agg' ? pal.agg : pal.plain);
  const colorOf = (id: string): string => {
    const a = d.accounts[id]!;
    const role = roleOf(id);
    if (role === 'cash') return pal.cash;
    if (opts.colorBy === 'bank') {
      const i = a.bank ? bankRank.indexOf(a.bank) : -1;
      return i >= 0 && i < pal.slots.length ? pal.slots[i]! : pal.neutral;
    }
    if (opts.colorBy === 'community') {
      const c = res.metrics[id]?.community;
      const i = c === undefined ? -1 : commRank.indexOf(c);
      return i >= 0 && i < pal.slots.length ? pal.slots[i]! : pal.neutral;
    }
    return roleColor(role);
  };

  const used = [...nodeIds];
  const legend: LegendItem[] = [];
  if (opts.colorBy === 'role') {
    legend.push({ label: 'เจ้าของ Statement', color: pal.owner, shape: 'ring' });
    if (used.some((id) => roleOf(id) === 'shared')) legend.push({ label: 'บัญชีร่วม (เชื่อมหลายเจ้าของ)', color: pal.shared, shape: 'dot' });
    legend.push({ label: 'คู่บัญชี', color: pal.plain, shape: 'dot' });
  } else {
    const ranking = opts.colorBy === 'bank' ? bankRank : commRank.map(String);
    const present = new Set(used.map((id) => (opts.colorBy === 'bank' ? d.accounts[id]?.bank : String(res.metrics[id]?.community))));
    ranking.slice(0, pal.slots.length).forEach((k, i) => {
      if (present.has(k)) legend.push({ label: opts.colorBy === 'bank' ? bankDisplay(k) : `ชุมชน ${Number(k) + 1}`, color: pal.slots[i]!, shape: 'dot' });
    });
    legend.push({ label: opts.colorBy === 'bank' ? 'ธนาคารอื่น (ดูรหัสบนป้าย)' : 'ชุมชนอื่น', color: pal.neutral, shape: 'dot' });
  }
  if (used.some((id) => d.accounts[id]?.kind === 'cash')) legend.push({ label: 'เงินสด (ATM/สาขา)', color: pal.cash, shape: 'square' });
  if (agg.length) legend.push({ label: 'คู่บัญชีอื่นที่รวมไว้', color: pal.agg, shape: 'dash' });
  legend.push({ label: 'เงินเข้าเจ้าของ', color: pal.inflow, shape: 'line' }, { label: 'เงินออกจากเจ้าของ', color: pal.outflow, shape: 'line' });

  // ---- ลำดับเจ้าของบนวงกลม: เจ้าของที่ใช้บัญชีร่วมกันมากให้อยู่ติดกัน (ลดเส้นไขว้) ----
  const ownerVolume = (id: string) => (res.metrics[id] ? res.metrics[id]!.weightedIn + res.metrics[id]!.weightedOut : 0);
  const shareCount = new Map<string, number>();
  for (const [, os] of ownersOf) {
    const arr = [...os].filter((o) => nodeIds.has(o));
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const k = [arr[i]!, arr[j]!].sort().join('|');
      shareCount.set(k, (shareCount.get(k) ?? 0) + 1);
    }
  }
  const ringOrder = (() => {
    const left = used.filter((id) => owners.has(id)).sort((a, b) => ownerVolume(b) - ownerVolume(a));
    if (left.length <= 2) return left;
    const out = [left.shift()!];
    while (left.length) {
      const last = out[out.length - 1]!;
      let bi = 0;
      let bs = -1;
      left.forEach((id, i) => {
        const sc = shareCount.get([last, id].sort().join('|')) ?? 0;
        if (sc > bs) { bs = sc; bi = i; }
      });
      out.push(left.splice(bi, 1)[0]!);
    }
    return out;
  })();

  // ---- สร้าง element ----
  const maxW = Math.max(1, ...shownEdges.map((e) => e.total), ...agg.map((a) => a.total));
  const edgeWidth = (total: number) => 1.2 + 5.3 * (Math.log10(1 + total) / Math.log10(1 + maxW));
  const edgeColor = (from: string, to: string) => {
    const fo = owners.has(from);
    const to_ = owners.has(to);
    if (fo && to_) return pal.between;
    if (to_) return pal.inflow;
    if (fo) return pal.outflow;
    return pal.plain;
  };
  const elements: ElementDefinition[] = [];
  for (const id of nodeIds) {
    const a = d.accounts[id]!;
    const m = res.metrics[id];
    const w = m ? m.weightedIn + m.weightedOut : 0;
    const role = roleOf(id);
    const lg = Math.log10(1 + w);
    const size = role === 'owner' ? 46 + Math.min(30, lg * 4.2) : role === 'cash' ? 24 : role === 'shared' ? 24 + Math.min(18, lg * 2.4) : 14 + Math.min(18, lg * 2.6);
    const { label, full } = nodeLabel(a, role);
    elements.push({
      data: {
        id, label, full, role, kind: a.kind, size, color: colorOf(id), fs: role === 'owner' ? OWNER_LABEL_FONT : role === 'shared' ? 11 : 9.5,
        hasStatement: a.hasStatement ? 1 : 0, bridge: m?.isBridge ? 1 : 0, bank: a.bank ?? '',
        ...(role === 'owner' ? { ring: ringOrder.indexOf(id), ringN: ringOrder.length, tw: OWNER_LABEL_WIDTH } : {}),
      },
      classes: role,
    });
  }
  let n = 0;
  for (const e of shownEdges) {
    const c = edgeColor(e.from, e.to);
    elements.push({
      data: { id: 'e' + n++, source: e.from, target: e.to, total: e.total, count: e.count, width: edgeWidth(e.total), color: c, label: `${fmtBaht(e.total)} ฿ ×${e.count}` },
    });
  }
  for (const a of agg) {
    const id = `agg:${a.owner}:${a.dir}`;
    elements.push({
      data: {
        id, label: `+${a.accounts.size.toLocaleString('en-US')}`, full: `${a.dir === 'in' ? 'รับจาก' : 'โอนให้'}คู่บัญชีอื่นอีก ${a.accounts.size.toLocaleString('en-US')} บัญชี รวม ${fmtBaht(a.total)} บาท (${a.count.toLocaleString('en-US')} รายการ)`,
        role: 'agg', kind: 'agg', size: 20 + Math.min(16, Math.log10(1 + a.accounts.size) * 7), color: pal.agg, fs: 10, hasStatement: 0, bridge: 0, bank: '', owner: a.owner,
      },
      classes: 'agg',
    });
    elements.push({
      data: {
        id: 'ea' + n++, source: a.dir === 'in' ? id : a.owner, target: a.dir === 'in' ? a.owner : id, total: a.total, count: a.count, width: edgeWidth(a.total),
        color: a.dir === 'in' ? pal.inflow : pal.outflow, label: `${fmtBaht(a.total)} ฿ ×${a.count}`,
      },
      classes: 'agg-edge',
    });
  }

  if (opts.showManual) {
    for (const mn of st.manualNodes) {
      elements.push({ data: { id: 'm:' + mn.id, label: clip(mn.label, 18), full: mn.label, role: 'manual', kind: 'manual', size: 28, color: pal.warn, fs: 10, hasStatement: 0, bridge: 0, bank: '' }, classes: 'manual' });
    }
    const exists = (id: string) => nodeIds.has(id) || st.manualNodes.some((x) => 'm:' + x.id === id);
    st.manualLinks.forEach((l, i) => {
      const a = st.manualNodes.some((x) => x.id === l.a) ? 'm:' + l.a : l.a;
      const b = st.manualNodes.some((x) => x.id === l.b) ? 'm:' + l.b : l.b;
      if (exists(a) && exists(b)) elements.push({ data: { id: 'ml' + i, source: a, target: b, label: l.label, width: 1.6, total: 0, count: 0, color: pal.warn }, classes: 'manual-link' });
    });
  }

  const hidden = agg.reduce((s, a) => s + a.accounts.size, 0);
  const nOwners = used.filter((id) => owners.has(id)).length;
  const summary =
    opts.scope === 'core'
      ? `แกนหลัก: ${nOwners} เจ้าของ Statement · ${used.filter((id) => sharedIds.has(id) && !owners.has(id)).length} บัญชีร่วม · ${used.length - nOwners} บัญชีที่แสดง${hidden ? ` · รวมคู่บัญชีอื่นไว้ในจุดเส้นประอีก ${hidden.toLocaleString('en-US')} บัญชี` : ''}`
      : `ทุกบัญชีที่ยอดโอนรวมตั้งแต่ ${fmtBaht(opts.minAmount)} บาท`;
  return { elements, nodeCount: nodeIds.size + agg.length, edgeCount: shownEdges.length + agg.length, legend, summary };
}

export function makeStyle(pal: Palette): StylesheetJson {
  const font = 'Noto Sans Thai, system-ui, sans-serif';
  return [
    {
      selector: 'node',
      style: {
        'background-color': 'data(color)', width: 'data(size)', height: 'data(size)', label: 'data(label)', 'font-size': 'data(fs)',
        'font-family': font, color: pal.text, 'text-valign': 'bottom', 'text-margin-y': 4, 'text-wrap': 'wrap', 'text-max-width': 140,
        'text-outline-color': pal.surface, 'text-outline-width': 2.5, 'text-outline-opacity': 0.95,
        'border-width': 1.5, 'border-color': pal.surface, 'border-opacity': 1, 'min-zoomed-font-size': 7,
        'underlay-color': 'data(color)', 'underlay-opacity': 0.16, 'underlay-padding': 5, 'underlay-shape': 'ellipse',
      },
    },
    {
      selector: 'node.owner',
      style: {
        'font-weight': 'bold', 'border-width': 5, 'border-color': pal.surface, 'underlay-opacity': 0.3, 'underlay-padding': 12,
        'z-index': 30, 'min-zoomed-font-size': 0, color: pal.text, 'text-max-width': 'data(tw)',
      },
    },
    { selector: 'node.shared', style: { 'border-width': 3, 'underlay-opacity': 0.28, 'underlay-padding': 8, 'z-index': 20, 'font-weight': 'bold' } },
    { selector: 'node.cash', style: { shape: 'round-rectangle', 'border-style': 'dashed', 'border-color': pal.textMuted, 'border-width': 1.5, 'underlay-opacity': 0.08 } },
    {
      selector: 'node.agg',
      style: {
        'border-style': 'dashed', 'border-color': pal.textMuted, 'border-width': 1.5, 'background-opacity': 0.6, 'underlay-opacity': 0,
        'text-valign': 'center', 'text-margin-y': 0, color: pal.text, 'font-weight': 'bold', 'text-outline-width': 0,
      },
    },
    { selector: 'node.manual', style: { shape: 'diamond', 'border-style': 'dotted', 'border-color': pal.textMuted, 'border-width': 2 } },
    { selector: 'node[bridge = 1]', style: { 'border-color': pal.accent, 'border-width': 4 } },
    { selector: 'node.owner[bridge = 1]', style: { 'border-color': pal.surface, 'border-width': 5 } },
    {
      selector: 'edge',
      style: {
        width: 'data(width)', 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.85,
        'curve-style': 'bezier', opacity: 0.5, 'font-size': 9, color: pal.textMuted, 'text-background-color': pal.surface, 'text-background-opacity': 0.9,
        'text-background-padding': '1px', 'font-family': font,
      },
    },
    { selector: 'edge.agg-edge', style: { 'line-style': 'dashed', opacity: 0.42 } },
    { selector: 'edge.manual-link', style: { 'line-style': 'dashed', 'target-arrow-shape': 'none', label: 'data(label)', opacity: 0.9 } },
    { selector: '.faded', style: { opacity: 0.1, 'underlay-opacity': 0 } },
    { selector: 'node.hl', style: { 'border-color': pal.accent, 'border-width': 4, 'underlay-opacity': 0.4, 'z-index': 40 } },
    { selector: 'edge.hl', style: { opacity: 0.95, label: 'data(label)', 'z-index': 40 } },
    { selector: 'node.hov', style: { label: 'data(full)', 'font-size': 12, 'z-index': 999, 'min-zoomed-font-size': 0, 'text-valign': 'bottom', 'text-margin-y': 6 } },
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

/**
 * รัศมีวงรีของเจ้าของ Statement: ต้องกว้างพอให้เจ้าของ n รายไม่ซ้อนกัน (ราว 26 หน่วยต่อราย) และโตตามจำนวนจุดทั้งหมด
 * เพื่อให้คู่บัญชีมีที่วาง — แต่ไม่ใหญ่เกินจำเป็นเมื่อจุดน้อย (ไม่เช่นนั้นผังถูกย่อจนตัวอักษรเล็ก)
 */
export function ownerRingRadius(ownerCount: number, nodeTotal: number): number {
  return Math.min(600, Math.max(240, 26 * ownerCount, 80 + 9 * nodeTotal));
}

/** ตำแหน่งตายตัวของเจ้าของ Statement บนวงรี (2–14 ราย) — ไม่ให้เจ้าของซ้อนกันเมื่อใช้บัญชีร่วมกันมาก */
export function ownerRing(elements: ElementDefinition[]): { nodeId: string; position: { x: number; y: number } }[] {
  const owners = elements.filter((e) => e.data.role === 'owner' && typeof e.data.ring === 'number' && e.data.ring >= 0);
  const n = owners.length;
  if (n < 2 || n > 14) return [];
  const R = ownerRingRadius(n, elements.filter((e) => !('source' in e.data)).length);
  return owners.map((e) => {
    const a = (n === 2 ? Math.PI : -Math.PI / 2) + (2 * Math.PI * (e.data.ring as number)) / n;
    return { nodeId: e.data.id as string, position: { x: Math.cos(a) * R * 1.25, y: Math.sin(a) * R } };
  });
}

export interface Insets { top: number; right: number; bottom: number; left: number }

/**
 * คำนวณ zoom/pan ให้กราฟ (bounding box ในพิกัดโมเดล) พอดีกับพื้นที่ที่มองเห็นจริง — เว้นขอบแต่ละด้านไม่เท่ากันได้
 * (Cytoscape `fit()` รองรับ padding ค่าเดียว จึงจัดวางไม่หลบแผงเครื่องมือ/คำอธิบายสีที่ลอยทับผัง)
 * พิกัดบนจอ = พิกัดโมเดล × zoom + pan
 */
export function computeFit(
  bb: { x1: number; y1: number; w: number; h: number },
  view: { w: number; h: number },
  insets: Insets,
  limits: { minZoom?: number; maxZoom?: number } = {},
): { zoom: number; pan: { x: number; y: number } } {
  const availW = Math.max(1, view.w - insets.left - insets.right);
  const availH = Math.max(1, view.h - insets.top - insets.bottom);
  const fit = Math.min(availW / Math.max(bb.w, 1), availH / Math.max(bb.h, 1));
  const zoom = Math.min(Math.max(fit, limits.minZoom ?? 0.05), limits.maxZoom ?? 4);
  return {
    zoom,
    pan: {
      x: insets.left + (availW - bb.w * zoom) / 2 - bb.x1 * zoom,
      y: insets.top + (availH - bb.h * zoom) / 2 - bb.y1 * zoom,
    },
  };
}

/**
 * ป้ายชื่อเจ้าของ Statement ต้องอ่านได้เสมอ: ผังใหญ่ถูกย่อ ตัวอักษรจึงเล็กลงตาม — ขยายขนาดตัวอักษรในพิกัดโมเดลชดเชย
 * (ทำเฉพาะเจ้าของ เพราะมีน้อยและอยู่ห่างกันบนวงรี ไม่ทับกัน; จุดอื่นดูชื่อเต็มได้ตอนชี้)
 */
export function ownerLabelScale(zoom: number): number {
  return Math.min(2.2, Math.max(1, 0.85 / Math.max(zoom, 0.05)));
}
export function scaleOwnerLabels(cy: cytoscapeNS.Core): void {
  const k = ownerLabelScale(cy.zoom());
  cy.nodes('.owner').forEach((n) => {
    n.data('fs', OWNER_LABEL_FONT * k);
    n.data('tw', OWNER_LABEL_WIDTH * k);
  });
}

/** จัดผังให้พอดีในพื้นที่ที่ไม่ถูกบัง (ไม่ขยายเกิน 1.6 เท่าเมื่อมีจุดน้อย) */
export function fitInView(cy: cytoscapeNS.Core, insets: Insets, eles?: cytoscapeNS.Collection): void {
  const col = eles ?? cy.elements();
  if (col.empty()) return;
  const bb = col.boundingBox({ includeLabels: true, includeOverlays: false });
  const { zoom, pan } = computeFit({ x1: bb.x1, y1: bb.y1, w: bb.w, h: bb.h }, { w: cy.width(), h: cy.height() }, insets, { minZoom: cy.minZoom(), maxZoom: 1.6 });
  cy.viewport({ zoom, pan });
  scaleOwnerLabels(cy);
}

/** ตัวเลือกจัดวาง — แกนหลัก (จุดไม่เยอะ) ใช้คุณภาพสูงและดันเจ้าของให้ห่างกันเพื่อเห็นบัญชีร่วมตรงกลาง */
export const layoutOptions = (nodeCount: number, animate = false, fixed: { nodeId: string; position: { x: number; y: number } }[] = []) => ({
  name: 'fcose', quality: nodeCount > 400 ? 'default' : 'proof', randomize: true, animate, animationDuration: 450, fit: true, padding: 50,
  nodeRepulsion: (n: { data: (k: string) => unknown }) => (n.data('role') === 'owner' ? 60000 : n.data('role') === 'shared' ? 14000 : 7000),
  idealEdgeLength: (e: { source: () => { data: (k: string) => unknown }; target: () => { data: (k: string) => unknown } }) =>
    e.source().data('role') === 'owner' && e.target().data('role') === 'owner' ? 280 : e.source().data('role') === 'agg' || e.target().data('role') === 'agg' ? 60 : 150,
  edgeElasticity: 0.35, gravity: 0.22, gravityRange: 3.8, nodeSeparation: 100, packComponents: fixed.length === 0, nodeDimensionsIncludeLabels: nodeCount <= 400,
  ...(fixed.length && nodeCount <= 400 ? { fixedNodeConstraint: fixed } : {}),
});

/** สร้างภาพเครือข่าย PNG (พื้นสว่าง เหมาะกับการพิมพ์) สำหรับรายงาน */
export async function renderNetworkImage(
  d: Derived, res: AnalysisResult, st: CaseState, opts: Partial<NetOptions> = {}, size = { w: 1500, h: 950 },
): Promise<{ dataUrl: string; nodeCount: number; edgeCount: number; legend: BuiltGraph['legend']; summary: string } | null> {
  const built = buildElements(d, res, st, {
    scope: 'core', topPerOwner: 12, minAmount: 0, showCash: true, colorBy: 'role', showManual: true, ...opts,
  }, PRINT_PALETTE);
  if (built.nodeCount === 0) return null;
  const cytoscape = await loadCytoscape();
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${size.w}px;height:${size.h}px;`;
  document.body.appendChild(host);
  try {
    const cy = cytoscape({ container: host, elements: built.elements, style: makeStyle(PRINT_PALETTE), layout: { name: 'null' } as never, headless: false });
    const layout = cy.layout(layoutOptions(built.nodeCount, false, ownerRing(built.elements)) as never);
    await new Promise<void>((resolve) => { layout.one('layoutstop', () => resolve()); layout.run(); });
    fitInView(cy, { top: 30, right: 30, bottom: 30, left: 30 });
    const dataUrl = cy.png({ output: 'base64uri', scale: 1.5, bg: '#ffffff', full: false }) as string;
    cy.destroy();
    return { dataUrl, nodeCount: built.nodeCount, edgeCount: built.edgeCount, legend: built.legend, summary: built.summary };
  } finally {
    host.remove();
  }
}
