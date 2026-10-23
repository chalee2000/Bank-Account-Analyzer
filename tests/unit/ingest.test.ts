import { describe, it, expect } from 'vitest';
import { readCsv } from '../../src/ingest/csv';
import { detectMapping, suggestOwner, findHeader } from '../../src/ingest/detectColumns';
import { parseRows } from '../../src/ingest/parseRows';
import { consolidate, type FileRows } from '../../src/ingest/consolidate';
import { DEFAULT_SETTINGS } from '../../src/core/types';
import { sha256Hex, _sha256Js } from '../../src/ingest/hash';

const enc = (s: string) => new TextEncoder().encode(s);

const CSV_A = `ชื่อบัญชี: นายเอ ทดสอบ
เลขที่บัญชี: 111-1-11111-1
ธนาคารกสิกรไทย
ระหว่างวันที่ 01/03/2567 ถึง 31/03/2567

วันที่,เวลา,รายการ,ถอน,ฝาก,ยอดคงเหลือ,ช่องทาง
ยอดยกมา,,,,,"100,000.00",
05/03/2567,09:00,โอนเงินไป ไทยพาณิชย์ 222-2-22222-2 นายบี ทดสอบ,"20,000.00",,"80,000.00",K PLUS
05/03/2567,09:30,ถอนเงินสด,"5,000.00",,"75,000.00",ATM
06/03/2567,10:15,รับโอนจาก ไทยพาณิชย์ 222-2-22222-2 นายบี ทดสอบ,,"1,000.00","76,000.00",K PLUS
`;

describe('csv + detect + parse', () => {
  const table = readCsv(enc(CSV_A));
  it('พบหัวตารางหลังหัวเอกสาร', () => {
    const h = findHeader(table.rows);
    expect(h?.headerRow).toBe(5);
    expect(h?.fields.withdrawal).toBe(3);
    expect(h?.fields.deposit).toBe(4);
  });
  it('เดาเจ้าของ statement จากหัวเอกสาร', () => {
    const m = detectMapping(table);
    const o = suggestOwner(table.rows, m.headerRow);
    expect(o).toMatchObject({ number: '1111111111', name: 'นายเอ ทดสอบ', bank: 'KBANK' });
  });
  it('parse ถูกต้อง ทิศทาง ยอด ชนิด และตรวจ balance', () => {
    const m = detectMapping(table);
    expect(m.amountMode).toBe('two-columns');
    const res = parseRows(table, m, 'f1');
    expect(res.stats.openingBalance).toBe(100000);
    expect(res.rows).toHaveLength(3);
    const [r1, r2, r3] = res.rows;
    expect(r1).toMatchObject({ direction: 'out', amount: 20000, kind: 'transfer', hasTime: true });
    expect(r1!.cp).toMatchObject({ number: '2222222222', bank: 'SCB', inferred: true });
    expect(r2).toMatchObject({ direction: 'out', amount: 5000, kind: 'cash_withdrawal' });
    expect(r3).toMatchObject({ direction: 'in', amount: 1000 });
    expect(res.stats.balanceChecked).toBe(3);
    expect(res.stats.balanceMismatches).toBe(0);
  });
});

describe('ลำดับเวลา / ยอดไม่ต่อเนื่อง / เดาทิศทางจากยอดคงเหลือ', () => {
  it('ไฟล์เรียงใหม่→เก่า ถูกจัดเรียงและ seq เป็นลำดับเวลา', () => {
    const csv = `วันที่,รายการ,จำนวนเงิน,ยอดคงเหลือ
07/03/2567,โอน,300.00,"1,000.00"
06/03/2567,โอน,200.00,"700.00"
05/03/2567,โอน,500.00,"900.00"`;
    const t = readCsv(enc(csv));
    const m = detectMapping(t);
    expect(m.amountMode).toBe('signed');
    const res = parseRows(t, m, 'f');
    expect(res.stats.descendingInput).toBe(true);
    // ไม่มีเครื่องหมายและไม่มีคำบอกทิศทาง แต่ยอดคงเหลือแถวที่ 2 เทียบกับแถวที่ 1 ได้ → ทิศทางแถว 1 ไม่รู้ (ไม่มียอดยกมา)
    const dirs = res.rows.map((r) => r.direction);
    expect(res.rows.map((r) => r.amount)).toEqual([200, 300]); // แถวแรก (05/03) ระบุทิศทางไม่ได้ → ถูกข้ามพร้อมเหตุผล
    expect(dirs).toEqual(['out', 'in']);
    expect(res.stats.skipped.some((s) => s.reason.includes('ทิศทาง'))).toBe(true);
  });
  it('ตรวจพบยอดคงเหลือไม่ต่อเนื่อง', () => {
    const csv = `วันที่,ถอน,ฝาก,ยอดคงเหลือ
05/03/2567,100.00,,900.00
06/03/2567,100.00,,500.00`;
    const res = parseRows(readCsv(enc(csv)), detectMapping(readCsv(enc(csv))), 'f');
    expect(res.stats.balanceMismatches).toBe(1);
    expect(res.rows[1]!.flags).toContain('balance_mismatch');
  });
  it('คอลัมน์เดียว + Dr/Cr', () => {
    const csv = `Date,Description,Amount,Dr/Cr,Balance
05/03/2024,Transfer,"1,000.00",DR,"9,000.00"
06/03/2024,Deposit,"500.00",CR,"9,500.00"`;
    const t = readCsv(enc(csv));
    const m = detectMapping(t);
    expect(m.amountMode).toBe('drcr-column');
    const res = parseRows(t, m, 'f');
    expect(res.rows.map((r) => r.direction)).toEqual(['out', 'in']);
  });
  it('บรรทัดต่อของรายละเอียดถูกรวมเข้ารายการก่อนหน้า', () => {
    const csv = `วันที่,รายการ,ถอน,ฝาก
05/03/2567,โอนเงินไป,"1,000.00",
,กสิกรไทย 123-4-56789-0,,`;
    const t = readCsv(enc(csv));
    const res = parseRows(t, detectMapping(t), 'f');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.description).toContain('กสิกรไทย');
    expect(res.rows[0]!.cp.number).toBe('1234567890');
  });
  it('ไม่มีเวลา → hasTime=false และมีคำเตือน', () => {
    const csv = `วันที่,ถอน,ฝาก\n05/03/2567,100.00,\n06/03/2567,,50.00`;
    const t = readCsv(enc(csv));
    const res = parseRows(t, detectMapping(t), 'f');
    expect(res.rows.every((r) => !r.hasTime)).toBe(true);
    expect(res.stats.warnings.join(' ')).toContain('ไม่มีเวลา');
  });
});

describe('consolidate: mirror / dedupe / unify', () => {
  const mkFile = (fileId: string, bank: string, number: string, name: string, csv: string): FileRows => {
    const t = readCsv(enc(csv));
    return { fileId, owner: { bank, number, name }, rows: parseRows(t, detectMapping(t), fileId).rows };
  };
  const A = mkFile('fa', 'KBANK', '1111111111', 'นายเอ',
`วันที่,เวลา,รายการ,ถอน,ฝาก,ยอดคงเหลือ
05/03/2567,09:00,โอนเงินไป ไทยพาณิชย์ 222-2-22222-2 นายบี,"20,000.00",,"80,000.00"
05/03/2567,12:00,ถอนเงินสด ATM,"1,000.00",,"79,000.00"`);
  const B = mkFile('fb', 'SCB', '2222222222', 'นายบี',
`วันที่,เวลา,รายการ,ถอน,ฝาก,ยอดคงเหลือ
05/03/2567,09:01,รับโอนจาก กสิกรไทย xxx-x-x1111-x,,"20,000.00","20,000.00"
05/03/2567,09:20,โอนเงินไป กรุงไทย 333-3-33333-3 นายซี,"19,500.00",,500.00`);

  it('รายการ A→B ปรากฏสองฝั่ง ถูกรวมเป็นรายการเดียว (mirror)', () => {
    const r = consolidate([A, B], [], DEFAULT_SETTINGS);
    expect(r.mirrorsMerged).toBe(1);
    const t = r.txns.find((x) => x.mirrored)!;
    expect(t.from).toBe('KBANK:1111111111');
    expect(t.to).toBe('SCB:2222222222');
    expect(t.amount).toBe(20000);
    expect(t.sources).toHaveLength(2);
    // เลขของ A ที่ถูกปิดบัง xxx-x-x1111-x เทียบกับเลขเต็มของ A → inferred
    expect(t.inferred).toBe(true);
    // 4 แถว − 1 mirror = 3 ธุรกรรม
    expect(r.txns).toHaveLength(3);
  });
  it('เงินสดและคู่บัญชีที่ไม่ใช่เจ้าของ statement ได้ node เฉพาะ', () => {
    const r = consolidate([A, B], [], DEFAULT_SETTINGS);
    const cash = r.txns.find((x) => x.kind === 'cash_withdrawal')!;
    expect(cash.to).toBe('cash:KBANK:1111111111');
    expect(r.accounts['cash:KBANK:1111111111']!.kind).toBe('cash');
    expect(r.accounts['KBANK:1111111111']!.hasStatement).toBe(true);
    expect(r.accounts['KTB:3333333333']!.hasStatement).toBe(false);
  });
  it('ไฟล์ statement ซ้อนทับกันของบัญชีเดียวกัน → ลบรายการซ้ำ', () => {
    const A2 = { ...A, fileId: 'fa2', rows: A.rows.map((r) => ({ ...r, fileId: 'fa2' })) };
    const r = consolidate([A, A2], [], DEFAULT_SETTINGS);
    expect(r.duplicatesByFile['fa2']).toBe(2);
    expect(r.txns).toHaveLength(2);
  });
  it('รายการเหมือนกันสองรายการในไฟล์เดียวกันไม่ถูกลบ', () => {
    const dup = mkFile('fd', 'KBANK', '1111111111', 'นายเอ',
`วันที่,เวลา,รายการ,ถอน,ฝาก
05/03/2567,09:00,โอนเงินไป ไทยพาณิชย์ 222-2-22222-2,"100.00",
05/03/2567,09:00,โอนเงินไป ไทยพาณิชย์ 222-2-22222-2,"100.00",`);
    expect(consolidate([dup], [], DEFAULT_SETTINGS).txns).toHaveLength(2);
  });
  it('เลขบัญชีเต็มที่ไม่ระบุธนาคาร (?:) ถูกรวมกับ ธนาคาร:เลข เมื่อไม่กำกวม', () => {
    const C = mkFile('fc', 'KTB', '3333333333', 'นายซี',
`วันที่,เวลา,รายการ,ถอน,ฝาก
05/03/2567,09:21,รับโอนจาก 222-2-22222-2,,"19,500.00"`);
    const r = consolidate([B, C], [], DEFAULT_SETTINGS);
    expect(r.mirrorsMerged).toBe(1);
    const ids = Object.keys(r.accounts).filter((i) => i.includes('2222222222'));
    expect(ids).toEqual(['SCB:2222222222']);
  });
  it('เลขปิดบางส่วนไม่ถูกรวมอัตโนมัติ แต่แนะนำให้ผู้ใช้ยืนยัน', () => {
    const X = mkFile('fx', 'SCB', '9999999999', 'นายเอ็กซ์',
`วันที่,เวลา,รายการ,ถอน,ฝาก
05/03/2567,10:00,โอนเงินไป กสิกรไทย xxx-x-x1111-x,"300.00",`);
    const r = consolidate([A, X], [], DEFAULT_SETTINGS);
    expect(r.accounts['KBANK:XXXXX1111X']).toBeDefined();
    expect(r.accounts['KBANK:1111111111']).toBeDefined();
    expect(r.aliasSuggestions.some((s) => [s.a, s.b].includes('KBANK:XXXXX1111X'))).toBe(true);
  });
  it('alias ที่ผู้ใช้ยืนยันถูกนำไปใช้', () => {
    const X = mkFile('fx', 'SCB', '9999999999', 'นายเอ็กซ์',
`วันที่,เวลา,รายการ,ถอน,ฝาก
05/03/2567,10:00,โอนเงินไป กสิกรไทย xxx-x-x1111-x,"300.00",`);
    const r = consolidate([A, X], [{ id: 'g', members: ['KBANK:1111111111', 'KBANK:XXXXX1111X'] }], DEFAULT_SETTINGS);
    expect(r.accounts['KBANK:XXXXX1111X']).toBeUndefined();
    expect(r.txns.some((t) => t.from === 'SCB:9999999999' && t.to === 'KBANK:1111111111')).toBe(true);
  });
});

describe('sha256', () => {
  it('ตรงกับ crypto.subtle และค่ามาตรฐาน', async () => {
    const abc = enc('abc');
    expect(await sha256Hex(abc)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(_sha256Js(abc)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const big = new Uint8Array(1000).map((_, i) => i % 251);
    expect(_sha256Js(big)).toBe(await sha256Hex(big));
  });
});

describe('consolidate: จับคู่สองฝั่งเมื่ออ่านคู่บัญชีฝั่งหนึ่งไม่ได้ (เช่น OCR เพี้ยน)', () => {
  const mk = (fileId: string, bank: string, number: string, csv: string): FileRows => {
    const t = readCsv(enc(csv));
    return { fileId, owner: { bank, number, name: fileId }, rows: parseRows(t, detectMapping(t), fileId).rows };
  };
  const A = mk('fa', 'KBANK', '1111111111', `วันที่,เวลา,รายการ,ถอน,ฝาก
05/03/2567,09:00,โอนเงินไป ไทยพาณิชย์ 222-2-22222-2,"20,000.00",`);
  it('ฝั่งรับอ่านเลขบัญชีไม่ได้ แต่ยอดและเวลาตรงและเป็นคู่เดียว → รวมเป็นรายการเดียว และติดธง', () => {
    const B = mk('fb', 'SCB', '2222222222', `วันที่,เวลา,รายการ,ถอน,ฝาก
05/03/2567,09:01,รับโอนจาก >๐๐๓%->8888-% นา ย เอก,,"20,000.00"`);
    const r = consolidate([A, B], [], DEFAULT_SETTINGS);
    expect(r.txns).toHaveLength(1);
    expect(r.txns[0]).toMatchObject({ mirrored: true, inferred: true, from: 'KBANK:1111111111', to: 'SCB:2222222222' });
    expect(r.txns[0]!.flags).toContain('mirror_inferred');
  });
  it('มีผู้สมัครมากกว่าหนึ่งราย (กำกวม) → ไม่รวมอัตโนมัติ', () => {
    const B = mk('fb', 'SCB', '2222222222', `วันที่,เวลา,รายการ,ถอน,ฝาก
05/03/2567,09:01,รับโอนจาก ???,,"20,000.00"`);
    const C = mk('fc', 'BBL', '3333333333', `วันที่,เวลา,รายการ,ถอน,ฝาก
05/03/2567,09:02,รับโอนจาก ???,,"20,000.00"`);
    const A2 = mk('fa2', 'KBANK', '1111111111', `วันที่,เวลา,รายการ,ถอน,ฝาก
05/03/2567,09:00,โอนเงินไป ???,"20,000.00",`);
    const r = consolidate([A2, B, C], [], DEFAULT_SETTINGS);
    expect(r.txns.filter((t) => t.mirrored)).toHaveLength(0);
    expect(r.txns).toHaveLength(3);
  });
  it('ยอดต่างกันเพียงเล็กน้อย → ไม่รวม', () => {
    const B = mk('fb', 'SCB', '2222222222', `วันที่,เวลา,รายการ,ถอน,ฝาก
05/03/2567,09:01,รับโอนจาก ???,,"19,999.00"`);
    expect(consolidate([A, B], [], DEFAULT_SETTINGS).txns.filter((t) => t.mirrored)).toHaveLength(0);
  });
});

describe('แถวข้อมูลที่มีคำคล้ายหัวตารางไม่ถูกข้ามผิดพลาด', () => {
  it('แถวที่มีวันที่/ยอดเงินเป็นข้อมูลจริง แม้ข้อความมีคำว่า ถอน/ATM/ฝาก', () => {
    const csv = `วันที่,รายการ,สถานที่,ถอน,ฝาก,ยอดคงเหลือ
05/03/2567,ถอนเงินสด ATM,ATM ฝาก สาขา,"1,000.00",,"9,000.00"
04/03/2567,ฝากเงินสด,ATM ถอน,,"500.00","10,000.00"`;
    const t = readCsv(enc(csv));
    const res = parseRows(t, detectMapping(t), 'f');
    expect(res.rows).toHaveLength(2);
    expect(res.stats.skipped).toEqual([]);
  });
  it('หัวตารางที่ซ้ำข้ามหน้ายังถูกข้าม', () => {
    const csv = `วันที่,รายการ,ถอน,ฝาก,ยอดคงเหลือ
05/03/2567,โอน,100.00,,900.00
วันที่,รายการ,ถอน,ฝาก,ยอดคงเหลือ
06/03/2567,โอน,100.00,,800.00`;
    const t = readCsv(enc(csv));
    const res = parseRows(t, detectMapping(t), 'f');
    expect(res.rows).toHaveLength(2);
    expect(res.stats.skipped.map((s) => s.reason)).toEqual(['แถวหัวตารางซ้ำ (ข้ามหน้า)']);
  });
});
