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
import type { CaseState, Derived, LayoutMode, NetNote, NetworkViewOptions, SavedPositions } from '../../store/model';
import { bankDisplay, formatAccountNumber } from '../../core/normalize';
import { fmtBaht, formatThaiDate } from '../../core/thai';

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
  /** แสดงรูปบุคคลที่ผู้สืบสวนใส่ไว้ในจุดบัญชี (ค่าเริ่มต้น: แสดง) */
  showPhotos?: boolean;
  /** ป้ายยอดเงินบนทุกเส้น: ไม่แสดง (ดูตอนชี้) / ปกติ / แบบการ์ด */
  edgeLabels?: 'off' | 'plain' | 'card';
  /** ตัวย่อธนาคารในวงกลมของจุดบัญชี */
  bankBadges?: boolean;
  /** เส้นที่ปักให้แสดงรายละเอียดตลอด (คีย์ "ต้นทาง>ปลายทาง") */
  pinnedEdges?: string[];
  /** รูปแบบ "ผังไหลเงิน": เส้นมุมฉาก ป้ายแคปซูลที่ปลายเส้น และป้ายเจ้าของแบบละเอียด (ตั้งตามรูปแบบการจัดผัง) */
  flow?: boolean;
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
  noteBg: string;
  noteText: string;
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
    noteBg: v('--note-bg', '#fff4c2'),
    noteText: v('--note-text', '#3d3000'),
  };
}

export const PRINT_PALETTE: Palette = {
  owner: '#6a4df4', shared: '#e87ba4', plain: '#8795bd', cash: '#9aa0bd', agg: '#c3c9e2',
  inflow: '#1baf7a', outflow: '#eb6834', between: '#5b4ee8',
  slots: ['#6250d6', '#008300', '#e87ba4', '#eda100'], neutral: '#8795bd',
  text: '#161614', textMuted: '#52514e', surface: '#ffffff', accent: '#5b4ee8', warn: '#eda100',
  noteBg: '#fff4c2', noteText: '#3d3000',
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const last4 = (n: string) => n.replace(/[^0-9X]/g, '').slice(-4);

/** เครือข่ายใหญ่มากจะช้า/อ่านยาก — คืนยอดขั้นต่ำที่ทำให้เหลือราว maxEdges เส้น (ยอดสูงสุดก่อน) ใช้กับมุมมอง "ทั้งหมด" */
export function autoMinAmount(res: AnalysisResult, maxEdges = 1500): number {
  const totals = res.pairs.map((p) => p.total).sort((a, b) => b - a);
  if (totals.length <= maxEdges) return 0;
  return Math.ceil(totals[maxEdges]!);
}

/** ตัวกรองที่บันทึกในคดี → ตัวเลือกของ buildElements — หน้าเครือข่ายและรายงานใช้ฟังก์ชันเดียวกัน ผังจึงตรงกันทุกจุด */
export function netOptionsFromView(v: NetworkViewOptions, res: AnalysisResult): NetOptions {
  return {
    scope: v.scope, topPerOwner: v.topPerOwner, colorBy: v.colorBy, showCash: v.showCash, showManual: v.showManual,
    minAmount: v.scope === 'all' ? (v.allMin ?? autoMinAmount(res)) : 0,
    from: v.from ? Date.parse(v.from + 'T00:00:00Z') : undefined,
    to: v.to ? Date.parse(v.to + 'T23:59:59Z') : undefined,
    edgeLabels: v.edgeLabels ?? 'off', bankBadges: !!v.bankBadges, pinnedEdges: v.pinnedEdges ?? [],
  };
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
/** ผังไหลเงิน: ป้ายเจ้าของกว้างขึ้น (มีช่วงวันที่และยอดหมุนเวียน) และไม่ขยายตามการย่อผัง เพื่อให้ระยะแถวที่คำนวณไว้ถูกต้อง */
const FLOW_OWNER_LABEL_WIDTH = 230;
/** ผังไหลเงิน: ขนาดตัวอักษร (ใหญ่กว่ารูปแบบอื่น — ผังแบบนี้อ่านตัวเลขเป็นหลัก) */
const FLOW_PILL_FONT = 12;
const FLOW_CARD_FONT = 11;
const FLOW_NODE_FONT = 12;
const FLOW_OWNER_FONT = 14;
/** ระยะจากปลายเส้น (ขอบจุด) ถึงกึ่งกลางป้ายแคปซูล */
const FLOW_LABEL_OFFSET = 80;

type Role = 'owner' | 'shared' | 'plain' | 'cash' | 'agg' | 'manual';
type Pair = { from: string; to: string; total: number; count: number; firstTs?: number; lastTs?: number };

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

/** สีตัวอักษรบนพื้นสี (ไอคอนธนาคาร) — เลือกขาว/ดำตามความสว่างของพื้น */
export function badgeTextColor(fill: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(fill.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // ความต่างกับขาว vs ดำ — เลือกค่าที่มากกว่า
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '#ffffff' : '#141414';
}

/** ไอคอนธนาคาร: วงกลมสีของจุด + ตัวย่อธนาคาร (ตัวอักษร ไม่ใช่โลโก้จริง) เป็น SVG data URL */
export function bankBadge(tag: string, fill: string): string {
  const esc = tag.replace(/[<>&'"]/g, '');
  const fs = esc.length <= 3 ? 36 : esc.length === 4 ? 29 : esc.length === 5 ? 24 : 19;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='${fill}'/>`
    + `<text x='50' y='50' dy='0.35em' text-anchor='middle' font-family='Arial,Helvetica,sans-serif' font-weight='700' font-size='${fs}' fill='${badgeTextColor(fill)}'>${esc}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** ช่วงวันที่แบบไทย: วันเดียว → วันเดียว, หลายวัน → "วันแรก – วันสุดท้าย" */
function spanText(a?: number, b?: number): string {
  if (a === undefined || b === undefined) return '';
  return a === b || formatThaiDate(a) === formatThaiDate(b) ? formatThaiDate(a) : `${formatThaiDate(a)} – ${formatThaiDate(b)}`;
}

/** ข้อความในป้ายแคปซูลของผังไหลเงิน: ยอดปัดเป็นบาท (จำนวนครั้ง) — ยอดเต็มทศนิยมดูได้ในแบบการ์ด/แผงรายละเอียด */
export function flowPill(total: number, count: number): string {
  return `฿${Math.round(total).toLocaleString('en-US')} (${count.toLocaleString('en-US')}×)`;
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
  // คู่บัญชีทั่วไปแสดงแค่รหัสธนาคาร+เลขท้ายเพื่อไม่ให้ผังรก — เว้นแต่ผู้สืบสวนตั้งชื่อไว้เอง
  const own = (a.label ?? '').trim();
  if (own) return { label: [clip(own, 18), head].filter(Boolean).join('\n'), full };
  return { label: head || clip(name, 14), full };
}

/** โครงสร้างของผัง (จุด + ต้นทาง/ปลายทางของเส้น) — เท่ากันแปลว่าเปลี่ยนแค่ป้ายชื่อ/รูป/สี ไม่ต้องจัดวางใหม่ */
export function graphSignature(elements: ElementDefinition[]): string {
  return elements.map((e) => ('source' in e.data ? `${e.data.id}:${e.data.source}>${e.data.target}` : String(e.data.id))).join('|');
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
      if (e) { e.total += t.amount; e.count++; e.firstTs = Math.min(e.firstTs!, t.ts); e.lastTs = Math.max(e.lastTs!, t.ts); }
      else pairs.set(k, { from: t.from, to: t.to, total: t.amount, count: 1, firstTs: t.ts, lastTs: t.ts });
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
  const agg: { owner: string; dir: 'in' | 'out'; total: number; count: number; accounts: Set<string>; firstTs?: number; lastTs?: number }[] = [];
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
      const ef = (e as Pair).firstTs;
      const el = (e as Pair).lastTs;
      if (ef !== undefined) a.firstTs = a.firstTs === undefined ? ef : Math.min(a.firstTs, ef);
      if (el !== undefined) a.lastTs = a.lastTs === undefined ? el : Math.max(a.lastTs, el);
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
  // เจ้าของที่แต่ละจุดเชื่อมด้วยยอดสูงสุด → ลำดับบนวง (ใช้เรียงคู่บัญชีให้อยู่ส่วนโค้งเดียวกับเจ้าของในวงซ้อน)
  const linkToOwner = new Map<string, Map<string, number>>();
  for (const e of keep) {
    for (const [o, x] of [[e.from, e.to], [e.to, e.from]] as const) {
      if (!owners.has(o) || owners.has(x)) continue;
      const m = linkToOwner.get(x) ?? linkToOwner.set(x, new Map()).get(x)!;
      m.set(o, (m.get(o) ?? 0) + e.total);
    }
  }
  const anchorOf = (id: string): number => {
    const own = ringOrder.indexOf(id);
    if (own >= 0) return own;
    let best = -1;
    let bt = -1;
    for (const [o, t] of linkToOwner.get(id) ?? []) {
      const i = ringOrder.indexOf(o);
      if (i >= 0 && t > bt) { bt = t; best = i; }
    }
    return best >= 0 ? best : ringOrder.length;
  };
  // ผังไหลเงิน: เส้นจากคอลัมน์ซ้าย (มีแต่โอนออก) ไปแนวนอนก่อน (flow-h) นอกนั้นไปตามเลนแนวดิ่งของต้นทางก่อน (flow-v)
  const fCol = opts.flow
    ? flowRoles(
        [...nodeIds, ...agg.map((a) => `agg:${a.owner}:${a.dir}`)],
        [
          ...shownEdges.map((e) => ({ source: e.from, target: e.to, total: e.total })),
          ...agg.map((a) => (a.dir === 'in' ? { source: `agg:${a.owner}:in`, target: a.owner, total: a.total } : { source: a.owner, target: `agg:${a.owner}:out`, total: a.total })),
        ],
        (id) => owners.has(id),
      )
    : null;
  // ผังไหลเงิน: ช่วงวันที่และยอดหมุนเวียน (เข้า+ออก) ของเจ้าของ จากทุกคู่ในช่วงที่เลือก (ไม่ใช่เฉพาะเส้นที่แสดง)
  const turnover = new Map<string, { total: number; first?: number; last?: number }>();
  if (opts.flow) {
    for (const e of pairs.values()) {
      for (const id of [e.from, e.to]) {
        if (!owners.has(id)) continue;
        const t = turnover.get(id) ?? turnover.set(id, { total: 0 }).get(id)!;
        t.total += e.total;
        if (e.firstTs !== undefined) t.first = t.first === undefined ? e.firstTs : Math.min(t.first, e.firstTs);
        if (e.lastTs !== undefined) t.last = t.last === undefined ? e.lastTs : Math.max(t.last, e.lastTs);
      }
    }
  }
  const elements: ElementDefinition[] = [];
  for (const id of nodeIds) {
    const a = d.accounts[id]!;
    const m = res.metrics[id];
    const w = m ? m.weightedIn + m.weightedOut : 0;
    const role = roleOf(id);
    const lg = Math.log10(1 + w);
    const photo = opts.showPhotos !== false && a.kind === 'account' ? st.accountNotes?.[id]?.photo : undefined;
    const base = role === 'owner' ? 46 + Math.min(30, lg * 4.2) : role === 'cash' ? 24 : role === 'shared' ? 24 + Math.min(18, lg * 2.4) : 14 + Math.min(18, lg * 2.6);
    const tag = !photo && opts.bankBadges && a.kind === 'account' ? bankTag(a) : '';
    // จุดที่มีรูปต้องใหญ่พอให้เห็นหน้า; จุดที่มีไอคอนธนาคารต้องใหญ่พอให้อ่านตัวย่อ
    const size = photo ? Math.max(base, 44) : tag ? Math.max(base, 30) : base;
    const color = colorOf(id);
    const nl = nodeLabel(a, role);
    const turn = role === 'owner' ? turnover.get(id) : undefined;
    const label = turn ? [nl.label, spanText(turn.first, turn.last), `หมุนเวียน ${fmtBaht(turn.total)} ฿`].filter(Boolean).join('\n') : nl.label;
    const full = nl.full;
    elements.push({
      data: {
        id, label, full, role, kind: a.kind, size, color,
        fs: opts.flow ? (role === 'owner' ? FLOW_OWNER_FONT : FLOW_NODE_FONT) : role === 'owner' ? OWNER_LABEL_FONT : role === 'shared' ? 11 : 9.5,
        hasStatement: a.hasStatement ? 1 : 0, bridge: m?.isBridge ? 1 : 0, bank: a.bank ?? '', anchor: anchorOf(id),
        ...(role === 'owner' ? { ring: ringOrder.indexOf(id), ringN: ringOrder.length, tw: opts.flow ? FLOW_OWNER_LABEL_WIDTH : OWNER_LABEL_WIDTH } : {}),
        ...(fCol ? { flow: 1, fcol: fCol.get(id) ?? 'sink' } : {}),
        ...(photo ? { photo } : {}),
        ...(tag ? { badge: bankBadge(tag, color) } : {}),
      },
      classes: role,
    });
  }
  // ป้ายบนเส้น: ทุกเส้น (ปกติ/การ์ด) หรือเฉพาะเส้นที่ปักไว้ — ไม่ใช้ก็ดูได้ตอนชี้/แตะ
  const pinned = new Set(opts.pinnedEdges ?? []);
  const lblMode = opts.edgeLabels ?? 'off';
  const edgeLabelData = (src: string, dst: string, total: number, count: number, first?: number, last?: number) => {
    const card = [`${fmtBaht(total)} ฿`, `${count.toLocaleString('en-US')} รายการ`, spanText(first, last)].filter(Boolean).join('\n');
    const pin = pinned.has(`${src}>${dst}`);
    const cls = [lblMode === 'plain' ? 'lbl-plain' : lblMode === 'card' ? 'lbl-card' : '', pin ? (lblMode === 'card' ? 'lbl-card' : 'lbl-pin') : ''];
    const flow = fCol ? ['flow', fCol.get(src) === 'src' ? 'flow-h' : 'flow-v'] : [];
    const pill = flowPill(total, count);
    return {
      data: { label: `${fmtBaht(total)} ฿ ×${count}`, card, key: `${src}>${dst}`, ...(fCol ? { pill, pillText: `${pill} ▸`, toff: FLOW_LABEL_OFFSET, z: 30 } : {}) },
      cls: [...new Set([...flow, ...cls.filter(Boolean)])],
    };
  };
  let n = 0;
  for (const e of shownEdges) {
    const c = edgeColor(e.from, e.to);
    const fl = e as Pair;
    const L = edgeLabelData(e.from, e.to, e.total, e.count, fl.firstTs, fl.lastTs);
    elements.push({
      data: { id: 'e' + n++, source: e.from, target: e.to, total: e.total, count: e.count, width: edgeWidth(e.total), color: c, ...L.data },
      ...(L.cls.length ? { classes: L.cls.join(' ') } : {}),
    });
  }
  for (const a of agg) {
    const id = `agg:${a.owner}:${a.dir}`;
    const src = a.dir === 'in' ? id : a.owner;
    const dst = a.dir === 'in' ? a.owner : id;
    const L = edgeLabelData(src, dst, a.total, a.count, a.firstTs, a.lastTs);
    elements.push({
      data: {
        id, label: `+${a.accounts.size.toLocaleString('en-US')}`, full: `${a.dir === 'in' ? 'รับจาก' : 'โอนให้'}คู่บัญชีอื่นอีก ${a.accounts.size.toLocaleString('en-US')} บัญชี รวม ${fmtBaht(a.total)} บาท (${a.count.toLocaleString('en-US')} รายการ)`,
        role: 'agg', kind: 'agg', size: 20 + Math.min(16, Math.log10(1 + a.accounts.size) * 7), color: pal.agg, fs: opts.flow ? 11 : 10, hasStatement: 0, bridge: 0, bank: '', owner: a.owner,
        anchor: anchorOf(a.owner), ...(fCol ? { flow: 1, fcol: fCol.get(id) ?? (a.dir === 'in' ? 'src' : 'sink') } : {}),
      },
      classes: 'agg',
    });
    elements.push({
      data: {
        id: 'ea' + n++, source: src, target: dst, total: a.total, count: a.count, width: edgeWidth(a.total),
        color: a.dir === 'in' ? pal.inflow : pal.outflow, ...L.data,
      },
      classes: ['agg-edge', ...L.cls].join(' '),
    });
  }

  if (opts.showManual) {
    for (const mn of st.manualNodes) {
      elements.push({ data: { id: 'm:' + mn.id, label: clip(mn.label, 18), full: mn.label, role: 'manual', kind: 'manual', size: 28, color: pal.warn, fs: 10, hasStatement: 0, bridge: 0, bank: '', anchor: ringOrder.length, ...(opts.flow ? { flow: 1, fcol: 'sink' } : {}) }, classes: 'manual' });
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
  const range = useRange ? ` · ช่วงวันที่ ${opts.from !== undefined ? formatThaiDate(opts.from) : 'ต้นข้อมูล'} – ${opts.to !== undefined ? formatThaiDate(opts.to) : 'ท้ายข้อมูล'}` : '';
  return { elements, nodeCount: nodeIds.size + agg.length, edgeCount: shownEdges.length + agg.length, legend, summary: summary + range };
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
    // รูปบุคคลเต็มวง — สีบทบาท/ธนาคารย้ายไปอยู่ที่ขอบ
    {
      selector: 'node[photo]',
      style: {
        'background-image': 'data(photo)', 'background-fit': 'cover', 'background-clip': 'node', 'background-color': pal.surface,
        'border-color': 'data(color)', 'border-width': 4, 'border-style': 'solid',
      },
    },
    { selector: 'node.owner[photo]', style: { 'border-width': 6 } },
    // ไอคอนธนาคาร (ตัวย่อในวงกลมสีของจุด)
    { selector: 'node[badge]', style: { 'background-image': 'data(badge)', 'background-fit': 'cover', 'background-clip': 'node' } },
    // ข้อความที่ผู้สืบสวนวางบนผัง
    {
      selector: 'node.note',
      style: {
        shape: 'round-rectangle', width: 'data(w)', height: 'data(h)', 'background-color': pal.noteBg, 'background-opacity': 0.96,
        'border-width': 1.5, 'border-style': 'dashed', 'border-color': pal.warn, label: 'data(label)', color: pal.noteText,
        'text-valign': 'center', 'text-halign': 'center', 'text-margin-y': 0, 'text-wrap': 'wrap', 'text-max-width': 'data(tw)',
        'font-size': 11, 'text-outline-width': 0, 'underlay-opacity': 0, 'z-index': 60, 'min-zoomed-font-size': 0,
      },
    },
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
    // ป้ายยอดเงินบนทุกเส้น / เส้นที่ปักไว้ / แบบการ์ด (กล่องมีขอบ หลายบรรทัด)
    { selector: 'edge.lbl-plain, edge.lbl-pin', style: { label: 'data(label)', opacity: 0.8, color: pal.text, 'font-size': 9.5 } },
    {
      selector: 'edge.lbl-card',
      style: {
        label: 'data(card)', 'text-wrap': 'wrap', opacity: 0.85, color: pal.text, 'font-size': 9.5, 'text-background-color': pal.surface,
        'text-background-opacity': 1, 'text-background-shape': 'round-rectangle', 'text-background-padding': '4px',
        'text-border-width': 1, 'text-border-color': 'data(color)', 'text-border-opacity': 0.9,
      },
    },
    { selector: '.faded', style: { opacity: 0.1, 'underlay-opacity': 0 } },
    { selector: 'node.hl', style: { 'border-color': pal.accent, 'border-width': 4, 'underlay-opacity': 0.4, 'z-index': 40 } },
    { selector: 'edge.hl', style: { opacity: 0.95, label: 'data(label)', 'z-index': 40 } },
    // ผังไหลเงิน: ป้ายอยู่ข้างจุด ไม่ให้เส้นแนวดิ่งของเลนผ่านตัวหนังสือ (ผู้โอนเข้า: ซ้ายของจุด, ขั้นบันได/ผู้รับ: ขวาของจุด)
    { selector: 'node[fcol = "src"]', style: { 'text-halign': 'left', 'text-valign': 'center', 'text-margin-x': -7, 'text-margin-y': 0, 'text-justification': 'right' } },
    { selector: 'node[fcol = "hub"], node[fcol = "sink"]', style: { 'text-halign': 'right', 'text-valign': 'center', 'text-margin-x': 7, 'text-margin-y': 0, 'text-justification': 'left' } },
    { selector: 'node.agg[fcol]', style: { 'text-halign': 'center', 'text-margin-x': 0 } },
    { selector: 'node.hov[kind != "note"]', style: { label: 'data(full)', 'font-size': 12, 'z-index': 999, 'min-zoomed-font-size': 0, 'text-valign': 'bottom', 'text-margin-y': 6 } },
    { selector: 'node:selected', style: { 'border-color': pal.accent, 'border-width': 5 } },
    // ---- ผังไหลเงิน: เส้นหักมุมฉากรูปตัว L และป้ายแคปซูลบนท่อนแนวนอนใกล้จุด (แต่ละจุดมีแถวของตัวเอง ป้ายจึงไม่ซ้อนกัน) ----
    // z: เส้นที่ท่อนแนวนอนยาวกว่า (มาจากเลนไกลกว่า) วาดก่อน — ป้ายของเส้นจากเลนใกล้ที่วางบนท่อนร่วมจึงไม่ถูกเส้นอื่นทับ
    { selector: 'edge.flow', style: { 'curve-style': 'round-taxi', 'taxi-turn': '100%', 'taxi-radius': 10, 'taxi-turn-min-distance': 4, 'arrow-scale': 0.9, 'z-index': 'data(z)' } },
    { selector: 'edge.flow-v', style: { 'taxi-direction': 'vertical' } },
    { selector: 'edge.flow-h', style: { 'taxi-direction': 'horizontal' } },
    {
      selector: 'edge.flow.hl, edge.flow.lbl-plain, edge.flow.lbl-pin, edge.flow.lbl-card',
      style: {
        label: '', color: pal.text, 'font-size': FLOW_PILL_FONT, 'font-weight': 'bold', opacity: 0.95, 'text-background-color': pal.surface, 'text-background-opacity': 1,
        'text-background-shape': 'round-rectangle', 'text-background-padding': '4px', 'text-border-width': 1.3, 'text-border-color': 'data(color)', 'text-border-opacity': 1,
      },
    },
    { selector: 'edge.flow-v.hl, edge.flow-v.lbl-plain, edge.flow-v.lbl-pin', style: { 'target-label': 'data(pillText)', 'target-text-offset': 'data(toff)' } },
    { selector: 'edge.flow-h.hl, edge.flow-h.lbl-plain, edge.flow-h.lbl-pin', style: { 'source-label': 'data(pillText)', 'source-text-offset': FLOW_LABEL_OFFSET } },
    { selector: 'edge.flow-v.lbl-card', style: { 'target-label': 'data(card)', 'target-text-offset': 'data(toff)', 'font-weight': 'normal', 'font-size': FLOW_CARD_FONT } },
    { selector: 'edge.flow-h.lbl-card', style: { 'source-label': 'data(card)', 'source-text-offset': FLOW_LABEL_OFFSET + 12, 'font-weight': 'normal', 'font-size': FLOW_CARD_FONT } },
    { selector: 'edge.flow-back.hl, edge.flow-back.lbl-plain, edge.flow-back.lbl-pin', style: { 'source-label': 'data(pillText)', 'source-text-offset': 'data(toff)' } },
    { selector: 'edge.flow-back.lbl-card', style: { 'source-label': 'data(card)', 'source-text-offset': 'data(toff)' } },
    // เส้นที่ชี้อยู่ยกขึ้น แต่ยังต่ำกว่าเส้นพาป้าย — ไม่ทับป้ายของเส้นอื่น
    { selector: 'edge.flow.hl', style: { 'z-index': 400 } },
    // เส้นพาป้าย: มองไม่เห็นเส้น/หัวลูกศร (หัวลูกศรใช้ความทึบตาม line-opacity), คลิกทะลุไปถึงเส้นจริง, วาดหลังเส้นเงินทุกเส้น
    {
      selector: 'edge.elabel',
      style: { 'line-opacity': 0, label: '', events: 'no', 'z-index': 500, 'underlay-opacity': 0, 'overlay-opacity': 0, 'text-events': 'no' },
    },
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
  if (cy.nodes('[flow]').nonempty()) return; // ผังไหลเงินจัดแถวตามขนาดป้ายจริง — ห้ามขยายป้าย
  const k = ownerLabelScale(cy.zoom());
  cy.nodes('.owner').forEach((n) => {
    n.data('fs', OWNER_LABEL_FONT * k);
    n.data('tw', OWNER_LABEL_WIDTH * k);
  });
}

const RUNTIME_CLASSES = ['hl', 'faded', 'hov'];
// หมายเหตุ: คลาสเส้นทางของผังไหลเงิน (flow-h/flow-v/flow-back) และเส้นพาป้าย ถูกตั้งใหม่โดย flowRefresh หลังอัปเดตในที่เดิม
const FIXED_KEYS = new Set(['id', 'source', 'target']);

/**
 * แก้ข้อมูล (ป้ายชื่อ รูป สี ขนาด) ของ element ที่อยู่บนผังแล้ว โดยไม่ลบและไม่จัดวางใหม่ — ตำแหน่งจุดคงเดิม
 * ใช้เมื่อ graphSignature ไม่เปลี่ยน; คงคลาสสถานะ (ไฮไลต์/จาง/ชี้) ที่ผู้ใช้กำลังดูอยู่
 */
export function updateElementsInPlace(cy: cytoscapeNS.Core, elements: ElementDefinition[]): void {
  cy.batch(() => {
    for (const def of elements) {
      const ele = cy.getElementById(def.data.id as string);
      if (ele.empty()) continue;
      for (const k of Object.keys(ele.data())) if (!FIXED_KEYS.has(k) && !(k in def.data)) ele.removeData(k);
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(def.data)) if (!FIXED_KEYS.has(k)) next[k] = v;
      ele.data(next);
      const keep = RUNTIME_CLASSES.filter((c) => ele.hasClass(c));
      ele.classes([...String(def.classes ?? '').split(/\s+/).filter(Boolean), ...keep].join(' '));
    }
  });
  scaleOwnerLabels(cy);
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

/**
 * ผังไหลเงิน: จัดให้พอดีจอถ้ายังอ่านตัวเลขได้ (ซูมไม่ต่ำกว่า minZoom) — ผังที่ยาวกว่านั้นแสดงส่วนบนซ้ายที่ซูมอ่านได้
 * แล้วลากเลื่อนดูส่วนที่เหลือ (ปุ่ม "พอดีจอ" ยังย่อให้เห็นทั้งผัง)
 */
export const FLOW_MIN_READABLE_ZOOM = 0.8;
export function fitFlowView(cy: cytoscapeNS.Core, insets: Insets, minZoom = FLOW_MIN_READABLE_ZOOM): void {
  const col = cy.elements();
  if (col.empty()) return;
  const bb = col.boundingBox({ includeLabels: true, includeOverlays: false });
  const f = computeFit({ x1: bb.x1, y1: bb.y1, w: bb.w, h: bb.h }, { w: cy.width(), h: cy.height() }, insets, { minZoom: cy.minZoom(), maxZoom: 1.4 });
  if (f.zoom >= minZoom) { cy.viewport(f); return; }
  cy.viewport({ zoom: minZoom, pan: { x: insets.left - bb.x1 * minZoom, y: insets.top - bb.y1 * minZoom } });
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

// ---------- รูปแบบการจัดผัง ----------

/** วงซ้อน: ระดับสูง = วงใน — เจ้าของ Statement อยู่กลาง บัญชีร่วมวงถัดมา คู่บัญชีวงนอก จุดสรุปเส้นประวงนอกสุด */
export const CONCENTRIC_LEVEL: Record<string, number> = { owner: 5, shared: 4, plain: 3, cash: 2, manual: 2, agg: 1 };

export interface RingNode { id: string; role: string; anchor?: number; size?: number; ring?: number }
type Pos = { x: number; y: number };

const OWNER_ARC = 240; // ระยะบนเส้นรอบวงต่อเจ้าของหนึ่งราย — ให้ป้ายชื่อสองบรรทัดของเจ้าของไม่ชนกัน
const NODE_ARC = 46; // ระยะขั้นต่ำระหว่างจุดในวงนอก
const RING_GAP = 130; // ระยะห่างระหว่างวง
const SUB_GAP = 56; // วงย่อยเมื่อจุดในระดับเดียวกันมากเกินกว่าจะวางวงเดียวได้
const TAU = 2 * Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * ตำแหน่งแบบวงซ้อน (pure): เจ้าของวงใน (รายเดียว = กลางพอดี) แล้วระดับถัด ๆ ไปเป็นวงรอบนอก
 * คู่บัญชีแต่ละกลุ่ม (ตามเจ้าของที่เชื่อมด้วยยอดสูงสุด) ได้ส่วนโค้งตามจำนวน และหมุนให้ตรงกับมุมของเจ้าของ
 * — เงินของเจ้าของแต่ละรายจึง "แผ่ออก" ไปด้านเดียวกัน เส้นไม่พาดข้ามผัง; จุดเยอะเกินวงเดียวจะสลับวงย่อยแทนการซ้อนกัน
 */
export function concentricPositions(nodes: RingNode[]): Record<string, Pos> {
  const out: Record<string, Pos> = {};
  const level = (n: RingNode) => CONCENTRIC_LEVEL[n.role] ?? 2;
  const owners = nodes.filter((n) => level(n) === 5).sort((a, b) => (a.ring ?? a.anchor ?? 0) - (b.ring ?? b.anchor ?? 0));
  const nO = owners.length;
  const ownerAngle = new Map<number, number>();
  const R0 = nO <= 1 ? 0 : Math.max(160, (nO * OWNER_ARC) / TAU);
  owners.forEach((o, i) => {
    const a = -Math.PI / 2 + (TAU * i) / Math.max(1, nO);
    ownerAngle.set(o.anchor ?? i, a);
    out[o.id] = { x: Math.cos(a) * R0, y: Math.sin(a) * R0 };
  });

  let r = R0;
  const levels = [...new Set(nodes.map(level))].filter((l) => l < 5).sort((a, b) => b - a);
  for (const l of levels) {
    const ring = nodes.filter((n) => level(n) === l)
      .sort((a, b) => (a.anchor ?? 1e9) - (b.anchor ?? 1e9) || (b.size ?? 0) - (a.size ?? 0));
    const count = ring.length;
    r = r === 0 ? RING_GAP + 40 : r + RING_GAP;
    // จุดมากเกินวงเดียว → สลับวงย่อย (จุดที่ติดกันอยู่คนละวงย่อย) ระยะเชิงมุมจึงแคบลงได้โดยไม่ซ้อน
    const subRings = Math.max(1, Math.ceil((count * NODE_ARC) / (TAU * r)));
    const place = (n: RingNode, a: number, sub: number) => {
      const rr = r + sub * SUB_GAP;
      out[n.id] = { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
    };
    if (nO >= 2 && subRings === 1) {
      // วงโปร่ง: คู่บัญชีของเจ้าของแต่ละรายรวมเป็นกลุ่ม วางกึ่งกลางกลุ่มที่มุมของเจ้าของ แล้วดันกลุ่มที่ทับกันออกจากกัน
      const minAng = NODE_ARC / r;
      const step = Math.max(minAng, Math.min(TAU / count, minAng * 1.8));
      const groups: { target?: number; items: RingNode[]; c: number; w: number }[] = [];
      for (const n of ring) {
        const t = ownerAngle.get(n.anchor ?? -1);
        const last = groups[groups.length - 1];
        if (last && last.target === t) last.items.push(n);
        else groups.push({ target: t, items: [n], c: 0, w: 0 });
      }
      const total = groups.reduce((a, g) => a + g.items.length * step, 0);
      const k = total > TAU ? TAU / total : 1;
      let prev = -Math.PI / 2;
      for (const g of groups) { // มุมเป้าหมายเรียงจากน้อยไปมากตามลำดับเจ้าของ; กลุ่มที่ไม่มีเจ้าของต่อท้าย
        g.w = g.items.length * step * k;
        g.c = g.target !== undefined ? Math.max(g.target, prev + g.w / 2) : prev + g.w / 2;
        prev = g.c + g.w / 2;
      }
      for (let it = 0; it < 300 && groups.length > 1; it++) {
        let moved = false;
        for (let i = 0; i < groups.length; i++) {
          const a = groups[i]!;
          const b = groups[(i + 1) % groups.length]!;
          const bc = i + 1 === groups.length ? b.c + TAU : b.c;
          const overlap = (a.w + b.w) / 2 - (bc - a.c);
          if (overlap > 1e-9) { a.c -= overlap / 2; b.c += overlap / 2; moved = true; }
        }
        if (!moved) break;
      }
      for (const g of groups) g.items.forEach((n, j) => place(n, g.c - g.w / 2 + (g.w * (j + 0.5)) / g.items.length, 0));
    } else {
      // เจ้าของรายเดียว/ไม่มี หรือวงแน่น: ช่องเท่ากันเต็มวง (จำนวนช่องปัดเป็นพหุคูณของวงย่อย ช่องที่ติดกันจึงอยู่คนละวงย่อยแม้ข้ามรอบวง)
      const slots = Math.ceil(count / subRings) * subRings;
      let rot = -Math.PI / 2;
      if (nO >= 2) {
        // หมุนทั้งวงให้คู่บัญชีโดยรวมตรงกับมุมของเจ้าของ (ค่าเฉลี่ยแบบวงกลม)
        let sx = 0;
        let sy = 0;
        ring.forEach((n, i) => {
          const t = ownerAngle.get(n.anchor ?? -1);
          if (t === undefined) return;
          const d = wrap(t - (TAU * i) / slots);
          sx += Math.cos(d);
          sy += Math.sin(d);
        });
        if (sx !== 0 || sy !== 0) rot = Math.atan2(sy, sx);
      }
      ring.forEach((n, i) => place(n, rot + (TAU * i) / slots, i % subRings));
    }
    r += (subRings - 1) * SUB_GAP;
  }
  return out;
}

/** แฮชสั้นของโครงสร้างผัง (cyrb53) — เก็บในคดีแทนสตริงยาว */
export function hashSignature(elements: ElementDefinition[]): string {
  const str = graphSignature(elements);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ---------- ข้อความบนผัง (โน้ต) ----------

const NOTE_WRAP = 28;
/** ขนาดกล่องโน้ตตามข้อความ (ตัดบรรทัดที่ ~28 ตัวอักษร) */
export function noteSize(text: string): { w: number; h: number } {
  const lines: string[] = [];
  for (const raw of (text || ' ').split('\n')) {
    let line = raw;
    while (line.length > NOTE_WRAP) { lines.push(line.slice(0, NOTE_WRAP)); line = line.slice(NOTE_WRAP); }
    lines.push(line);
  }
  const longest = Math.max(...lines.map((l) => l.length), 4);
  return { w: Math.round(Math.min(240, Math.max(70, longest * 7 + 26))), h: Math.round(lines.length * 15 + 18) };
}

/** โน้ตเป็น element ของ Cytoscape ที่ตำแหน่งของรูปแบบนั้น (ไม่มี → ตำแหน่งของรูปแบบอื่น) — ไม่รวมใน graphSignature/การจัดวาง */
export function noteElements(notes: NetNote[] | undefined, mode: LayoutMode): ElementDefinition[] {
  return (notes ?? []).map((nt) => {
    const { w, h } = noteSize(nt.text);
    const position = nt.pos[mode] ?? nt.pos.auto ?? nt.pos.concentric ?? { x: 0, y: 0 };
    return { group: 'nodes', data: { id: 'note:' + nt.id, label: nt.text, w, h, tw: w - 14, size: w, role: 'note', kind: 'note', color: '#eda100' }, position: { ...position }, classes: 'note' };
  });
}

/** ใส่/แก้/ลบโน้ตบนผังให้ตรงกับที่บันทึก (ไม่แตะจุดอื่น) */
export function syncNotes(cy: cytoscapeNS.Core, notes: NetNote[] | undefined, mode: LayoutMode): void {
  const want = noteElements(notes, mode);
  const ids = new Set(want.map((e) => e.data.id as string));
  cy.batch(() => {
    cy.nodes('.note').forEach((n) => { if (!ids.has(n.id())) n.remove(); });
    for (const def of want) {
      const ele = cy.getElementById(def.data.id as string);
      if (ele.empty()) cy.add(def);
      else { ele.data(def.data); ele.position(def.position!); }
    }
  });
}

// ---------------- ผังไหลเงิน (เส้นมุมฉาก) ----------------

export type FlowCol = 'src' | 'hub' | 'sink';
export interface FlowNode { id: string; role?: string; size?: number; label?: string; fs?: number; tw?: number; ring?: number }
export interface FlowEdge { source: string; target: string; total?: number }

/** ระยะของผังไหลเงิน: คอลัมน์ซ้าย x = 0, เลนแรก, ระยะเลนขั้นต่ำ, ระยะเลนสุดท้ายถึงคอลัมน์ขวา, ช่องว่างระหว่างแถว, แถวเตี้ยสุด */
export const FLOW_GEOM = { firstLane: 270, laneMin: 210, rightGap: 320, rowGap: 24, minRow: 54 };

/**
 * แบ่งจุดเป็น 3 ส่วน: ขั้นบันไดกลาง (hub) = เจ้าของ Statement ทุกราย + บัญชีที่มีทั้งเงินเข้าและออก;
 * คอลัมน์ซ้าย (src) = มีแต่โอนออก; คอลัมน์ขวา (sink) = มีแต่รับ (หรือไม่มีเส้นเงิน เช่น จุดที่เพิ่มเอง)
 */
export function flowRoles(ids: string[], edges: FlowEdge[], forceHub: (id: string) => boolean): Map<string, FlowCol> {
  const ins = new Map<string, number>();
  const outs = new Map<string, number>();
  const nb = new Map<string, Set<string>>();
  for (const e of edges) {
    outs.set(e.source, (outs.get(e.source) ?? 0) + ((e.total ?? 0) || 1));
    ins.set(e.target, (ins.get(e.target) ?? 0) + ((e.total ?? 0) || 1));
    (nb.get(e.source) ?? nb.set(e.source, new Set()).get(e.source)!).add(e.target);
    (nb.get(e.target) ?? nb.set(e.target, new Set()).get(e.target)!).add(e.source);
  }
  const m = new Map<string, FlowCol>();
  for (const id of ids) {
    const i = ins.get(id) ?? 0;
    const o = outs.get(id) ?? 0;
    // บัญชีทางผ่านจริง (รับจากรายหนึ่ง ส่งต่ออีกราย) ได้เลนของตัวเอง; คู่บัญชีที่รับ-โอนกับเจ้าของรายเดียว
    // ไม่ได้เป็นทางผ่าน → อยู่คอลัมน์ข้างตามฝั่งที่ยอดมากกว่า (ไม่เช่นนั้นผังจะเป็นบันไดยาวเหยียดจนตัวหนังสือเล็ก)
    if (forceHub(id) || (i > 0 && o > 0 && (nb.get(id)?.size ?? 0) >= 2)) m.set(id, 'hub');
    else if (o > 0 && (i === 0 || o > i)) m.set(id, 'src');
    else m.set(id, 'sink');
  }
  return m;
}

/** ขนาดป้ายข้างจุดโดยประมาณ (ตัดบรรทัดตามความกว้างป้าย) — ใช้กำหนดระยะแถวไม่ให้ป้ายทับเส้นของแถวข้างเคียง */
function flowLabelBox(n: FlowNode): { w: number; h: number } {
  if (!n.label) return { w: 0, h: 0 };
  const fs = n.fs ?? 10;
  const tw = n.tw ?? 140;
  let lines = 0;
  let w = 0;
  for (const l of n.label.split('\n')) {
    const lw = l.length * fs * 0.58;
    lines += Math.max(1, Math.ceil(lw / tw));
    w = Math.max(w, Math.min(lw, tw));
  }
  return { w, h: lines * fs * 1.3 + 6 };
}

/**
 * ตำแหน่งของผังไหลเงิน: ผู้โอนเข้าคอลัมน์ซ้าย → บัญชีเจ้าของ/ทางผ่านเป็นขั้นบันได (คนละเลนแนวดิ่ง) → ผู้รับคอลัมน์ขวา
 * ทุกจุดอยู่คนละแถว — เส้นรูปตัว L จึงไม่ผ่านจุดอื่น และป้ายบนท่อนแนวนอนของแต่ละแถวไม่ซ้อนกัน
 * ลำดับขั้นบันไดตามทิศเงินระหว่างกัน (greedy ของ Eades ตัดวงวน; เสมอกันใช้ลำดับเจ้าของเดิม แล้วตามยอด);
 * แต่ละบัญชี: ผู้โอนเข้าที่ยังไม่ได้วางอยู่เหนือ ผู้รับที่ยังไม่ได้วางอยู่ใต้ (ยอดสูงก่อน)
 */
export function flowPositions(nodes: FlowNode[], edges: FlowEdge[]): Record<string, Pos> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = nodes.map((n) => n.id);
  const es = edges.filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target);
  const col = flowRoles(ids, es, (id) => byId.get(id)?.role === 'owner');
  const outE = new Map<string, FlowEdge[]>();
  const inE = new Map<string, FlowEdge[]>();
  const vol = new Map<string, number>();
  for (const e of es) {
    (outE.get(e.source) ?? outE.set(e.source, []).get(e.source)!).push(e);
    (inE.get(e.target) ?? inE.set(e.target, []).get(e.target)!).push(e);
    for (const id of [e.source, e.target]) vol.set(id, (vol.get(id) ?? 0) + (e.total ?? 0));
  }
  const cmp = (a: string, b: string) =>
    (byId.get(a)!.ring ?? 1e9) - (byId.get(b)!.ring ?? 1e9) || (vol.get(b) ?? 0) - (vol.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0);

  // ---- ลำดับขั้นบันได ----
  const hubs = ids.filter((id) => col.get(id) === 'hub');
  const rem = new Set(hubs);
  const hw = (list: FlowEdge[] | undefined, side: 'source' | 'target') =>
    (list ?? []).reduce((a, e) => a + (rem.has(e[side]) && e.source !== e.target ? (e.total ?? 0) || 1 : 0), 0);
  const wOut = (u: string) => hw(outE.get(u), 'target');
  const wIn = (u: string) => hw(inE.get(u), 'source');
  const s1: string[] = [];
  const s2: string[] = [];
  while (rem.size) {
    let moved = true;
    while (moved) {
      moved = false;
      const sinks = [...rem].filter((u) => wOut(u) === 0 && wIn(u) > 0).sort(cmp);
      for (const u of sinks.reverse()) { s2.unshift(u); rem.delete(u); moved = true; }
      const srcs = [...rem].filter((u) => wIn(u) === 0).sort(cmp);
      for (const u of srcs) { s1.push(u); rem.delete(u); moved = true; }
    }
    if (!rem.size) break;
    const u = [...rem].sort((a, b) => wOut(b) - wIn(b) - (wOut(a) - wIn(a)) || cmp(a, b))[0]!;
    s1.push(u);
    rem.delete(u);
  }
  const hubOrder = [...s1, ...s2];

  // ---- แถว ----
  const rows: string[] = [];
  const placed = new Set<string>();
  const put = (id: string) => { if (!placed.has(id)) { placed.add(id); rows.push(id); } };
  const byTotal = (a: FlowEdge, b: FlowEdge) => (b.total ?? 0) - (a.total ?? 0);
  for (const h of hubOrder) {
    (inE.get(h) ?? []).filter((e) => col.get(e.source) === 'src').sort(byTotal).forEach((e) => put(e.source));
    put(h);
    (outE.get(h) ?? []).filter((e) => col.get(e.target) === 'sink').sort(byTotal).forEach((e) => put(e.target));
  }
  ids.filter((id) => !placed.has(id)).sort((a, b) => (col.get(a) === 'src' ? 0 : 1) - (col.get(b) === 'src' ? 0 : 1) || cmp(a, b)).forEach(put);

  // ---- คอลัมน์/เลน ----
  const laneX = new Map<string, number>();
  let x = FLOW_GEOM.firstLane;
  hubOrder.forEach((h, i) => {
    if (i > 0) {
      const p = byId.get(hubOrder[i - 1]!)!;
      const n = byId.get(h)!;
      x += Math.max(FLOW_GEOM.laneMin, ((p.size ?? 20) + (n.size ?? 20)) / 2 + 70);
    }
    laneX.set(h, x);
  });
  // คอลัมน์ขวาต้องพ้นป้ายของบัญชีในเลนสุดท้าย (ป้ายอยู่ทางขวาของจุด)
  const last = hubOrder.length ? byId.get(hubOrder[hubOrder.length - 1]!)! : undefined;
  const rightX = (hubOrder.length ? x : FLOW_GEOM.firstLane) + Math.max(FLOW_GEOM.rightGap, last ? (last.size ?? 20) / 2 + flowLabelBox(last).w + 90 : 0);

  const out: Record<string, Pos> = {};
  let y = 0;
  let prev: FlowNode | undefined;
  for (const id of rows) {
    const n = byId.get(id)!;
    // ป้ายอยู่ข้างจุด (กึ่งกลางแนวดิ่ง) → ความสูงแถว = ค่ามากกว่าระหว่างจุดกับป้าย
    if (prev) y += Math.max(FLOW_GEOM.minRow, Math.max(prev.size ?? 20, flowLabelBox(prev).h) / 2 + FLOW_GEOM.rowGap + Math.max(n.size ?? 20, flowLabelBox(n).h) / 2);
    const c = col.get(id);
    out[id] = { x: c === 'hub' ? laneX.get(id)! : c === 'src' ? 0 : rightX, y: Math.round(y * 10) / 10 };
    prev = n;
  }
  return out;
}

/** ลูกศรในป้ายแคปซูล: ทิศของท่อนแนวนอนที่ป้ายอยู่ (ต้นทาง/ปลายทางเกือบตรงกันในแนวดิ่ง → ลูกศรขึ้น/ลง) */
export function flowGlyph(s: Pos, t: Pos, minDx = 24): string {
  if (Math.abs(t.x - s.x) >= minDx) return t.x > s.x ? '▸' : '◂';
  return t.y > s.y ? '▾' : '▴';
}

/**
 * เส้นทางของเส้นรูปตัว L: จากคอลัมน์ซ้ายไปแนวนอนก่อน (flow-h); เข้าคอลัมน์ซ้าย (ป้ายอยู่ทางซ้ายของจุด) ไปตามเลนแนวดิ่งแล้วเข้าทางขวา (flow-v);
 * เงินย้อนไปบัญชีที่อยู่ทางซ้าย ไปแนวนอนก่อนแล้วเข้าทางล่าง/บน (flow-h) แทนการเข้าทางขวาซึ่งเป็นที่ของป้ายจุด; นอกนั้น flow-v
 */
export function flowRoute(sourceCol: string | undefined, targetCol: string | undefined, s: Pos, t: Pos): 'flow-h' | 'flow-v' {
  if (sourceCol === 'src') return 'flow-h';
  if (targetCol === 'src') return 'flow-v';
  return t.x < s.x - 1 ? 'flow-h' : 'flow-v';
}

/**
 * หลังจัดวาง/ลากจุด/อัปเดตข้อมูลในที่เดิม: เลือกเส้นทางของเส้น (flow-h/flow-v/flow-back) ลูกศรและระยะป้ายตามตำแหน่งปัจจุบัน
 * แล้วซิงก์ "เส้นพาป้าย" — Cytoscape วาดป้ายพร้อมเส้นของมันทีละเส้น เส้นที่วาดทีหลังจึงทับป้ายของเส้นก่อนหน้าได้เสมอ;
 * เส้นที่มีป้ายจึงมีเส้นคู่ที่มองไม่เห็น (ต้นทาง/ปลายทาง/คลาสเดียวกัน → ป้ายตำแหน่งเดียวกันแม้ระหว่างลาก) วาดหลังเส้นทั้งหมด
 */
export function flowRefresh(cy: cytoscapeNS.Core): void {
  const es = cy.edges('.flow').not('.elabel');
  const carriers = cy.edges('.elabel');
  if (es.empty() && carriers.empty()) return;
  cy.batch(() => {
    es.forEach((e) => {
      const s = e.source().position();
      const t = e.target().position();
      const fromSrc = e.source().data('fcol') === 'src';
      const route = flowRoute(e.source().data('fcol') as string | undefined, e.target().data('fcol') as string | undefined, s, t);
      // เงินย้อนไปบัญชีทางซ้าย: ไปแนวนอนตามแถวต้นทางก่อน แล้วขึ้น/ลงตามเลนของปลายทาง (ไม่เข้าทางขวาซึ่งเป็นที่ของป้ายจุด)
      const back = route === 'flow-h' && !fromSrc;
      if (!e.hasClass(route)) e.removeClass('flow-h flow-v').addClass(route);
      if (back !== e.hasClass('flow-back')) e.toggleClass('flow-back', back);
      const card = e.hasClass('lbl-card');
      const pill = e.data('pill') as string | undefined;
      if (pill) e.data('pillText', `${pill} ${back ? (t.y < s.y ? '▴' : '▾') : flowGlyph(s, t)}`);
      e.data('toff', back
        ? flowBackOffset(s, t, (e.source().data('size') as number) || 20, card)
        : flowLabelOffset(route, e.target().data('fcol') as string | undefined, s, t, (e.target().data('size') as number) || 20, card));
      e.data('z', route === 'flow-v' ? 60 - Math.min(50, Math.round(Math.abs(t.x - s.x) / 40)) : 30);
    });
    const want = new Set<string>();
    es.forEach((e) => {
      if (!e.hasClass('lbl-plain') && !e.hasClass('lbl-pin') && !e.hasClass('lbl-card')) return;
      const id = 'lbl:' + e.id();
      want.add(id);
      const data = { pillText: e.data('pillText'), card: e.data('card'), toff: e.data('toff'), color: e.data('color'), width: e.data('width'), z: e.data('z') };
      const classes = [...(e.classes() as unknown as string[]), 'elabel'].join(' ');
      const c = cy.getElementById(id);
      if (c.empty()) cy.add({ group: 'edges', data: { id, source: e.source().id(), target: e.target().id(), ...data }, classes });
      else { c.data(data); c.classes(classes); }
    });
    cy.edges('.elabel').forEach((c) => { if (!want.has(c.id())) c.remove(); });
  });
}

/**
 * ระยะป้ายของเส้นย้อน (source-text-offset): ผ่านมุมเลี้ยวไปบนเลนของปลายทางเล็กน้อย — แต่ละเส้นมีมุมเลี้ยวในแถวของตัวเอง
 * ป้ายจึงไม่ซ้อนกันใต้ปลายทาง และไม่ชนป้ายของเส้นอีกทิศที่อยู่ถัดจากมุมเลี้ยวทางซ้ายของแถวเดียวกัน
 */
export function flowBackOffset(s: Pos, t: Pos, sourceSize: number, card = false): number {
  const horiz = Math.max(0, Math.abs(t.x - s.x) - sourceSize / 2); // จากขอบต้นทางถึงมุมเลี้ยว
  return Math.round(horiz + (card ? 40 : 28));
}

/**
 * ระยะป้ายจากปลายเส้น (target-text-offset) ของเส้นแบบ flow-v: เส้นที่เข้าบัญชีในขั้นบันไดหลายเส้นใช้ท่อนแนวนอนสุดท้ายร่วมกัน
 * จึงวางป้ายไว้ถัดจากจุดเลี้ยวของแต่ละเส้น (ท่อนที่มีเส้นนั้นเส้นเดียว) ไม่ให้ป้ายซ้อนกันหน้าปลายทาง;
 * เส้นเข้าคอลัมน์ขวา (แต่ละแถวมีเส้นเดียว) วางป้ายใกล้ผู้รับ
 */
export function flowLabelOffset(route: 'flow-h' | 'flow-v', targetCol: string | undefined, s: Pos, t: Pos, targetSize: number, card = false): number {
  // เข้าคอลัมน์ซ้าย: ใกล้ปลายทางเป็นที่ของป้ายเส้นที่ออกจากจุดนั้น จึงวางถัดจากจุดเลี้ยวเหมือนเส้นเข้าขั้นบันได
  if (route === 'flow-h' || (targetCol !== 'hub' && targetCol !== 'src')) return card ? FLOW_LABEL_OFFSET + 12 : FLOW_LABEL_OFFSET;
  const horiz = Math.abs(t.x - s.x) - targetSize / 2; // จากขอบปลายทางถึงจุดเลี้ยว
  return Math.round(Math.max(60, horiz - (card ? 92 : 85)));
}

export type LayoutPlan =
  | { kind: 'preset'; positions: Record<string, Pos> }
  | { kind: 'fcose'; fixed: { nodeId: string; position: Pos }[]; reused: boolean }
  | { kind: 'concentric' }
  | { kind: 'flow' };

/**
 * เลือกวิธีวางจุด: ผังเหมือนตอนบันทึก → ใช้ตำแหน่งเดิมทั้งหมด (ตรงกับที่ผู้สืบสวนจัดไว้);
 * ผังเปลี่ยน (เช่น นำเข้าไฟล์เพิ่ม/เปลี่ยนตัวกรอง) ในโหมดอัตโนมัติ → ล็อกจุดที่เคยวางไว้ แล้วจัดเฉพาะจุดใหม่;
 * นอกนั้นจัดใหม่ตามรูปแบบ (อัตโนมัติ: เจ้าของบนวงรีตายตัว)
 */
export function planLayout(mode: LayoutMode, elements: ElementDefinition[], saved?: SavedPositions): LayoutPlan {
  const ids = elements.filter((e) => !('source' in e.data)).map((e) => e.data.id as string);
  if (saved && saved.sig === hashSignature(elements) && ids.every((id) => saved.nodes[id])) return { kind: 'preset', positions: saved.nodes };
  if (mode === 'concentric') return { kind: 'concentric' };
  if (mode === 'flow') return { kind: 'flow' };
  const kept = saved ? ids.filter((id) => saved.nodes[id]).map((id) => ({ nodeId: id, position: saved.nodes[id]! })) : [];
  if (kept.length >= 2) return { kind: 'fcose', fixed: kept, reused: true };
  return { kind: 'fcose', fixed: ownerRing(elements), reused: false };
}

/** วางจุดตามแผน (คืนเมื่อจัดเสร็จ) */
export function runLayoutPlan(cy: cytoscapeNS.Core, plan: LayoutPlan, nodeCount: number, animate = false): Promise<void> {
  const graph = cy.elements().not('.note'); // โน้ตอยู่ที่ที่ผู้สืบสวนวางไว้ ไม่ถูกจัดวาง
  if (plan.kind === 'preset') {
    cy.batch(() => graph.nodes().forEach((n) => { const p = plan.positions[n.id()]; if (p) n.position({ x: p.x, y: p.y }); }));
    flowRefresh(cy);
    return Promise.resolve();
  }
  let layout;
  if (plan.kind === 'flow') {
    const pos = flowPositions(
      graph.nodes().map((n) => ({
        id: n.id(), role: n.data('role') as string, size: n.data('size') as number | undefined, label: n.data('label') as string | undefined,
        fs: n.data('fs') as number | undefined, tw: n.data('tw') as number | undefined, ring: n.data('ring') as number | undefined,
      })),
      graph.edges().not('.manual-link, .elabel').map((e: cytoscapeNS.EdgeSingular) => ({ source: e.source().id(), target: e.target().id(), total: (e.data('total') as number) || 0 })),
    );
    layout = graph.nodes().layout({ name: 'preset', positions: (n: cytoscapeNS.NodeSingular) => pos[n.id()] ?? n.position(), animate, animationDuration: 450, fit: false } as never);
  } else if (plan.kind === 'concentric') {
    const pos = concentricPositions(graph.nodes().map((n) => ({
      id: n.id(), role: n.data('role') as string, anchor: n.data('anchor') as number | undefined, size: n.data('size') as number | undefined, ring: n.data('ring') as number | undefined,
    })));
    layout = graph.nodes().layout({ name: 'preset', positions: (n: cytoscapeNS.NodeSingular) => pos[n.id()] ?? n.position(), animate, animationDuration: 450, fit: false } as never);
  } else {
    layout = graph.layout(layoutOptions(nodeCount, animate, plan.fixed) as never);
  }
  return new Promise((resolve) => { layout.one('layoutstop', () => { flowRefresh(cy); resolve(); }); layout.run(); });
}

/** ตำแหน่งปัจจุบันของทุกจุด (ปัดทศนิยม 1 ตำแหน่ง) สำหรับบันทึกในคดี — ผังใหญ่เกินไม่บันทึก */
export const MAX_SAVED_NODES = 2000;
export function snapshotPositions(cy: cytoscapeNS.Core, sig: string, manual: boolean): SavedPositions | null {
  const graph = cy.nodes().not('.note');
  if (graph.length > MAX_SAVED_NODES) return null;
  const nodes: Record<string, Pos> = {};
  graph.forEach((n) => { const p = n.position(); nodes[n.id()] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }; });
  return { sig, nodes, ...(manual ? { manual: true } : {}) };
}

/** สร้างภาพเครือข่าย PNG (พื้นสว่าง เหมาะกับการพิมพ์) สำหรับรายงาน */
export async function renderNetworkImage(
  d: Derived, res: AnalysisResult, st: CaseState, opts: Partial<NetOptions> = {}, size = { w: 1500, h: 950 },
  layout: { mode: LayoutMode; saved?: SavedPositions; notes?: NetNote[] } = { mode: 'auto' },
): Promise<{
  dataUrl: string; nodeCount: number; edgeCount: number; legend: BuiltGraph['legend']; summary: string;
  layout: LayoutMode; usedSavedPositions: boolean; manualPositions: boolean;
} | null> {
  const built = buildElements(d, res, st, {
    scope: 'core', topPerOwner: 12, minAmount: 0, showCash: true, colorBy: 'role', showManual: true, ...opts, flow: layout.mode === 'flow',
  }, PRINT_PALETTE);
  if (built.nodeCount === 0) return null;
  const cytoscape = await loadCytoscape();
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${size.w}px;height:${size.h}px;`;
  document.body.appendChild(host);
  try {
    const cy = cytoscape({ container: host, elements: built.elements, style: makeStyle(PRINT_PALETTE), layout: { name: 'null' } as never, headless: false });
    // ใช้ตำแหน่ง/รูปแบบเดียวกับที่ผู้สืบสวนจัดไว้บนหน้าเครือข่าย
    const plan = planLayout(layout.mode, built.elements, layout.saved);
    await runLayoutPlan(cy, plan, built.nodeCount);
    if (layout.notes?.length) cy.add(noteElements(layout.notes, layout.mode));
    // ผังไหลเงินมักสูงกว่ากว้าง — ขยายความสูงภาพตามสัดส่วนผัง (ไม่เกินราวหนึ่งหน้า A4) ไม่ให้ผังถูกย่อจนอ่านไม่ออก
    if (layout.mode === 'flow') {
      const bb = cy.elements().boundingBox({ includeLabels: true, includeOverlays: false });
      const h = Math.round(Math.min(size.w * 1.3, Math.max(size.h, (size.w * bb.h) / Math.max(1, bb.w))));
      host.style.height = h + 'px';
      cy.resize();
    }
    fitInView(cy, { top: 30, right: 30, bottom: 30, left: 30 });
    // รูปบุคคลโหลดแบบ async ใน Cytoscape — รอให้โหลดเสร็จก่อนถ่ายภาพ ไม่เช่นนั้นภาพในรายงานจะไม่มีรูป
    const photos = built.elements.flatMap((e) => [e.data.photo, e.data.badge] as (string | undefined)[]).filter((p): p is string => !!p);
    if (photos.length) {
      await Promise.all(photos.map((src) => { const im = new Image(); im.src = src; return im.decode().catch(() => undefined); }));
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 120)));
      cy.forceRender();
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    const dataUrl = cy.png({ output: 'base64uri', scale: 1.5, bg: '#ffffff', full: false }) as string;
    cy.destroy();
    return {
      dataUrl, nodeCount: built.nodeCount, edgeCount: built.edgeCount, legend: built.legend, summary: built.summary,
      layout: layout.mode, usedSavedPositions: plan.kind === 'preset', manualPositions: plan.kind === 'preset' && !!layout.saved?.manual,
    };
  } finally {
    host.remove();
  }
}
