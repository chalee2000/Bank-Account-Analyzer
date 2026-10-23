import { describe, it, expect } from 'vitest';
import { tableFromItems, type TextItem } from '../../src/ingest/tableFromItems';
import { detectMapping, suggestOwner } from '../../src/ingest/detectColumns';
import { parseRows } from '../../src/ingest/parseRows';

const CH = 6; // กว้างต่อตัวอักษร
function item(str: string, x: number, y: number, page = 1, rightAlign = false, conf?: number): TextItem {
  const w = str.length * CH;
  return { str, x: rightAlign ? x - w : x, y, w, h: 10, page, conf };
}

/** จำลองหน้าเอกสาร statement: หัวเอกสาร + หัวตาราง + 3 แถว */
function page(p: number, startY: number, rows: string[][], withPreface: boolean): TextItem[] {
  const out: TextItem[] = [];
  let y = startY;
  if (withPreface) {
    out.push(item('ชื่อบัญชี นายเอ ทดสอบ', 30, y, p)); y += 14;
    out.push(item('เลขที่บัญชี 111-1-11111-1', 30, y, p)); y += 14;
    out.push(item('ธนาคารกสิกรไทย', 30, y, p)); y += 20;
  } else {
    out.push(item('เลขที่บัญชี 111-1-11111-1 หน้า', 30, y, p)); y += 20;
  }
  // หัวตาราง (ทุกหน้า)
  const hdr = ['วันที่', 'เวลา', 'รายการ', 'ถอน', 'ฝาก', 'ยอดคงเหลือ'];
  out.push(item(hdr[0]!, 30, y, p), item(hdr[1]!, 100, y, p), item(hdr[2]!, 160, y, p),
    item(hdr[3]!, 520, y, p, true), item(hdr[4]!, 610, y, p, true), item(hdr[5]!, 710, y, p, true));
  y += 14;
  for (const r of rows) {
    out.push(item(r[0]!, 30, y, p), item(r[1]!, 100, y, p), item(r[2]!, 160, y, p));
    if (r[3]) out.push(item(r[3]!, 520, y, p, true));
    if (r[4]) out.push(item(r[4]!, 610, y, p, true));
    out.push(item(r[5]!, 710, y, p, true));
    y += 14;
  }
  return out;
}

describe('tableFromItems', () => {
  const items = [
    ...page(1, 40, [
      ['05/03/2567', '09:00', 'โอนเงินไป ไทยพาณิชย์ 222-2-22222-2 นายบี', '20,000.00', '', '80,000.00'],
      ['05/03/2567', '09:30', 'ถอนเงินสด ATM', '5,000.00', '', '75,000.00'],
    ], true),
    ...page(2, 40, [
      ['06/03/2567', '10:15', 'รับโอนจาก ไทยพาณิชย์ 222-2-22222-2', '', '1,000.00', '76,000.00'],
    ], false),
  ];
  const { table, headerFound, pages } = tableFromItems(items, 'pdf-text');

  it('พบหัวตารางและ 2 หน้า', () => {
    expect(headerFound).toBe(true);
    expect(pages).toBe(2);
  });
  it('หัวเอกสารถูกเก็บไว้ก่อนหัวตาราง และใช้เดาเจ้าของ statement ได้', () => {
    const m = detectMapping(table);
    const o = suggestOwner(table.rows, m.headerRow);
    expect(o.number).toBe('1111111111');
    expect(o.name).toBe('นายเอ ทดสอบ');
    expect(o.bank).toBe('KBANK');
  });
  it('แบ่งคอลัมน์ถูกต้อง รวมหลายหน้า ตัดหัวตารางซ้ำและส่วนหัวของหน้า 2', () => {
    const m = detectMapping(table);
    const res = parseRows(table, m, 'pdf');
    expect(res.rows).toHaveLength(3);
    expect(res.rows.map((r) => [r.direction, r.amount])).toEqual([['out', 20000], ['out', 5000], ['in', 1000]]);
    expect(res.rows[0]!.cp).toMatchObject({ number: '2222222222', bank: 'SCB' });
    // บรรทัด "เลขที่บัญชี ... หน้า" ของหน้า 2 ต้องไม่ถูกต่อเข้ากับรายการหน้า 1
    expect(res.rows[1]!.description).not.toContain('111-1-11111-1');
    expect(res.stats.balanceMismatches).toBe(0);
  });
  it('ส่งต่อค่าความมั่นใจ OCR ต่อเซลล์', () => {
    const its = page(1, 40, [['05/03/2567', '09:00', 'โอน', '100.00', '', '900.00']], false).map((i) =>
      i.str === '100.00' ? { ...i, conf: 41 } : { ...i, conf: 95 });
    const r = tableFromItems(its, 'pdf-ocr');
    const m = detectMapping(r.table);
    const res = parseRows(r.table, m, 'ocr');
    expect(res.rows[0]!.minConfidence).toBe(41);
    expect(res.rows[0]!.flags).toContain('low_ocr_confidence');
  });
});
