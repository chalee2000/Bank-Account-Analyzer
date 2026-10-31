// ตัวสร้างผังเครือข่าย: มุมมอง "แกนหลัก" ต้องไม่ทำให้เงินหาย สีต้องคงที่เมื่อกรอง และไม่ใช้สีเกิน 4 ชนิดแทนค่า
import cytoscape from 'cytoscape';
import { describe, it, expect } from 'vitest';
import { buildDemoCase } from '../../src/demo';
import { deriveCase } from '../../src/store/model';
import { analyze } from '../../src/analysis';
import {
  autoMinAmount, badgeTextColor, bankBadge, buildElements, computeFit, concentricPositions, fitInView, FLOW_GEOM, flowGlyph, flowGlyphs, flowLabelOffset,
  flowPill, flowPositions, flowRoles, flowRoute, graphSignature, hashSignature, netOptionsFromView,
  noteElements, noteSize, ownerLabelScale, ownerRing, ownerRingRadius, planLayout, PRINT_PALETTE, runLayoutPlan, snapshotPositions, syncNotes,
  updateElementsInPlace, type NetOptions,
} from '../../src/ui/network/graph';
import type { ElementDefinition } from 'cytoscape';

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

describe('ผังเครือข่าย: ชื่อและรูปบุคคลที่ผู้สืบสวนกำหนด', () => {
  const PHOTO = 'data:image/jpeg;base64,/9j/AAAA';
  const NAME = 'นายสมมติ ทดสอบระบบ';
  const plain = nodes(build()).find((n) => n.data.role === 'plain')!;
  const id = plain.data.id as string;
  /** สถานะคดีหลังตั้งชื่อ/ใส่รูป — derived สร้างจาก deriveCase เหมือนตอนเปิดคดี */
  const withNote = (note: { label?: string; photo?: string }) => {
    const st = { ...state, accountNotes: { [id]: note } };
    return { st, d: deriveCase(st) };
  };
  const nodeOf = (g: ReturnType<typeof build>, nid = id) => nodes(g).find((n) => n.data.id === nid)!;

  it('คู่บัญชีทั่วไปแสดงแค่รหัสธนาคาร+เลขท้าย; เมื่อตั้งชื่อแล้วแสดงชื่อเหนือรหัส', () => {
    const before = plain.data.label as string;
    expect(before).toMatch(/^\S+ ••\d{4}$/);
    const { st, d } = withNote({ label: NAME });
    const g = buildElements(d, result, st, base, PRINT_PALETTE);
    expect((nodeOf(g).data.label as string).split('\n')).toEqual([NAME, before]);
    expect(nodeOf(g).data.full).toContain(NAME);
  });

  it('รูปบุคคลอยู่ใน data(photo) และจุดใหญ่พอเห็นหน้า; ปิด showPhotos (เช่นในรายงาน) แล้วไม่มีรูป', () => {
    const { st, d } = withNote({ photo: PHOTO });
    const on = nodeOf(buildElements(d, result, st, base, PRINT_PALETTE));
    expect(on.data.photo).toBe(PHOTO);
    expect(on.data.size).toBeGreaterThanOrEqual(44);
    const off = nodeOf(buildElements(d, result, st, { ...base, showPhotos: false }, PRINT_PALETTE));
    expect(off.data.photo).toBeUndefined();
    expect(off.data.size).toBe(plain.data.size);
    // จุดอื่นไม่ได้รับรูปไปด้วย
    expect(nodes(buildElements(d, result, st, base, PRINT_PALETTE)).filter((n) => n.data.photo)).toHaveLength(1);
  });

  it('graphSignature เท่าเดิมเมื่อเปลี่ยนแค่ชื่อ/รูป/สี (ไม่ต้องจัดวางใหม่) แต่ต่างเมื่อจุดหรือเส้นเปลี่ยน', () => {
    const sig = graphSignature(build().elements);
    const { st, d } = withNote({ label: NAME, photo: PHOTO });
    expect(graphSignature(buildElements(d, result, st, base, PRINT_PALETTE).elements)).toBe(sig);
    expect(graphSignature(build({ colorBy: 'bank' }).elements)).toBe(sig);
    expect(graphSignature(build({ scope: 'all' }).elements)).not.toBe(sig);
    expect(graphSignature(build({ showCash: true }).elements)).not.toBe(sig);
  });

  it('updateElementsInPlace แก้ป้ายและรูปโดยตำแหน่งจุดและไฮไลต์ที่กำลังดูคงเดิม และลบรูปออกได้', () => {
    const g = build();
    // Cytoscape ใช้อ็อบเจ็กต์ data ของ element ที่ส่งเข้าไปตรง ๆ — คัดลอกก่อน ไม่ให้การแก้ข้อมูลย้อนไปเปลี่ยน g
    const cy = cytoscape({ headless: true, styleEnabled: false, elements: structuredClone(g.elements) });
    cy.nodes().forEach((n, i) => { n.position({ x: i * 37, y: (i % 5) * 29 }); });
    const n = cy.getElementById(id);
    const pos = { ...n.position() };
    n.addClass('hl');
    const { st, d } = withNote({ label: NAME, photo: PHOTO });
    updateElementsInPlace(cy, buildElements(d, result, st, base, PRINT_PALETTE).elements);
    expect(n.data('photo')).toBe(PHOTO);
    expect(String(n.data('label'))).toContain(NAME);
    expect(n.position()).toEqual(pos);
    expect(n.hasClass('hl')).toBe(true);
    expect(n.hasClass('plain')).toBe(true);
    // กลับเป็นไม่มีรูป/ชื่อ → ข้อมูลรูปต้องหายไปจริง (selector node[photo] จะไม่จับ)
    updateElementsInPlace(cy, g.elements);
    expect(n.data('photo')).toBeUndefined();
    expect(n.data('label')).toBe(plain.data.label);
    expect(cy.nodes('[photo]').length).toBe(0);
    cy.destroy();
  });
});

describe('ผังเครือข่าย: รูปแบบวงซ้อน', () => {
  /** ตำแหน่งวงซ้อน → ระยะ/มุมจากศูนย์กลางของแต่ละจุด */
  const concentricDistances = (elements: ElementDefinition[]) => {
    const ns = elements.filter((e) => !('source' in e.data)).map((e) => e.data as { id: string; role: string; anchor?: number; size?: number; ring?: number });
    const pos = concentricPositions(ns);
    const dist = new Map(ns.map((n) => [n.id, Math.hypot(pos[n.id]!.x, pos[n.id]!.y)]));
    const angle = new Map(ns.map((n) => [n.id, Math.atan2(pos[n.id]!.y, pos[n.id]!.x)]));
    const roles = new Map(ns.map((n) => [n.id, n.role]));
    return { dist, angle, roles, pos, ns };
  };

  it('anchor ของคู่บัญชีชี้เจ้าของที่เชื่อมด้วยยอดสูงสุด และของเจ้าของคือลำดับบนวงของตัวเอง', () => {
    const g = build();
    const ring = new Map(nodes(g).filter((n) => n.data.role === 'owner').map((n) => [n.data.id as string, n.data.ring as number]));
    for (const [id, r] of ring) expect(nodes(g).find((n) => n.data.id === id)!.data.anchor).toBe(r);
    for (const n of nodes(g).filter((x) => x.data.role === 'plain' || x.data.role === 'shared')) {
      const id = n.data.id as string;
      const tot = new Map<string, number>();
      for (const p of result.pairs) {
        if (p.from === id && ring.has(p.to)) tot.set(p.to, (tot.get(p.to) ?? 0) + p.total);
        if (p.to === id && ring.has(p.from)) tot.set(p.from, (tot.get(p.from) ?? 0) + p.total);
      }
      const best = [...tot.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      expect(n.data.anchor).toBe(ring.get(best));
    }
  });

  it('เจ้าของ Statement อยู่วงใน บัญชีร่วมวงถัดมา คู่บัญชีวงนอก และจุดสรุปเส้นประอยู่วงนอกสุด', () => {
    const { dist, roles } = concentricDistances(build({ topPerOwner: 2 }).elements);
    const of = (role: string) => [...dist.entries()].filter(([id]) => roles.get(id) === role).map(([, v]) => v);
    const owner = of('owner');
    const shared = of('shared');
    const plain = of('plain');
    const agg = of('agg');
    expect(owner.length).toBeGreaterThan(1);
    expect(shared.length).toBeGreaterThan(0);
    expect(agg.length).toBeGreaterThan(0);
    expect(Math.max(...owner)).toBeLessThan(Math.min(...shared));
    expect(Math.max(...shared)).toBeLessThan(Math.min(...plain));
    expect(Math.max(...plain)).toBeLessThan(Math.min(...agg));
  });

  it('คู่บัญชีของเจ้าของแต่ละรายแผ่ออกไปด้านเดียวกับเจ้าของ (มุมใกล้มุมของเจ้าของ) และไม่มีจุดซ้อนกัน', () => {
    const g = build({ topPerOwner: 25 });
    const { angle, roles, pos, ns } = concentricDistances(g.elements);
    const ownerAt = new Map(ns.filter((n) => n.role === 'owner').map((n) => [n.anchor!, angle.get(n.id)!]));
    const diffs = ns.filter((n) => roles.get(n.id) === 'plain' && ownerAt.has(n.anchor!))
      .map((n) => Math.abs(Math.atan2(Math.sin(angle.get(n.id)! - ownerAt.get(n.anchor!)!), Math.cos(angle.get(n.id)! - ownerAt.get(n.anchor!)!))));
    expect(diffs.length).toBeGreaterThan(5);
    expect(diffs.reduce((a, b) => a + b, 0) / diffs.length).toBeLessThan(Math.PI / 4);
    // ไม่มีสองจุดอยู่ใกล้กันจนซ้อน
    const pts = Object.values(pos);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y)).toBeGreaterThan(20);
    }
  });

  it('จุดเยอะเกินวงเดียวสลับวงย่อย ระยะห่างไม่ต่ำกว่าขั้นต่ำ', () => {
    const els: ElementDefinition[] = [
      { data: { id: 'o', role: 'owner', size: 50, anchor: 0, ring: 0 } },
      ...Array.from({ length: 300 }, (_, i) => ({ data: { id: 'p' + i, role: 'plain', size: 20, anchor: 0 } })),
    ];
    const { pos } = concentricDistances(els);
    const pts = Object.entries(pos).filter(([id]) => id !== 'o').map(([, p]) => p);
    let minD = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) minD = Math.min(minD, Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y));
    expect(minD).toBeGreaterThan(30);
  });

  it('เจ้าของรายเดียวอยู่กลางพอดี คู่บัญชีล้อมรอบ', () => {
    const els: ElementDefinition[] = [
      { data: { id: 'o', role: 'owner', size: 50, anchor: 0 } },
      ...['a', 'b', 'c'].map((id) => ({ data: { id, role: 'plain', size: 20, anchor: 0 } })),
      { data: { id: 'agg', role: 'agg', size: 20, anchor: 0 } },
      { data: { id: 'e1', source: 'a', target: 'o' } }, { data: { id: 'e2', source: 'o', target: 'b' } }, { data: { id: 'e3', source: 'o', target: 'c' } },
      { data: { id: 'e4', source: 'agg', target: 'o' } },
    ];
    const { dist } = concentricDistances(els);
    expect(dist.get('o')).toBeLessThan(1e-6);
    for (const id of ['a', 'b', 'c', 'agg']) expect(dist.get(id)).toBeGreaterThan(20);
  });
});

describe('ผังเครือข่าย: จำตำแหน่งที่จัดไว้', () => {
  const g = build();
  const ids = nodes(g).map((n) => n.data.id as string);
  const all = Object.fromEntries(ids.map((id, i) => [id, { x: i * 10, y: -i * 5 }]));

  it('ผังเหมือนตอนบันทึก → ใช้ตำแหน่งเดิมทั้งหมดไม่ว่ารูปแบบใด', () => {
    const saved = { sig: hashSignature(g.elements), nodes: all, manual: true };
    expect(planLayout('auto', g.elements, saved)).toEqual({ kind: 'preset', positions: all });
    expect(planLayout('concentric', g.elements, saved).kind).toBe('preset');
  });

  it('ไม่มีตำแหน่ง → อัตโนมัติวางเจ้าของบนวงรีตายตัว / วงซ้อนจัดใหม่', () => {
    const p = planLayout('auto', g.elements);
    expect(p).toEqual({ kind: 'fcose', fixed: ownerRing(g.elements), reused: false });
    expect(planLayout('concentric', g.elements).kind).toBe('concentric');
  });

  it('ผังเปลี่ยน (เช่น เปิดจุดเงินสดเพิ่ม): โหมดอัตโนมัติล็อกจุดที่เคยวางไว้แล้วจัดเฉพาะจุดใหม่ / วงซ้อนจัดใหม่ทั้งผัง', () => {
    const saved = { sig: hashSignature(g.elements), nodes: all };
    const g2 = build({ showCash: true });
    expect(hashSignature(g2.elements)).not.toBe(saved.sig);
    const p = planLayout('auto', g2.elements, saved);
    expect(p.kind).toBe('fcose');
    if (p.kind !== 'fcose') return;
    expect(p.reused).toBe(true);
    const present = new Set(nodes(g2).map((n) => n.data.id as string));
    expect(p.fixed.map((f) => f.nodeId).sort()).toEqual(ids.filter((id) => present.has(id)).sort());
    expect(p.fixed.every((f) => f.position === all[f.nodeId])).toBe(true);
    expect(planLayout('concentric', g2.elements, saved).kind).toBe('concentric');
  });

  it('ตำแหน่งไม่ครบทุกจุด แม้ sig ตรง → ไม่ใช้แบบ preset', () => {
    const partial = { ...all };
    delete partial[ids[0]!];
    expect(planLayout('auto', g.elements, { sig: hashSignature(g.elements), nodes: partial }).kind).toBe('fcose');
  });

  it('hashSignature คงที่เมื่อเปลี่ยนแค่สี และต่างเมื่อชุดจุด/เส้นเปลี่ยน', () => {
    expect(hashSignature(build({ colorBy: 'community' }).elements)).toBe(hashSignature(g.elements));
    expect(hashSignature(build({ topPerOwner: 2 }).elements)).not.toBe(hashSignature(g.elements));
  });

  it('snapshotPositions เก็บทุกจุด ปัดทศนิยม 1 ตำแหน่ง และระบุว่าจัดเองหรือไม่', () => {
    const cy = cytoscape({ headless: true, styleEnabled: false, elements: structuredClone(g.elements) });
    cy.nodes().forEach((n, i) => { n.position({ x: i + 0.123, y: -i - 0.987 }); });
    const snap = snapshotPositions(cy, 'abc', true)!;
    expect(snap.sig).toBe('abc');
    expect(snap.manual).toBe(true);
    expect(Object.keys(snap.nodes).sort()).toEqual([...ids].sort());
    expect(snap.nodes[ids[1]!]).toEqual({ x: 1.1, y: -2 });
    expect(snapshotPositions(cy, 'abc', false)!.manual).toBeUndefined();
    cy.destroy();
  });

  it('ตัวกรองที่บันทึกแปลงเป็นตัวเลือกผังแบบเดียวกันทุกที่ (หน้าเครือข่าย/รายงาน) และคำบรรยายบอกช่วงวันที่', () => {
    const o = netOptionsFromView({ scope: 'core', topPerOwner: 12, colorBy: 'role', showCash: true, showManual: true, from: '2024-03-02', to: '2024-03-05' }, result);
    expect(o.from).toBe(Date.UTC(2024, 2, 2));
    expect(o.to).toBe(Date.UTC(2024, 2, 5, 23, 59, 59));
    expect(o.minAmount).toBe(0);
    expect(netOptionsFromView({ scope: 'all', topPerOwner: 12, colorBy: 'role', showCash: true, showManual: true }, result).minAmount).toBe(autoMinAmount(result));
    expect(netOptionsFromView({ scope: 'all', topPerOwner: 12, colorBy: 'role', showCash: true, showManual: true, allMin: 5000 }, result).minAmount).toBe(5000);
    const sum = buildElements(derived, result, state, { ...o, showManual: false }, PRINT_PALETTE).summary;
    expect(sum).toContain('ช่วงวันที่');
    expect(build().summary).not.toContain('ช่วงวันที่');
  });
});

describe('ผังเครือข่าย: ป้ายเส้น ไอคอนธนาคาร และข้อความบนผัง (เมนูคลิกขวา)', () => {
  const g0 = build();
  const money = (g: ReturnType<typeof build>) => edges(g).filter((e) => !String(e.classes ?? '').includes('manual-link'));
  const cls = (e: ElementDefinition) => String(e.classes ?? '').split(/\s+/).filter(Boolean);

  it('ปิดป้ายเส้น (ค่าเริ่มต้น) → ไม่มีคลาสป้าย; ปกติ/การ์ด → ทุกเส้นเงินได้คลาสตามโหมด', () => {
    expect(money(g0).every((e) => !cls(e).some((c) => c.startsWith('lbl-')))).toBe(true);
    expect(money(build({ edgeLabels: 'plain' })).every((e) => cls(e).includes('lbl-plain'))).toBe(true);
    expect(money(build({ edgeLabels: 'card' })).every((e) => cls(e).includes('lbl-card') && !cls(e).includes('lbl-plain'))).toBe(true);
    // เส้นสรุปยังมีคลาสเดิม
    expect(edges(build({ edgeLabels: 'card' })).filter((e) => cls(e).includes('agg-edge')).every((e) => cls(e).includes('lbl-card'))).toBe(true);
  });

  it('การ์ดบอกยอด จำนวนรายการ และช่วงวันที่จริงของคู่บัญชี; ป้ายปกติบอกยอด×จำนวน', () => {
    const g = build({ edgeLabels: 'card' });
    const e = money(g).find((x) => !cls(x).includes('agg-edge'))!;
    const p = result.pairs.find((x) => x.from === e.data.source && x.to === e.data.target)!;
    const lines = String(e.data.card).split('\n');
    expect(lines[0]).toMatch(/฿$/);
    expect(lines[1]).toBe(`${p.count.toLocaleString('en-US')} รายการ`);
    expect(lines.length).toBe(3);
    expect(lines[2]).toMatch(/\d/);
    expect(String(e.data.label)).toMatch(new RegExp(`×${p.count}$`));
    expect(e.data.key).toBe(`${p.from}>${p.to}`);
  });

  it('ปักเส้นเดียว → เฉพาะเส้นนั้นแสดงป้าย (โหมดการ์ดใช้แบบการ์ด)', () => {
    const key = String(money(g0)[0]!.data.key);
    const g = build({ pinnedEdges: [key] });
    const pinned = money(g).filter((e) => cls(e).includes('lbl-pin'));
    expect(pinned.map((e) => e.data.key)).toEqual([key]);
    const gc = build({ edgeLabels: 'card', pinnedEdges: [key] });
    expect(money(gc).find((e) => e.data.key === key)!.classes).toContain('lbl-card');
    expect(money(gc).some((e) => cls(e).includes('lbl-pin'))).toBe(false);
  });

  it('ไอคอนธนาคารเฉพาะจุดบัญชีที่รู้ธนาคาร ไม่ทับรูปบุคคล และจุดใหญ่พออ่านตัวย่อ', () => {
    const g = build({ bankBadges: true, showCash: true });
    const withBadge = nodes(g).filter((n) => n.data.badge);
    expect(withBadge.length).toBeGreaterThan(0);
    for (const n of withBadge) {
      expect(n.data.kind).toBe('account');
      expect(n.data.bank).not.toBe('');
      expect(n.data.size as number).toBeGreaterThanOrEqual(30);
      expect(String(n.data.badge)).toMatch(/^data:image\/svg\+xml/);
    }
    expect(nodes(g).filter((n) => n.data.kind !== 'account').every((n) => !n.data.badge)).toBe(true);
    // จุดที่มีรูปบุคคลใช้รูปบุคคล
    const id = withBadge[0]!.data.id as string;
    const st = { ...state, accountNotes: { [id]: { photo: 'data:image/jpeg;base64,/9j/AAAA' } } };
    const gp = buildElements(deriveCase(st), result, st, { ...base, bankBadges: true, showPhotos: true }, PRINT_PALETTE);
    const n = nodes(gp).find((x) => x.data.id === id)!;
    expect(n.data.photo).toBeTruthy();
    expect(n.data.badge).toBeUndefined();
  });

  it('ตัวอักษรบนไอคอนอ่านได้: ความต่างของสีกับพื้นไม่ต่ำกว่า 4.5:1 ทั้งพื้นสว่างและเข้ม และตัดอักขระอันตรายใน SVG', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const f = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
    };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
    for (const fill of ['#ffffff', '#fff4c2', '#eda100', '#3987e5', '#1d6b3f', '#7a2fb5', '#141414', '#9aa0a6']) {
      expect(ratio(badgeTextColor(fill), fill)).toBeGreaterThanOrEqual(4.5);
    }
    expect(badgeTextColor('#000000')).toBe('#ffffff');
    expect(badgeTextColor('#ffffff')).toBe('#141414');
    expect(decodeURIComponent(bankBadge('<b>&"x\'', '#3987e5'))).not.toMatch(/<b>|&"/);
  });

  it('สลับป้ายเส้น/ปักเส้น/ไอคอน ไม่เปลี่ยนโครงสร้างผัง (อัปเดตในที่เดิม ไม่จัดวางใหม่)', () => {
    const sig = graphSignature(g0.elements);
    const hash = hashSignature(g0.elements);
    for (const o of [{ edgeLabels: 'plain' as const }, { edgeLabels: 'card' as const }, { bankBadges: true }, { pinnedEdges: [String(money(g0)[0]!.data.key)] }]) {
      const g = build(o);
      expect(graphSignature(g.elements)).toBe(sig);
      expect(hashSignature(g.elements)).toBe(hash);
    }
    // updateElementsInPlace ใส่คลาสป้ายและรูปไอคอน โดยตำแหน่งเดิม
    const cy = cytoscape({ headless: true, styleEnabled: false, elements: structuredClone(g0.elements) });
    cy.nodes().forEach((n, i) => { n.position({ x: i * 7, y: i * 3 }); });
    const before = cy.nodes().map((n) => ({ ...n.position() }));
    updateElementsInPlace(cy, build({ edgeLabels: 'card', bankBadges: true }).elements);
    expect(cy.nodes().map((n) => ({ ...n.position() }))).toEqual(before);
    expect(cy.edges('.lbl-card').length).toBe(money(g0).length);
    expect(cy.nodes('[badge]').length).toBeGreaterThan(0);
    updateElementsInPlace(cy, g0.elements);
    expect(cy.edges('.lbl-card').length).toBe(0);
    expect(cy.nodes('[badge]').length).toBe(0);
    cy.destroy();
  });

  it('noteSize: กว้างตามข้อความในกรอบ 70–240 px สูงตามจำนวนบรรทัด (ตัดบรรทัดยาว)', () => {
    const s1 = noteSize('สั้น');
    expect(s1.w).toBeGreaterThanOrEqual(70);
    const long = noteSize('ก'.repeat(100));
    expect(long.w).toBeLessThanOrEqual(240);
    expect(long.h).toBeGreaterThan(s1.h);
    expect(noteSize('a\nb\nc').h).toBeGreaterThan(noteSize('a').h);
  });

  it('โน้ตใช้ตำแหน่งของรูปแบบนั้น (ไม่มีก็ใช้ของอีกรูปแบบ) และ syncNotes เพิ่ม/แก้/ลบโดยไม่แตะจุดอื่น', () => {
    const notes = [
      { id: 'n1', text: 'ข้อความทดสอบ 1', pos: { auto: { x: 10, y: 20 }, concentric: { x: -5, y: -6 } } },
      { id: 'n2', text: 'ข้อความทดสอบ 2', pos: { auto: { x: 100, y: 200 } } },
    ];
    expect(noteElements(notes, 'concentric').map((e) => e.position)).toEqual([{ x: -5, y: -6 }, { x: 100, y: 200 }]);
    expect(noteElements(notes, 'auto')[0]!.classes).toBe('note');
    const cy = cytoscape({ headless: true, styleEnabled: false, elements: structuredClone(g0.elements) });
    const graphCount = cy.nodes().length;
    syncNotes(cy, notes, 'auto');
    expect(cy.nodes('.note').length).toBe(2);
    expect(cy.getElementById('note:n2').position()).toEqual({ x: 100, y: 200 });
    syncNotes(cy, [{ ...notes[0]!, text: 'แก้แล้ว' }], 'auto');
    expect(cy.nodes('.note').length).toBe(1);
    expect(cy.getElementById('note:n1').data('label')).toBe('แก้แล้ว');
    expect(cy.nodes().not('.note').length).toBe(graphCount);
    syncNotes(cy, undefined, 'auto');
    expect(cy.nodes('.note').length).toBe(0);
    cy.destroy();
  });

  it('การจัดวางและการบันทึกตำแหน่งไม่แตะโน้ต', async () => {
    const cy = cytoscape({ headless: true, styleEnabled: false, elements: structuredClone(g0.elements) });
    syncNotes(cy, [{ id: 'n1', text: 'โน้ต', pos: { concentric: { x: 9999, y: -9999 } } }], 'concentric');
    await runLayoutPlan(cy, { kind: 'concentric' }, g0.nodeCount);
    expect(cy.getElementById('note:n1').position()).toEqual({ x: 9999, y: -9999 });
    const snap = snapshotPositions(cy, 'x', false)!;
    expect(Object.keys(snap.nodes).some((k) => k.startsWith('note:'))).toBe(false);
    expect(Object.keys(snap.nodes).length).toBe(cy.nodes().not('.note').length);
    const all = Object.fromEntries(cy.nodes().not('.note').map((n) => [n.id(), { x: 1, y: 2 }]));
    await runLayoutPlan(cy, { kind: 'preset', positions: all }, g0.nodeCount);
    expect(cy.getElementById('note:n1').position()).toEqual({ x: 9999, y: -9999 });
    cy.destroy();
  });

  it('ตัวเลือกที่บันทึก (ป้ายเส้น/ไอคอน/ปักเส้น) แปลงเป็นตัวเลือกผัง และค่าเริ่มต้นคือปิด', () => {
    const v = { scope: 'core' as const, topPerOwner: 12, colorBy: 'role' as const, showCash: true, showManual: true };
    const o0 = netOptionsFromView(v, result);
    expect(o0.edgeLabels).toBe('off');
    expect(o0.bankBadges).toBe(false);
    expect(o0.pinnedEdges).toEqual([]);
    const o1 = netOptionsFromView({ ...v, edgeLabels: 'card', bankBadges: true, pinnedEdges: ['a>b'] }, result);
    expect([o1.edgeLabels, o1.bankBadges, o1.pinnedEdges]).toEqual(['card', true, ['a>b']]);
  });
});

describe('ผังไหลเงิน (เส้นมุมฉาก)', () => {
  const g = build({ flow: true, showCash: true, topPerOwner: 3 });
  const fnodes = nodes(g).map((n) => ({
    id: n.data.id as string, role: n.data.role as string, size: n.data.size as number, label: n.data.label as string,
    fs: n.data.fs as number, tw: n.data.tw as number | undefined, ring: n.data.ring as number | undefined,
  }));
  const fedges = edges(g).filter((e) => !String(e.classes ?? '').includes('manual-link'))
    .map((e) => ({ source: e.data.source as string, target: e.data.target as string, total: e.data.total as number }));
  const pos = flowPositions(fnodes, fedges);
  const col = flowRoles(fnodes.map((n) => n.id), fedges, (id) => fnodes.find((n) => n.id === id)?.role === 'owner');
  const ofCol = (c: string) => fnodes.filter((n) => col.get(n.id) === c).map((n) => n.id);

  it('แบ่ง 3 ส่วน: ผู้โอนเข้า x = 0 < ทุกเลนกลาง (ไม่ซ้ำกัน) < ผู้รับ; เจ้าของอยู่ขั้นบันไดเสมอ; จุดสรุป "+N" เข้าอยู่ซ้าย ออกอยู่ขวา', () => {
    const hubs = ofCol('hub');
    const srcs = ofCol('src');
    const sinks = ofCol('sink');
    expect(srcs.length).toBeGreaterThan(0);
    expect(sinks.length).toBeGreaterThan(0);
    for (const o of owners) expect(col.get(o)).toBe('hub');
    const laneXs = hubs.map((id) => pos[id]!.x);
    expect(new Set(laneXs).size).toBe(hubs.length);
    const minLane = Math.min(...laneXs);
    const maxLane = Math.max(...laneXs);
    for (const id of srcs) expect(pos[id]!.x).toBe(0);
    expect(minLane).toBeGreaterThan(0);
    const rightX = pos[sinks[0]!]!.x;
    for (const id of sinks) expect(pos[id]!.x).toBe(rightX);
    expect(rightX).toBeGreaterThan(maxLane);
    const aggIn = fnodes.filter((n) => n.id.startsWith('agg:') && n.id.endsWith(':in'));
    const aggOut = fnodes.filter((n) => n.id.startsWith('agg:') && n.id.endsWith(':out'));
    expect(aggIn.length + aggOut.length).toBeGreaterThan(0);
    for (const n of aggIn) expect(pos[n.id]!.x).toBe(0);
    for (const n of aggOut) expect(pos[n.id]!.x).toBe(rightX);
  });

  it('ทุกจุดอยู่คนละแถว ห่างกันไม่ต่ำกว่าขั้นต่ำ; ผู้โอนเข้าเฉพาะรายอยู่เหนือบัญชี ผู้รับเฉพาะรายอยู่ใต้บัญชี', () => {
    const ys = Object.values(pos).map((p) => p.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(FLOW_GEOM.minRow - 0.01);
    for (const id of ofCol('src')) {
      const targets = [...new Set(fedges.filter((e) => e.source === id).map((e) => e.target))];
      if (targets.length === 1) expect(pos[id]!.y).toBeLessThan(pos[targets[0]!]!.y);
    }
    for (const id of ofCol('sink')) {
      const sources = [...new Set(fedges.filter((e) => e.target === id).map((e) => e.source))];
      if (sources.length === 1) expect(pos[id]!.y).toBeGreaterThan(pos[sources[0]!]!.y);
    }
  });

  it('ขั้นบันไดเรียงตามทิศเงิน: เส้นระหว่างบัญชีในขั้นบันไดส่วนใหญ่ไหลจากเลนซ้ายไปเลนขวา (ตัดวงวนแล้ว)', () => {
    const hubEdges = fedges.filter((e) => col.get(e.source) === 'hub' && col.get(e.target) === 'hub');
    expect(hubEdges.length).toBeGreaterThan(0);
    const forward = hubEdges.filter((e) => pos[e.target]!.x > pos[e.source]!.x).length;
    expect(forward / hubEdges.length).toBeGreaterThanOrEqual(0.8);
  });

  it('เส้นจากคอลัมน์ซ้ายเป็น flow-h ที่เหลือ flow-v (ตอนสร้าง); ป้ายแคปซูลปัดบาท + จำนวนครั้ง; เส้นที่เพิ่มเองไม่เป็นมุมฉาก', () => {
    for (const e of edges(g)) {
      const cls = String(e.classes ?? '');
      if (cls.includes('manual-link')) { expect(cls).not.toContain('flow'); continue; }
      expect(cls).toContain('flow');
      expect(cls).toContain(col.get(e.data.source as string) === 'src' ? 'flow-h' : 'flow-v');
      expect(e.data.pill).toBe(flowPill(e.data.total as number, e.data.count as number));
    }
    expect(flowPill(12107.4, 38)).toBe('฿12,107 (38×)');
    expect(flowPill(1999.5, 1200)).toBe('฿2,000 (1,200×)');
    // ไม่ใช่ผังไหลเงิน → ไม่มีคลาส/ข้อมูลของผังไหลเงิน
    expect(edges(build()).every((e) => !String(e.classes ?? '').includes('flow') && e.data.pill === undefined)).toBe(true);
  });

  it('ป้ายเจ้าของมีช่วงวันที่และยอดหมุนเวียน (เฉพาะผังไหลเงิน); โครงสร้างผังเท่ากับรูปแบบอื่น', () => {
    const o = owners[0]!;
    const lf = String(nodes(g).find((n) => n.data.id === o)!.data.label);
    const ln = String(nodes(build({ showCash: true, topPerOwner: 3 })).find((n) => n.data.id === o)!.data.label);
    expect(lf.startsWith(ln)).toBe(true);
    expect(lf).toMatch(/หมุนเวียน [\d,]+\.\d\d ฿$/);
    expect(lf.split('\n').length).toBe(ln.split('\n').length + 2);
    const plain = build({ showCash: true, topPerOwner: 3 });
    expect(graphSignature(g.elements)).toBe(graphSignature(plain.elements));
    expect(hashSignature(g.elements)).toBe(hashSignature(plain.elements));
  });

  it('ลูกศร เส้นทาง และตำแหน่งป้าย', () => {
    expect(flowGlyph({ x: 0, y: 0 }, { x: 100, y: 50 })).toBe('▸');
    expect(flowGlyph({ x: 100, y: 0 }, { x: 0, y: 50 })).toBe('◂');
    expect(flowGlyph({ x: 0, y: 100 }, { x: 5, y: 0 })).toBe('▴');
    expect(flowGlyph({ x: 0, y: 0 }, { x: 5, y: 100 })).toBe('▾');
    expect(flowRoute(true, { x: 0, y: 0 }, { x: 300, y: 100 })).toBe('flow-h');
    expect(flowRoute(false, { x: 300, y: 0 }, { x: 500, y: 100 })).toBe('flow-v');
    expect(flowRoute(false, { x: 500, y: 300 }, { x: 300, y: 100 })).toBe('flow-h'); // เงินย้อนไปเลนซ้าย
    // เข้าบัญชีในขั้นบันได: ป้ายถัดจากจุดเลี้ยว (ไกลจากปลายทาง) / เข้าคอลัมน์ขวา: ใกล้ผู้รับ
    expect(flowLabelOffset('flow-v', 'hub', { x: 0, y: 0 }, { x: 400, y: 200 }, 60)).toBe(400 - 30 - 72);
    expect(flowLabelOffset('flow-v', 'hub', { x: 0, y: 0 }, { x: 100, y: 200 }, 60)).toBe(48);
    expect(flowLabelOffset('flow-v', 'sink', { x: 0, y: 0 }, { x: 900, y: 200 }, 20)).toBe(66);
  });

  it('runLayoutPlan(flow) วางตาม flowPositions ไม่แตะโน้ต และ flowGlyphs ตั้งเส้นทาง/ลูกศร/ระยะป้ายตามตำแหน่ง', async () => {
    expect(planLayout('flow', g.elements)).toEqual({ kind: 'flow' });
    const saved = { sig: hashSignature(g.elements), nodes: Object.fromEntries(fnodes.map((n) => [n.id, { x: 1, y: 2 }])) };
    expect(planLayout('flow', g.elements, saved).kind).toBe('preset');
    const cy = cytoscape({ headless: true, styleEnabled: false, elements: structuredClone(g.elements) });
    syncNotes(cy, [{ id: 'n1', text: 'โน้ต', pos: { flow: { x: -500, y: -500 } } }], 'flow');
    await runLayoutPlan(cy, { kind: 'flow' }, g.nodeCount);
    for (const n of fnodes) expect(cy.getElementById(n.id).position()).toEqual(pos[n.id]);
    expect(cy.getElementById('note:n1').position()).toEqual({ x: -500, y: -500 });
    cy.edges('.flow').forEach((e) => {
      const s = e.source().position();
      const t = e.target().position();
      const back = e.hasClass('flow-back');
      expect(e.hasClass(flowRoute(e.source().data('fcol') === 'src', s, t))).toBe(true);
      expect(String(e.data('pillText'))).toBe(`${e.data('pill')} ${back ? (t.y < s.y ? '▴' : '▾') : flowGlyph(s, t)}`);
      expect(e.data('toff')).toBeGreaterThan(0);
    });
    // ลากจุดปลายทางไปทางซ้ายของต้นทาง → เส้นเปลี่ยนเป็นแนวนอนก่อน และลูกศรเปลี่ยนตาม
    const e = cy.edges('.flow-v').filter((x) => x.target().data('fcol') === 'sink')[0]!;
    e.target().position({ x: e.source().position('x') - 300, y: e.target().position('y') });
    flowGlyphs(cy);
    expect(e.hasClass('flow-h')).toBe(true);
    expect(e.hasClass('flow-back')).toBe(true);
    cy.destroy();
  });
});
