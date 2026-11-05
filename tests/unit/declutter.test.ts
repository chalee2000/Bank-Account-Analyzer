// ตัวเลขยอดเงินบนเส้นต้องไม่ทับกัน: เลือกตำแหน่ง/ซ่อนป้าย (declutter), เส้นทางตามที่ Cytoscape วาด, ป้ายซ้อนขั้นของ Organization
import { describe, it, expect } from 'vitest';
import { declutter, edgePath, LABEL_SLIDE, orgLabelHeight, orgLabelOffsets, type Box, type LabelItem, type OrgLabelEnd } from '../../src/ui/network/graph';
import { edgeLabelWidth, labelTextWidth, orgPositions, type LEdge, type LNode } from '../../src/ui/network/layouts';

const box = (x: number, y: number, w = 80, h = 14): Box => ({ x1: x, y1: y, x2: x + w, y2: y + h });
const hit = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

describe('declutter', () => {
  it('ป้ายที่ไม่ชนกันแสดงทั้งหมด ไม่ซ่อน ไม่เลื่อน', () => {
    const r = declutter([{ id: 'a', total: 1, cands: [box(0, 0)] }, { id: 'b', total: 2, cands: [box(0, 40)] }, { id: 'c', total: 3, cands: [box(200, 0)] }]);
    expect(r.hidden.size).toBe(0);
    expect(r.moved.size).toBe(0);
  });

  it('ชนกัน → ยอดสูงกว่าได้แสดง ยอดต่ำกว่าถูกซ่อน (ไม่ขึ้นกับลำดับที่ส่งมา)', () => {
    const items: LabelItem[] = [{ id: 'low', total: 100, cands: [box(10, 5)] }, { id: 'high', total: 9000, cands: [box(0, 0)] }];
    expect([...declutter(items).hidden]).toEqual(['low']);
    expect([...declutter([...items].reverse()).hidden]).toEqual(['low']);
  });

  it('ตำแหน่งปกติไม่ว่าง → เลื่อนไปตำแหน่งถัดไปที่ว่าง', () => {
    const r = declutter([
      { id: 'big', total: 9000, cands: [box(0, 0)] },
      { id: 'small', total: 10, cands: [box(20, 2), box(30, 4), box(0, 60)] },
    ]);
    expect(r.hidden.size).toBe(0);
    expect(r.moved.get('small')).toBe(2);
  });

  it('สิ่งกีดขวางตายตัว (จุด/ชื่อ/เส้นที่ปัก) แสดงเสมอและบังป้ายยอดสูงได้', () => {
    const r = declutter([
      { id: 'pin1', total: 1, fixed: true, cands: [box(0, 0)] },
      { id: 'pin2', total: 2, fixed: true, cands: [box(5, 5)] },
      { id: 'huge', total: 1e9, cands: [box(10, 3)] },
    ]);
    expect([...r.hidden]).toEqual(['huge']);
  });

  it('rank น้อยวางก่อนแม้ยอดน้อยกว่า (สายแม่-ลูกของ Organization ก่อนเส้นโค้งข้าม)', () => {
    const r = declutter([{ id: 'flat', total: 9000, rank: 1, cands: [box(0, 0)] }, { id: 'tree', total: 5, cands: [box(4, 4)] }]);
    expect([...r.hidden]).toEqual(['flat']);
  });

  it('ป้ายจำนวนมากแบบสุ่ม: ป้ายที่แสดง (ตามตำแหน่งที่เลือก) ไม่ชนกันเลย และไม่ชนสิ่งกีดขวาง', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const items: LabelItem[] = [];
    for (let i = 0; i < 40; i++) items.push({ id: 'n' + i, total: 0, fixed: true, cands: [box(rnd() * 1500, rnd() * 900, 30, 30)] });
    for (let i = 0; i < 600; i++) {
      const x = rnd() * 1500;
      const y = rnd() * 900;
      items.push({ id: 'e' + i, total: Math.round(rnd() * 1e6), cands: LABEL_SLIDE.map((_, k) => box(x + k * 25, y + k * 9, 60 + rnd() * 60, 14)) });
    }
    const { hidden, moved } = declutter(items);
    const shown = items.filter((it) => !hidden.has(it.id)).map((it) => ({ fixed: !!it.fixed, b: it.cands[moved.get(it.id) ?? 0]! }));
    let bad = 0;
    // สิ่งกีดขวางตายตัวสองชิ้นทับกันเองได้ (สุ่มวาง) — นับเฉพาะคู่ที่มีป้ายยอดเงิน
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) if (!(shown[i]!.fixed && shown[j]!.fixed) && hit(shown[i]!.b, shown[j]!.b)) bad++;
    expect(bad).toBe(0);
    expect(hidden.size).toBeGreaterThan(0);
    expect(shown.length).toBeGreaterThan(100);
  });

  it('ข้ามกรอบที่วัดไม่ได้ (ป้ายว่าง/ไม่มีขนาด) โดยไม่ซ่อน', () => {
    const r = declutter([{ id: 'empty', total: 1, cands: [{ x1: 5, y1: 5, x2: 5, y2: 5 }] }, { id: 'ok', total: 2, cands: [box(0, 0)] }]);
    expect(r.hidden.size).toBe(0);
  });
});

describe('edgePath', () => {
  it('เส้นตรง: จุดกึ่งกลางและความยาว', () => {
    const p = edgePath({ x: 0, y: 0 }, { x: 300, y: 400 });
    expect(p.length).toBeCloseTo(500, 6);
    expect(p.at(0.5).p).toEqual({ x: 150, y: 200 });
    expect(p.at(0.26).dist).toBeCloseTo(130, 6);
  });

  it('โค้งสมมาตร (จุดควบคุมเดียว): กึ่งกลางความยาวอยู่ที่ยอดโค้ง และยาวกว่าเส้นตรง', () => {
    const p = edgePath({ x: 0, y: 0 }, { x: 200, y: 0 }, [{ x: 100, y: -100 }]);
    const m = p.at(0.5).p;
    expect(m.x).toBeCloseTo(100, 0);
    expect(m.y).toBeCloseTo(-50, 0);
    expect(p.length).toBeGreaterThan(200);
    // สองข้างของยอดโค้งสมมาตรกัน
    expect(p.at(0.36).p.x + p.at(0.64).p.x).toBeCloseTo(200, 0);
  });
});

describe('Organization: ป้ายที่ปลายล่างของเส้น', () => {
  const end = (id: string, lower: string, up: boolean, total: number, card = false, width = 2): OrgLabelEnd => ({ id, lower, up, total, lines: card ? 3 : 1, card, width });

  it('เส้นที่ลงบัญชีเดียวกันซ้อนขั้นขึ้นไป ไม่ทับกัน — เส้นขึ้นอยู่ล่างสุด, เส้นลงพ้นหัวลูกศร', () => {
    for (const card of [false, true]) {
      const ends = [end('down-small', 'C', false, 10, card), end('down-big', 'C', false, 900, card, 8), end('up', 'C', true, 50, card), end('other', 'D', false, 5, card)];
      const off = orgLabelOffsets(ends);
      expect(off.get('up')!).toBeLessThan(off.get('down-big')!);
      expect(off.get('down-big')!).toBeLessThan(off.get('down-small')!);
      const h = orgLabelHeight(card ? 3 : 1, card);
      const order = ['up', 'down-big', 'down-small'].map((id) => off.get(id)!);
      for (let i = 1; i < order.length; i++) expect(order[i]! - order[i - 1]!).toBeGreaterThanOrEqual(h);
      // ป้ายแรกไม่ชิดขอบจุด และบัญชีอื่นเริ่มนับใหม่
      expect(off.get('up')! - h / 2).toBeGreaterThanOrEqual(5);
      expect(off.get('other')!).toBeLessThan(off.get('down-small')!);
      // เส้นลงเส้นเดียว: ป้ายอยู่เหนือหัวลูกศร (หัวลูกศรของเส้นกว้างยาวขึ้น)
      const lone = orgLabelOffsets([end('thin', 'X', false, 1, card, 1), end('thick', 'Y', false, 1, card, 10)]);
      expect(lone.get('thick')!).toBeGreaterThan(lone.get('thin')!);
    }
  });

  it('คอลัมน์ของลูกแต่ละรายกว้างพอให้ป้ายยอดเงินเหนือลูกไม่ชนกัน (เจ้าของ 1 ราย + ลูก 30 ราย ป้ายชื่อสั้น)', () => {
    const ns: LNode[] = [{ id: 'O', role: 'owner', size: 60, label: 'เจ้าของ', fs: 13, tw: 140, ring: 0 }];
    const es: LEdge[] = [];
    for (let i = 0; i < 30; i++) {
      ns.push({ id: 'C' + i, role: 'plain', size: 18, label: 'X' + i, fs: 9.5 });
      const label = `${(123456.78 + i).toLocaleString('en-US', { minimumFractionDigits: 2 })} ฿ ×${i + 1}`;
      es.push({ source: 'O', target: 'C' + i, total: 1000 + i, labelW: edgeLabelWidth(label, `${label}\n${i + 1} รายการ\n1 ม.ค. 2567 – 31 ธ.ค. 2567`) });
    }
    const { pos } = orgPositions(ns, es);
    const xs = ns.slice(1).map((n) => pos[n.id]!.x).sort((a, b) => a - b);
    const need = Math.max(...es.map((e) => e.labelW!));
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(need);
    // ไม่มี labelW → ใช้ความกว้างจุด+ชื่อเดิม (แคบกว่า)
    const plain = orgPositions(ns, es.map(({ labelW: _w, ...e }) => e)).pos;
    expect(Math.abs(plain.C1!.x - plain.C0!.x)).toBeLessThan(need);
  });

  it('ความกว้างข้อความ: สระ/วรรณยุกต์บน-ล่างไม่กินที่ และการ์ดใช้บรรทัดยาวสุด', () => {
    expect(labelTextWidth('ที่', 10)).toBeCloseTo(labelTextWidth('ท', 10), 6);
    expect(edgeLabelWidth('1 ฿', 'สั้น\nบรรทัดที่ยาวกว่ามาก ๆ ๆ')).toBeGreaterThan(edgeLabelWidth('1 ฿'));
    expect(edgeLabelWidth()).toBe(0);
  });
});
