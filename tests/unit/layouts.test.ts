// รูปแบบการจัดผังแบบเครื่องมือวิเคราะห์ความเชื่อมโยง: Peacock, Packed, Hierarchy, Organization (คดีตัวอย่าง + กราฟสังเคราะห์)
import { describe, it, expect } from 'vitest';
import { buildDemoCase } from '../../src/demo';
import { deriveCase } from '../../src/store/model';
import { analyze } from '../../src/analysis';
import { buildElements, PRINT_PALETTE, type NetOptions } from '../../src/ui/network/graph';
import { flowOrder, hierarchyPositions, nodeBox, orgPositions, packedPositions, peacockPositions, type LEdge, type LNode, type Pos } from '../../src/ui/network/layouts';

const state = buildDemoCase();
const derived = deriveCase(state);
const { result } = analyze({ txns: derived.txns, accounts: derived.accounts, settings: state.settings, files: derived.files });
const base: NetOptions = { scope: 'all', topPerOwner: 12, minAmount: 0, showCash: true, colorBy: 'role', showManual: false };
const g = buildElements(derived, result, state, base, PRINT_PALETTE);
const demoNodes: LNode[] = g.elements.filter((e) => !('source' in e.data)).map((e) => ({
  id: e.data.id as string, role: e.data.role as string, size: e.data.size as number, label: e.data.label as string,
  fs: e.data.fs as number, tw: e.data.tw as number | undefined, ring: e.data.ring as number | undefined,
}));
const demoEdges: LEdge[] = g.elements.filter((e) => 'source' in e.data).map((e) => ({ source: e.data.source as string, target: e.data.target as string, total: e.data.total as number }));

/** เจ้าของรายเดียว + คู่บัญชีเฉพาะราย 14 ราย + บัญชีที่เชื่อมสองเจ้าของ + เจ้าของรายที่สอง (ข้อมูลสังเคราะห์) */
const synth = (() => {
  const ns: LNode[] = [
    { id: 'O1', role: 'owner', size: 60, label: 'เจ้าของหนึ่ง\nKTB ••0001', fs: 13, tw: 140, ring: 0 },
    { id: 'O2', role: 'owner', size: 60, label: 'เจ้าของสอง\nSCB ••0002', fs: 13, tw: 140, ring: 1 },
    { id: 'S', role: 'shared', size: 30, label: 'บัญชีร่วม', fs: 11 },
  ];
  const es: LEdge[] = [{ source: 'O1', target: 'S', total: 5000 }, { source: 'S', target: 'O2', total: 4800 }, { source: 'O1', target: 'O2', total: 900 }];
  for (let i = 0; i < 14; i++) {
    ns.push({ id: 'A' + i, role: 'plain', size: 20, label: 'BANK ••' + (1000 + i), fs: 9.5 });
    es.push(i % 2 ? { source: 'O1', target: 'A' + i, total: 100 + i } : { source: 'A' + i, target: 'O1', total: 100 + i });
  }
  for (let i = 0; i < 4; i++) {
    ns.push({ id: 'B' + i, role: 'plain', size: 20, label: 'BANK ••' + (2000 + i), fs: 9.5 });
    es.push({ source: 'O2', target: 'B' + i, total: 50 + i });
  }
  ns.push({ id: 'ISO', role: 'plain', size: 20, label: 'ไม่มีเส้น', fs: 9.5 });
  return { ns, es };
})();

/** กรอบจุด+ป้ายของสองจุดไม่ทับกัน */
function noOverlap(ns: LNode[], pos: Record<string, Pos>, pad = 0): string[] {
  const bad: string[] = [];
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i]!;
      const b = ns[j]!;
      const ba = nodeBox(a);
      const bb = nodeBox(b);
      const pa = pos[a.id]!;
      const pb = pos[b.id]!;
      const ox = (ba.w + bb.w) / 2 + pad - Math.abs(pa.x - pb.x);
      const oy = (ba.h + bb.h) / 2 + pad - Math.abs(pa.y - pb.y);
      if (ox > 1 && oy > 1) bad.push(`${a.id}/${b.id}`);
    }
  }
  return bad;
}

const all = (ns: LNode[], pos: Record<string, Pos>) => ns.every((n) => Number.isFinite(pos[n.id]?.x) && Number.isFinite(pos[n.id]?.y));

describe('Peacock', () => {
  const p = peacockPositions(synth.ns, synth.es);
  it('ทุกจุดมีตำแหน่ง ได้ผลเดิมทุกครั้ง', () => {
    expect(all(synth.ns, p)).toBe(true);
    expect(peacockPositions(synth.ns, synth.es)).toEqual(p);
    expect(all(demoNodes, peacockPositions(demoNodes, demoEdges))).toBe(true);
  });
  it('คู่บัญชีเฉพาะรายอยู่เป็นแฉกรอบศูนย์กลางของตัวเอง (ใกล้ศูนย์กลางตัวเองกว่าอีกศูนย์กลาง)', () => {
    const d = (a: string, b: string) => Math.hypot(p[a]!.x - p[b]!.x, p[a]!.y - p[b]!.y);
    for (let i = 0; i < 14; i++) expect(d('A' + i, 'O1')).toBeLessThan(d('A' + i, 'O2'));
    for (let i = 0; i < 4; i++) expect(d('B' + i, 'O2')).toBeLessThan(d('B' + i, 'O1'));
    const rs = Array.from({ length: 14 }, (_, i) => d('A' + i, 'O1'));
    expect(Math.min(...rs)).toBeGreaterThan(80);
  });
  it('บัญชีที่เชื่อมสองศูนย์กลางอยู่ระหว่างทั้งสอง; จุดไม่มีเส้นอยู่ใต้ผัง', () => {
    const mid = { x: (p.O1!.x + p.O2!.x) / 2, y: (p.O1!.y + p.O2!.y) / 2 };
    const half = Math.hypot(p.O1!.x - p.O2!.x, p.O1!.y - p.O2!.y) / 2;
    expect(Math.hypot(p.S!.x - mid.x, p.S!.y - mid.y)).toBeLessThan(half);
    expect(p.ISO!.y).toBeGreaterThan(Math.max(...synth.ns.filter((n) => n.id !== 'ISO').map((n) => p[n.id]!.y)));
  });
});

describe('Packed', () => {
  it('ทุกจุดมีตำแหน่ง กรอบจุด+ป้ายไม่ทับกัน และกะทัดรัด', () => {
    for (const [ns, es] of [[synth.ns, synth.es], [demoNodes, demoEdges]] as const) {
      const p = packedPositions(ns, es);
      expect(all(ns, p)).toBe(true);
      expect(noOverlap(ns, p)).toEqual([]);
      // พื้นที่ทั้งผังไม่เกิน ~6 เท่าของพื้นที่กรอบจุด+ป้ายรวม
      const xs = ns.map((n) => p[n.id]!.x);
      const ys = ns.map((n) => p[n.id]!.y);
      const area = (Math.max(...xs) - Math.min(...xs) + 200) * (Math.max(...ys) - Math.min(...ys) + 200);
      const boxes = ns.reduce((s, n) => { const b = nodeBox(n); return s + (b.w + 20) * (b.h + 20); }, 0);
      expect(area).toBeLessThan(boxes * 6);
    }
  });
  it('กลุ่มที่ไม่เชื่อมกัน (จุดเดี่ยว) อยู่นอกก้อนหลัก', () => {
    const p = packedPositions(synth.ns, synth.es);
    const main = synth.ns.filter((n) => n.id !== 'ISO');
    const cx = main.reduce((s, n) => s + p[n.id]!.x, 0) / main.length;
    const cy = main.reduce((s, n) => s + p[n.id]!.y, 0) / main.length;
    const far = Math.max(...main.map((n) => Math.hypot(p[n.id]!.x - cx, p[n.id]!.y - cy)));
    expect(Math.hypot(p.ISO!.x - cx, p.ISO!.y - cy)).toBeGreaterThan(far * 0.5);
  });
});

describe('Hierarchy', () => {
  it('flowOrder: ต้นทางมาก่อนปลายทาง (ตัดวงวน)', () => {
    const out = new Map([['a', new Map([['b', 1]])], ['b', new Map([['c', 1]])], ['c', new Map([['a', 1], ['d', 1]])], ['d', new Map()]]);
    const o = flowOrder(['a', 'b', 'c', 'd'], out, (x, y) => (x < y ? -1 : 1));
    expect(o.indexOf('a')).toBeLessThan(o.indexOf('b'));
    expect(o.indexOf('b')).toBeLessThan(o.indexOf('c'));
    expect(o.indexOf('c')).toBeLessThan(o.indexOf('d'));
  });
  it('เงินส่วนใหญ่ไหลจากชั้นบนลงชั้นล่าง จุดในชั้นเดียวกันไม่ทับกัน', () => {
    for (const [ns, es] of [[synth.ns, synth.es], [demoNodes, demoEdges]] as const) {
      const p = hierarchyPositions(ns, es);
      expect(all(ns, p)).toBe(true);
      const down = es.filter((e) => p[e.target]!.y > p[e.source]!.y).length;
      const up = es.filter((e) => p[e.target]!.y < p[e.source]!.y).length;
      expect(down).toBeGreaterThan(up * 3);
      expect(noOverlap(ns, p)).toEqual([]);
    }
  });
  it('ต้นทางล้วน (ผู้โอนเข้า) อยู่เหนือเจ้าของที่รับเงิน', () => {
    const p = hierarchyPositions(synth.ns, synth.es);
    for (let i = 0; i < 14; i += 2) expect(p['A' + i]!.y).toBeLessThan(p.O1!.y);
    for (let i = 1; i < 14; i += 2) expect(p['A' + i]!.y).toBeGreaterThan(p.O1!.y);
  });
});

describe('Organization', () => {
  it('รากคือเจ้าของยอดสูงสุด ลูกอยู่ชั้นใต้แม่ แม่อยู่กึ่งกลางเหนือลูก จุดในชั้นไม่ทับกัน', () => {
    for (const [ns, es] of [[synth.ns, synth.es], [demoNodes, demoEdges]] as const) {
      const { pos, parent } = orgPositions(ns, es);
      expect(all(ns, pos)).toBe(true);
      expect(noOverlap(ns, pos)).toEqual([]);
      const kids = new Map<string, string[]>();
      for (const [c, par] of Object.entries(parent)) {
        expect(pos[c]!.y).toBeGreaterThan(pos[par]!.y);
        (kids.get(par) ?? kids.set(par, []).get(par)!).push(c);
      }
      for (const [par, cs] of kids) {
        const xs = cs.map((c) => pos[c]!.x);
        expect(pos[par]!.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 0);
      }
    }
    const { pos, parent } = orgPositions(synth.ns, synth.es);
    expect(parent.O1).toBeUndefined();
    expect(pos.O1!.y).toBe(0);
    for (let i = 0; i < 14; i++) expect(parent['A' + i]).toBe('O1');
  });
});
