// ทดสอบการอ่าน statement ตามรูปแบบจริงของ กสิกรไทย / ไฟล์ส่งออกมาตรฐาน (SCB) / ธ.ก.ส. / กรุงไทย
// ใช้ไฟล์สังเคราะห์ที่จำลองโครงสร้างและความแปลกของไฟล์จริง (ดู tests/helpers/bankSamples.ts)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readStatementFile } from '../../src/ingest';
import { inspectTable, pickBestTable } from '../../src/ingest/detectColumns';
import { parseRows } from '../../src/ingest/parseRows';
import { parseBaacDetails } from '../../src/ingest/details';
import { consolidate } from '../../src/ingest/consolidate';
import { bankFromBotCode, bankFromCell, normalizeAccountForBank, normalizeBank } from '../../src/core/normalize';
import { DEFAULT_SETTINGS } from '../../src/core/types';
import { baacLikeFile, kbankLikeFile, ktbLikeFile, stdExportLikeFile, stdOps } from '../helpers/bankSamples';

async function run(file: File, password?: string) {
  const res = await readStatementFile(file, { password });
  const idx = pickBestTable(res.tables);
  const table = res.tables[idx]!;
  const { mapping, owner } = inspectTable(table);
  return { res, idx, table, mapping, owner, parsed: parseRows(table, mapping, 'f_test') };
}

describe('กสิกรไทย (ต้นทาง/ปลายทาง + ถอน/ฝาก)', () => {
  it('ตรวจรูปแบบ เจ้าของบัญชี และอ่านทุกแถวถูกทิศ', async () => {
    const { mapping, owner, parsed } = await run(await kbankLikeFile());
    expect(mapping.format).toBe('from-to-statement');
    expect(owner).toMatchObject({ bank: 'KBANK', number: '1112333334', name: 'นาย ทดสอบ ระบบ' });
    expect(owner.meta?.['ประเภทบัญชี']).toBe('เงินฝากออมทรัพย์');
    expect(owner.period).toContain('01/01/2568');

    // แถว "เปิดบัญชี" ยอด 0 ถูกข้ามพร้อมเหตุผลที่ชัด ไม่นับเป็นข้อผิดพลาด
    expect(parsed.stats.skipped).toHaveLength(1);
    expect(parsed.stats.skipped[0]!.reason).toContain('0 บาท');
    expect(parsed.rows.map((r) => [r.direction, r.amount, r.kind])).toEqual([
      ['in', 2000, 'cash_deposit'], ['in', 150, 'transfer'], ['in', 60, 'transfer'],
      ['out', 700, 'transfer'], ['out', 300, 'cash_withdrawal'], ['in', 0.75, 'interest'],
    ]);
    expect(parsed.rows.every((r) => r.directionSource === 'column')).toBe(true);
    expect(parsed.stats.balanceMismatches).toBe(0);
    expect(parsed.stats.balanceChecked).toBe(6);
  });

  it('คู่บัญชี: ขาเข้าใช้ฝั่งต้นทาง ขาออกใช้ฝั่งปลายทาง (ธนาคารจากชื่อ)', async () => {
    const { parsed } = await run(await kbankLikeFile());
    const [, inSCB, qr, outBBL] = parsed.rows;
    expect(inSCB!.cp).toMatchObject({ bank: 'SCB', number: '5099988877', name: 'นางสาว สมหญิง ตัวอย่าง', inferred: false });
    expect(qr!.cp.number).toBeUndefined(); // QR ร้านค้า ไม่มีข้อมูลผู้จ่าย
    expect(outBBL!.cp).toMatchObject({ bank: 'BBL', number: '7011122233', inferred: false });
  });

  it('เก็บหลักฐานเสริม (IP พิกัด รหัสตู้) และตัดพิกัด 0,0 ทิ้ง', async () => {
    const { parsed } = await run(await kbankLikeFile());
    const out = parsed.rows[3]!;
    expect(out.extra).toMatchObject({ ip: '203.0.113.17', lat: '13.75000000', lng: '100.50000000', teller: 'T0000004', branch: '0004' });
    const atm = parsed.rows[4]!;
    expect(atm.extra).toMatchObject({ atmId: 'T0000042', atmBank: 'กสิกรไทย' });
    expect(atm.extra?.lat).toBeUndefined();
  });
});

describe('ไฟล์ส่งออกมาตรฐาน (SCB)', () => {
  it('เลือกชีตข้อมูล ไม่ใช่ชีตข้อความดิบที่ตัวอักษรเพี้ยน', async () => {
    const { res, idx, mapping, owner } = await run(await stdExportLikeFile());
    expect(res.tables).toHaveLength(2);
    expect(idx).toBe(0);
    expect(mapping.format).toBe('std-export');
    expect(owner).toMatchObject({ bank: 'SCB', number: '4012345678', name: 'นางสาว ทดสอบ ตัวอย่าง' });
    expect(owner.meta?.['เลขที่หนังสือขอข้อมูล']).toBe('10001');
  });

  it('เติม 0 นำหน้าเลขบัญชีที่ Excel ตัด และรู้ธนาคารจากรหัสตัวเลข', async () => {
    const { parsed } = await run(await stdExportLikeFile());
    const inbound = parsed.rows.find((r) => r.direction === 'in' && r.kind === 'transfer')!;
    expect(inbound.cp).toMatchObject({ bank: 'GSB', number: '020123456789' }); // 20123456789 (11 หลัก) → 12 หลักของออมสิน
    const outbound = parsed.rows.find((r) => r.direction === 'out' && r.kind === 'transfer')!;
    expect(outbound.cp).toMatchObject({ bank: 'SCB', number: '5111222333', name: 'นาย ปลายทาง ตัวอย่าง' });
    expect(parsed.stats.notes.join(' ')).toContain('เติมเลข 0 นำหน้า');
  });

  it('จัดประเภทรายการ: ถอน/ฝากเงินสด และ "อื่นๆ" ไม่นับเป็นถอนเงินสด', async () => {
    const { parsed } = await run(await stdExportLikeFile());
    const ops = stdOps();
    const count = (k: string) => ops.filter((o) => o.kind === k).length;
    expect(parsed.rows).toHaveLength(ops.length);
    expect(parsed.rows.filter((r) => r.kind === 'cash_withdrawal')).toHaveLength(count('atm'));
    expect(parsed.rows.filter((r) => r.kind === 'cash_deposit')).toHaveLength(count('dep'));
    expect(parsed.rows.filter((r) => r.kind === 'other')).toHaveLength(count('fee'));
    expect(parsed.rows.find((r) => r.kind === 'cash_withdrawal')!.extra).toMatchObject({ atmId: 'M0001', atmBank: 'กสิกรไทย' });
    expect(parsed.rows.find((r) => r.direction === 'out' && r.kind === 'transfer')!.extra?.ip).toBe('203.0.113.45');
  });

  it('ยอดปัดบาทเต็ม: ไม่ฟ้องยอดคงเหลือไม่ต่อเนื่องเมื่อคลาดไม่เกิน 0.50 และแจ้งเป็นหมายเหตุ', async () => {
    const { parsed } = await run(await stdExportLikeFile());
    expect(parsed.stats.balanceChecked).toBeGreaterThan(50);
    expect(parsed.stats.balanceMismatches).toBe(0);
    expect(parsed.stats.notes.join(' ')).toContain('บาทเต็ม');
  });

  it('แถวสลับลำดับในไฟล์: จัดเรียงตามเวลาแล้วยอดคงเหลือต้องต่อเนื่อง', async () => {
    const { parsed } = await run(await stdExportLikeFile({ shuffle: true }));
    const ts = parsed.rows.map((r) => r.ts);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(parsed.stats.balanceMismatches).toBe(0);
  });

  it('ยอดที่ไม่ปัด (มีเศษสตางค์) ต้องตรงทุกสตางค์ ไม่ผ่อนเกณฑ์', async () => {
    // ไฟล์ที่จำนวนเงินมีสตางค์ ไม่ใช่เคสปัดบาทเต็ม — ตรวจผ่านการอ่าน kbank ที่ยอด 0.75 ตรงเป๊ะ
    const { parsed } = await run(await kbankLikeFile());
    expect(parsed.stats.notes.join(' ')).not.toContain('บาทเต็ม');
  });
});

describe('ธ.ก.ส. (จำนวนเงินคอลัมน์เดียว ทิศทางดูจากยอดคงเหลือ)', () => {
  it('อ่านหัวเอกสารที่เซลล์ merge: ชื่อไม่ปนที่อยู่ และเก็บข้อมูลบัญชีเป็น meta', async () => {
    const { mapping, owner } = await run(await baacLikeFile());
    expect(mapping.format).toBe('baac-detail');
    expect(owner).toMatchObject({ bank: 'BAAC', number: '011122233344', name: 'นายทดสอบ ตัวอย่าง' });
    expect(owner.meta).toMatchObject({ 'สาขา': '0000 - สาขาตัวอย่าง', 'สถานะบัญชี': 'A - บัญชีใช้งานปกติ', 'วันที่เปิดบัญชี': '01/01/2550', 'เลขประจำตัว (ID)': '1234567890123' });
    expect(owner.meta?.['วันที่ปิดบัญชี']).toBeUndefined(); // "-" = ไม่มีค่า
    expect(owner.meta?.['ที่อยู่']).toContain('99/9');
  });

  it('ปี พ.ศ. ใน Date จริง, ทิศทางจากส่วนต่างยอดคงเหลือ, แถวแรกใช้คำสำคัญและติดธง', async () => {
    const { parsed } = await run(await baacLikeFile());
    expect(parsed.rows).toHaveLength(8);
    expect(new Date(parsed.rows[0]!.ts).toISOString()).toBe('2024-03-04T09:15:30.000Z');
    expect(parsed.rows.map((r) => r.direction)).toEqual(['out', 'in', 'out', 'in', 'out', 'in', 'out', 'in']);
    expect(parsed.rows[0]).toMatchObject({ directionSource: 'keyword', kind: 'cash_withdrawal' });
    expect(parsed.rows[0]!.flags).toContain('direction_from_keyword');
    expect(parsed.rows[1]!.directionSource).toBe('balance');
    expect(parsed.stats.balanceMismatches).toBe(0);
  });

  it('ยอดติดลบ = กลับรายการ (เงินไหลกลับเข้าบัญชี) ไม่ใช่เงินออก', async () => {
    const { parsed } = await run(await baacLikeFile());
    const reversal = parsed.rows[5]!;
    expect(reversal).toMatchObject({ direction: 'in', amount: 1000, kind: 'other' });
    expect(reversal.flags).toContain('reversal');
  });

  it('ค่าธรรมเนียม ดอกเบี้ย (ดอกเบี้ยจ่าย = เงินเข้า) และผู้โอนจากแม่แบบรายละเอียด', async () => {
    const { parsed } = await run(await baacLikeFile());
    expect(parsed.rows[6]).toMatchObject({ direction: 'out', kind: 'fee', amount: 10 });
    expect(parsed.rows[7]).toMatchObject({ direction: 'in', kind: 'interest', amount: 4.25 });
    const credit = parsed.rows[3]!;
    expect(credit.cp).toMatchObject({ bank: 'KTB', number: '4855566677', name: 'TEST PERSON', inferred: false });
    expect(credit.reference).toBeUndefined(); // รายการนี้ไม่มีรหัสอ้างอิง
    expect(parsed.rows[1]!.reference).toBe('00000000101SPSC10');
    expect(parsed.rows[0]!.extra).toMatchObject({ atmId: 'T0000043', atmBank: 'กสิกรไทย' });
  });

  it('ใช้ "รวมทั้งสิ้น N รายการ" ท้ายตารางตรวจความครบถ้วน', async () => {
    const { parsed } = await run(await baacLikeFile());
    expect(parsed.stats.declaredRows).toBe(8);
    expect(parsed.stats.warnings).toEqual([]);
    expect(parsed.stats.skipped.map((s) => s.reason)).toEqual(['แถวสรุป/ยอดรวม']);
  });
});

describe('กรุงไทย (ผู้โอน/ผู้รับโอน ไม่มียอดคงเหลือ)', () => {
  it('ตรวจรูปแบบและเจ้าของบัญชีจากหัวเอกสารบรรทัดเดียว', async () => {
    const { mapping, owner } = await run(await ktbLikeFile());
    expect(mapping.format).toBe('ktb-statement');
    expect(owner).toMatchObject({ bank: 'KTB', number: '1234567890', name: 'นางสาว ตัวอย่าง ทดสอบ' });
    expect(owner.meta).toMatchObject({ 'สาขา': 'ทดสอบ', 'เลขประจำตัวประชาชน': '1234567890123' });
  });

  it('ทิศทางจากช่อง "รายการ" และจากฝั่งผู้โอน/ผู้รับโอน — ไม่เดา', async () => {
    const { parsed } = await run(await ktbLikeFile());
    expect(parsed.rows.map((r) => [r.direction, r.amount, r.kind, r.directionSource])).toEqual([
      ['in', 1000, 'cash_deposit', 'column'],
      ['out', 400, 'transfer', 'parties'],
      ['in', 600, 'transfer', 'parties'],
      ['out', 500, 'cash_withdrawal', 'column'],
      ['out', 35, 'payment', 'column'],
      ['in', 80, 'transfer', 'parties'],
    ]);
    expect(parsed.rows.every((r) => !r.flags.includes('direction_from_keyword'))).toBe(true);
  });

  it('คู่บัญชีจากคอลัมน์ธนาคาร+เลขบัญชีใต้หัวที่ merge (รู้จัก "ทีทีบี")', async () => {
    const { parsed } = await run(await ktbLikeFile());
    expect(parsed.rows[1]!.cp).toMatchObject({ bank: 'KTB', number: '1234567899' });
    expect(parsed.rows[2]!.cp).toMatchObject({ bank: 'KBANK', number: '0911122233' });
    expect(parsed.rows[5]!.cp).toMatchObject({ bank: 'TTB', number: '9222233344' });
    expect(parsed.rows[3]!.extra).toMatchObject({ atmId: 'T00042' });
    expect(parsed.rows[4]!.description).toContain('12C-0000000001');
  });
});

describe('การรวมหลายไฟล์', () => {
  it('ส่งต่อหลักฐานเสริมและข้อมูลบัญชีเข้าสู่ธุรกรรมรวม และไม่ปะปนบัญชีต่างธนาคาร', async () => {
    const files = [await kbankLikeFile(), await baacLikeFile(), await ktbLikeFile()];
    const inputs = [];
    for (const [i, f] of files.entries()) {
      const { owner, parsed } = await run(f);
      inputs.push({ fileId: `f${i}`, owner: { bank: owner.bank, number: owner.number!, name: owner.name, meta: owner.meta }, rows: parsed.rows });
    }
    const out = consolidate(inputs, [], DEFAULT_SETTINGS);
    expect(out.txns.length).toBe(6 + 8 + 6);
    expect(out.txns.some((t) => t.extra?.ip === '203.0.113.17')).toBe(true);
    const baac = Object.values(out.accounts).find((a) => a.bank === 'BAAC' && a.hasStatement)!;
    expect(baac.meta?.['สาขา']).toBe('0000 - สาขาตัวอย่าง');
    // ผู้โอนของ ธ.ก.ส. (KTB:4855566677) กับบัญชีเจ้าของไฟล์กรุงไทย (KTB:1234567890) เป็นคนละบัญชี
    expect(out.accounts['KTB:4855566677']).toBeDefined();
    expect(out.accounts['KTB:1234567890']?.hasStatement).toBe(true);
  });
});

describe('ตัวช่วยรหัสธนาคาร / เลขบัญชี / แม่แบบรายละเอียด', () => {
  it('รหัสธนาคาร ธปท. → รหัสของแอป', () => {
    expect(bankFromBotCode('14')).toBe('SCB');
    expect(bankFromBotCode('014')).toBe('SCB');
    expect(bankFromBotCode(30)).toBe('GSB');
    expect(bankFromBotCode('065')).toBe('TTB'); // ธนชาตควบรวมเป็น ttb
    expect(bankFromBotCode('087')).toBe('BOT087'); // ไม่รู้จัก → คงรหัสไว้ ไม่ปะปนกับธนาคารอื่น
    expect(bankFromBotCode('0')).toBeUndefined();
    expect(bankFromBotCode('abc')).toBeUndefined();
  });

  it('ค่าในเซลล์ "ธนาคาร": รหัสตัวเลข ชื่อไทย ตัวย่อ หรือชื่อที่ไม่รู้จัก', () => {
    expect(bankFromCell('4')).toBe('KBANK');
    expect(bankFromCell('ทีทีบี')).toBe('TTB');
    expect(bankFromCell('ออมสิน')).toBe('GSB');
    expect(bankFromCell('BAAC')).toBe('BAAC');
    expect(bankFromCell('ธนาคารสมมติ')).toBe('ธนาคารสมมติ');
    expect(bankFromCell('  ')).toBeUndefined();
    expect(normalizeBank('KBNK')).toBe('KBANK'); // รหัสเจ้าของตู้ ATM
  });

  it('เติม 0 นำหน้าเฉพาะเลขล้วนที่สั้นกว่าหลักมาตรฐาน 1–3 หลัก', () => {
    expect(normalizeAccountForBank('20123456789', 'GSB')).toMatchObject({ number: '020123456789', padded: true });
    expect(normalizeAccountForBank('228900265', 'KBANK')).toMatchObject({ number: '0228900265', padded: true });
    expect(normalizeAccountForBank('0228900265', 'KBANK')?.padded).toBeUndefined();
    expect(normalizeAccountForBank('12345', 'KBANK')?.number).toBe('12345'); // สั้นเกินไป ไม่เดา
    expect(normalizeAccountForBank('1234567890', undefined)?.number).toBe('1234567890'); // ไม่รู้ธนาคาร ไม่เติม
    expect(normalizeAccountForBank('1234XXX890', 'KBANK')?.masked).toBe(true);
  });

  it('แม่แบบรายละเอียดของ ธ.ก.ส.', () => {
    expect(parseBaacDetails('ถอน :  ผ่านตู้ ATM/ADM รหัส T0000043 ของธนาคาร KBNK')).toEqual({ atmId: 'T0000043', atmBank: 'กสิกรไทย' });
    expect(parseBaacDetails(' รหัสอ้างอิงธุรกรรม  00000000101SPSC10')).toEqual({ reference: '00000000101SPSC10' });
    const info = parseBaacDetails('รับเงินโอน : รับโอนจากธนาคารรหัส 030 เลขที่บัญชีผู้โอน 20198765432 ชื่อบัญชี นาย ตัวอย่าง');
    expect(info.cp).toEqual({ bank: 'GSB', number: '020198765432', name: 'นาย ตัวอย่าง' });
    expect(parseBaacDetails('ข้อความอื่น ๆ')).toEqual({});
  });
});

describe('Excel ที่ตั้งรหัสผ่าน', () => {
  const fixture = () => new File([readFileSync(resolve(__dirname, '../fixtures/static/agile-encrypted.xlsx'))], 'agile-encrypted.xlsx');

  it('ไม่ใส่รหัส → ขอรหัส; รหัสผิด → แจ้งว่าผิด', async () => {
    await expect(readStatementFile(fixture())).rejects.toMatchObject({ name: 'FilePasswordError', wrong: false, fileKind: 'Excel' });
    await expect(readStatementFile(fixture(), { password: 'ผิด' })).rejects.toMatchObject({ name: 'FilePasswordError', wrong: true });
  });

  it('รหัสถูก (รวมอักษรไทย) → อ่านได้เหมือนไฟล์ปกติ และ SHA-256 เป็นของไฟล์ที่เข้ารหัส', async () => {
    const res = await readStatementFile(fixture(), { password: 'ทดสอบ-8421' });
    expect(res.kind).toBe('xlsx');
    expect(res.tables[0]!.rows[1]).toEqual(['วันที่', 'เวลา', 'รายการ', 'ถอน', 'ฝาก', 'คงเหลือ']);
    expect(res.tables[0]!.rows).toHaveLength(5);
    expect(res.notes.join(' ')).toContain('ถอดรหัส');
    expect(res.sha256).toMatch(/^[0-9a-f]{64}$/);
    const t = res.tables[0]!;
    const { mapping, owner } = inspectTable(t);
    const parsed = parseRows(t, mapping, 'enc');
    expect(owner.number).toBe('1112333334');
    expect(parsed.rows.map((r) => [r.direction, r.amount])).toEqual([['in', 5000], ['out', 4800], ['out', 200]]);
  });
});
