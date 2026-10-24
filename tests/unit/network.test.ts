// ตัวสร้างผังเครือข่าย: มุมมอง "แกนหลัก" ต้องไม่ทำให้เงินหาย สีต้องคงที่เมื่อกรอง และไม่ใช้สีเกิน 4 ชนิดแทนค่า
import cytoscape from 'cytoscape';
import { describe, it, expect } from 'vitest';
import { buildDemoCase } from '../../src/demo';
import { deriveCase } from '../../src/store/model';
import { analyze } from '../../src/analysis';
import { buildElements, computeFit, fitInView, ownerLabelScale, ownerRing, ownerRingRadius, PRINT_PALETTE, type NetOptions } from '../../src/ui/network/graph';

const state = buildDemoCase();
const derived = deriveCase(state);
const { result } = analyze({ txns: derived.txns, accounts: derived.accounts, settings: state.settings, files: derived.files });
const base: NetOptions = { scope: 'core', topPerOwner: 12, minAmount: 0, showCash: false, colorBy: 'role', showManual: false };
const build = (o: Partial<NetOptions> = {}) => buildElements(derived, result, state, { ...base, ...o }, PRINT_PALETTE);
const nodes = (g: ReturnType<typeof build>) => g.elements.filter((e) => !('source' in e.data));
const edges = (g: ReturnType<typeof build>) => g.elements.filter((e) => 'source' in e.data);
const owners = Object.values(derived.accounts).filter((a) => a.hasStatement && a.kind === 'account').map((a) => a.id);

describe('ผังเครือข่าย: มุมมองแกนหลัก', () => {
  it('แสดงเจ้าของ Statement ทุกราย พร้อมลำดับบนวงกลมที่ไม่ซ้ำกัน', () => {
    const g = build();
    const ownerNodes = nodes(g).filter((n) => n.data.role === 'owner');
    expect(ownerNodes.map((n) => n.data.id).sort()).toEqual([...owners].sort());
    expect(ownerNodes.map((n) => n.data.ring).sort()).toEqual(ownerNodes.map((_, i) => i));
    expect(ownerNodes.every((n) => n.data.ringN === ownerNodes.length)).toBe(true);
  });

  it('คู่บัญชีที่เชื่อมกับเจ้าของตั้งแต่ 2 รายขึ้นไปเป็น "บัญชีร่วม" เสมอ แม้ไม่ติดอันดับต้น', () => {
    const touching = new Map<string, Set<string>>();
    for (const p of result.pairs) {
      if (owners.includes(p.from) && !owners.includes(p.to)) (touching.get(p.to) ?? touching.set(p.to, new Set()).get(p.to)!).add(p.from);
      if (owners.includes(p.to) && !owners.includes(p.from)) (touching.get(p.from) ?? touching.set(p.from, new Set()).get(p.from)!).add(p.to);
    }
    const shared = [...touching.entries()].filter(([id, s]) => s.size >= 2 && derived.accounts[id]?.kind === 'account').map(([id]) => id);
    expect(shared.length, 'คดีตัวอย่างต้องมีบัญชีร่วมให้ทดสอบ').toBeGreaterThan(0);
    const g = build({ topPerOwner: 1 });
    const sharedShown = nodes(g).filter((n) => n.data.role === 'shared').map((n) => n.data.id as string);
    for (const id of shared) expect(sharedShown).toContain(id);
  });

  it('รวมคู่บัญชีที่ไม่แสดงเป็นจุดสรุป โดยยอดรวมของเส้นที่แสดง + เส้นสรุป เท่ากับยอดจริงของเจ้าของแต่ละรายทั้งสองทิศ', () => {
    const g = build({ topPerOwner: 1 });
    expect(nodes(g).some((n) => n.data.role === 'agg')).toBe(true);
    for (const o of owners) {
      const sum = (dir: 'in' | 'out', rows: { source?: string; target?: string; total: number }[]) =>
        rows.filter((r) => (dir === 'out' ? r.source === o : r.target === o)).reduce((a, r) => a + r.total, 0);
      const shown = edges(g).map((e) => e.data as { source: string; target: string; total: number });
      const real = result.pairs.filter((p) => derived.accounts[p.from]?.kind === 'account' && derived.accounts[p.to]?.kind === 'account').map((p) => ({ source: p.from, target: p.to, total: p.total }));
      expect(sum('out', shown)).toBeCloseTo(sum('out', real), 2);
      expect(sum('in', shown)).toBeCloseTo(sum('in', real), 2);
    }
  });

  it('เส้นสีตามทิศทาง: เงินเข้าเจ้าของ = สีเขียว, เงินออก = สีส้ม', () => {
    const g = build();
    for (const e of edges(g)) {
      const d = e.data as { source: string; target: string; color: string };
      if (owners.includes(d.target) && !owners.includes(d.source)) expect(d.color).toBe(PRINT_PALETTE.inflow);
      if (owners.includes(d.source) && !owners.includes(d.target)) expect(d.color).toBe(PRINT_PALETTE.outflow);
    }
  });

  it('ระบายสีตามธนาคาร/ชุมชนใช้สีแทนค่าไม่เกิน 4 ชนิด ที่เหลือเป็นสีกลาง และสีไม่เปลี่ยนเมื่อกรองข้อมูล', () => {
    for (const colorBy of ['bank', 'community'] as const) {
      const all = build({ colorBy, scope: 'all' });
      const used = new Set(nodes(all).filter((n) => n.data.kind === 'account').map((n) => n.data.color as string));
      const slotColors = [...used].filter((c) => PRINT_PALETTE.slots.includes(c));
      expect(slotColors.length).toBeGreaterThan(0);
      expect(slotColors.length).toBeLessThanOrEqual(PRINT_PALETTE.slots.length);
      expect([...used].every((c) => PRINT_PALETTE.slots.includes(c) || c === PRINT_PALETTE.neutral)).toBe(true);
      // กรองยอดสูงขึ้น: จุดที่ยังอยู่ต้องได้สีเดิม (สีตามหน่วยข้อมูลของทั้งคดี ไม่ใช่ลำดับในมุมมองที่กรอง)
      const filtered = build({ colorBy, scope: 'all', minAmount: 200_000 });
      const before = new Map(nodes(all).map((n) => [n.data.id as string, n.data.color as string]));
      for (const n of nodes(filtered)) if (before.has(n.data.id as string)) expect(n.data.color).toBe(before.get(n.data.id as string));
    }
  });

  it('คำอธิบายสีตามโหมด และจุดทุกจุดมีป้ายชื่อ (ไม่พึ่งสีอย่างเดียว)', () => {
    const role = build();
    expect(role.legend.map((l) => l.label)).toEqual(expect.arrayContaining(['เจ้าของ Statement', 'เงินเข้าเจ้าของ', 'เงินออกจากเจ้าของ']));
    const bank = build({ colorBy: 'bank' });
    expect(bank.legend.some((l) => l.label.includes('ธนาคารอื่น'))).toBe(true);
    for (const n of nodes(role)) expect(String(n.data.label ?? '').length).toBeGreaterThan(0);
    expect(role.summary).toContain('แกนหลัก');
  });

  it('วางเจ้าของบนวงรีตายตัว 2–14 ราย (ไม่ซ้อนกัน); 1 รายหรือเกิน 14 ไม่ล็อกตำแหน่ง', () => {
    const g = build();
    const ring = ownerRing(g.elements);
    expect(ring).toHaveLength(owners.length);
    const keys = new Set(ring.map((r) => `${Math.round(r.position.x)},${Math.round(r.position.y)}`));
    expect(keys.size).toBe(owners.length);
    expect(ownerRing(g.elements.slice(0, 0))).toEqual([]);
    const fake = Array.from({ length: 15 }, (_, i) => ({ data: { id: 'o' + i, role: 'owner', ring: i } }));
    expect(ownerRing(fake)).toEqual([]);
  });

  it('มุมมองทุกบัญชีแสดงทุกคู่ตามยอดขั้นต่ำและไม่มีจุดสรุป', () => {
    const g = build({ scope: 'all', minAmount: 0 });
    expect(nodes(g).some((n) => n.data.role === 'agg')).toBe(false);
    expect(g.edgeCount).toBeGreaterThanOrEqual(build().edgeCount - nodes(build()).filter((n) => n.data.role === 'agg').length);
  });
});

describe('ผังเครือข่าย: การจัดวางให้อ่านง่าย', () => {
  it('รัศมีวงเจ้าของโตตามจำนวนจุด ไม่ต่ำกว่าที่เจ้าของทุกรายต้องการ และมีเพดาน', () => {
    expect(ownerRingRadius(5, 94)).toBe(600); // คดีจริง 5 เจ้าของ / 94 จุด: ผลเดิมที่อ่านง่ายอยู่แล้ว
    expect(ownerRingRadius(8, 20)).toBeLessThan(300); // คดีเล็ก: กระชับ ตัวอักษรไม่ถูกย่อ
    for (let total = 2; total < 200; total += 7) expect(ownerRingRadius(5, total + 7)).toBeGreaterThanOrEqual(ownerRingRadius(5, total));
    for (let n = 2; n <= 14; n++) {
      const r = ownerRingRadius(n, n);
      expect(r).toBeGreaterThanOrEqual(26 * n); // เจ้าของแต่ละรายมีที่ ~26 หน่วยบนเส้นรอบวง
      expect(r).toBeGreaterThanOrEqual(240);
      expect(ownerRingRadius(n, 10_000)).toBe(600);
    }
  });

  it('คดีตัวอย่าง: ตำแหน่งเจ้าของอยู่ในวงที่รัศมีตามจำนวนจุด', () => {
    const g = build();
    const ring = ownerRing(g.elements);
    const total = g.elements.filter((e) => !('source' in e.data)).length;
    const R = ownerRingRadius(owners.length, total);
    for (const r of ring) expect(Math.hypot(r.position.x / 1.25, r.position.y)).toBeCloseTo(R, 3);
  });

  it('computeFit: ผังอยู่ในพื้นที่ที่เว้นไว้ ไม่ถูกแผงด้านซ้าย/คำอธิบายสีด้านล่างบัง', () => {
    const bb = { x1: -700, y1: -300, w: 1400, h: 600 };
    const view = { w: 1200, h: 800 };
    const insets = { top: 16, right: 16, bottom: 90, left: 310 };
    const { zoom, pan } = computeFit(bb, view, insets);
    const left = bb.x1 * zoom + pan.x;
    const right = (bb.x1 + bb.w) * zoom + pan.x;
    const top = bb.y1 * zoom + pan.y;
    const bottom = (bb.y1 + bb.h) * zoom + pan.y;
    expect(left).toBeGreaterThanOrEqual(insets.left - 0.001);
    expect(right).toBeLessThanOrEqual(view.w - insets.right + 0.001);
    expect(top).toBeGreaterThanOrEqual(insets.top - 0.001);
    expect(bottom).toBeLessThanOrEqual(view.h - insets.bottom + 0.001);
    // ด้านที่เป็นตัวจำกัดชิดขอบพอดี (ใช้พื้นที่เต็ม ไม่เล็กเกินจำเป็น)
    expect(Math.max(right - left - (view.w - insets.left - insets.right), bottom - top - (view.h - insets.top - insets.bottom))).toBeCloseTo(0, 3);
  });

  it('computeFit: ผังเล็กมากไม่ถูกขยายเกินเพดาน และอยู่กึ่งกลางพื้นที่ที่เว้นไว้', () => {
    const bb = { x1: 0, y1: 0, w: 10, h: 10 };
    const { zoom, pan } = computeFit(bb, { w: 1000, h: 600 }, { top: 0, right: 0, bottom: 0, left: 200 }, { maxZoom: 1.6 });
    expect(zoom).toBe(1.6);
    expect(5 * zoom + pan.x).toBeCloseTo(200 + (1000 - 200) / 2, 3);
    expect(5 * zoom + pan.y).toBeCloseTo(300, 3);
  });
});

describe('ผังเครือข่าย: ป้ายชื่อเจ้าของ', () => {
  it('ขยายชดเชยเมื่อผังถูกย่อ แต่ไม่ขยายเมื่อผังไม่ถูกย่อ และมีเพดาน', () => {
    expect(ownerLabelScale(1.2)).toBe(1);
    expect(ownerLabelScale(0.85)).toBe(1);
    expect(ownerLabelScale(0.5)).toBeCloseTo(1.7, 5);
    expect(ownerLabelScale(0.01)).toBe(2.2);
  });

  it('fitInView ตั้ง viewport ในพื้นที่ที่เว้นไว้ แล้วปรับขนาดป้ายเฉพาะเจ้าของ', () => {
    const g = build();
    const cy = cytoscape({ headless: true, styleEnabled: false, elements: g.elements });
    // headless ไม่มีขนาดจริง — กำหนดขนาด viewport เองเพื่อทดสอบการคำนวณ
    (cy as unknown as { width: () => number; height: () => number }).width = () => 1100;
    (cy as unknown as { width: () => number; height: () => number }).height = () => 700;
    for (const r of ownerRing(g.elements)) cy.getElementById(r.nodeId).position(r.position);
    cy.nodes().not('.owner').forEach((n, i) => { n.position({ x: (i % 7) * 60 - 180, y: Math.floor(i / 7) * 60 - 60 }); });
    fitInView(cy, { top: 16, right: 16, bottom: 90, left: 310 });
    const k = ownerLabelScale(cy.zoom());
    cy.nodes('.owner').forEach((n) => { expect(n.data('fs')).toBeCloseTo(13 * k, 5); expect(n.data('tw')).toBeCloseTo(140 * k, 5); });
    cy.nodes().not('.owner').forEach((n) => expect(n.data('fs')).toBeLessThanOrEqual(11));
    // ศูนย์กลางผังต้องอยู่ในพื้นที่ที่เว้นไว้ (x ≥ 310, y ≤ 700-90)
    const c = cy.elements().boundingBox({ includeLabels: false });
    const cx = ((c.x1 + c.x2) / 2) * cy.zoom() + cy.pan().x;
    const cyy = ((c.y1 + c.y2) / 2) * cy.zoom() + cy.pan().y;
    expect(cx).toBeGreaterThan(310);
    expect(cyy).toBeLessThan(700 - 90);
    cy.destroy();
  });
});
