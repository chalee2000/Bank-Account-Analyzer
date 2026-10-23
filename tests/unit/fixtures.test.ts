// ทดสอบการอ่านไฟล์จริงหลายรูปแบบ (สร้างด้วย `npm run fixtures`) เทียบกับข้อมูลต้นทางของสถานการณ์สมมติ
// ถ้ายังไม่ได้สร้างไฟล์ทดสอบ จะข้ามชุดนี้
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildDemoScenario, type DemoOwner } from '../../src/demo';
import { readStatementFile } from '../../src/ingest';
import { detectMapping, suggestOwner } from '../../src/ingest/detectColumns';
import { parseRows } from '../../src/ingest/parseRows';
import { consolidate, type FileRows } from '../../src/ingest/consolidate';
import { analyze } from '../../src/analysis';
import { DEFAULT_SETTINGS } from '../../src/core/types';
import { buildDemoCase } from '../../src/demo';
import { deriveCase } from '../../src/store/model';

const dir = resolve(__dirname, '../fixtures/generated');
const have = existsSync(resolve(dir, 'A_kbank.csv'));
const owners = Object.fromEntries(buildDemoScenario().map((o) => [o.key, o])) as Record<string, DemoOwner>;

async function load(name: string, ownerKey: string, opts: { sheet?: number } = {}) {
  const buf = readFileSync(resolve(dir, name));
  const file = new File([buf], name);
  const res = await readStatementFile(file);
  const table = res.tables[opts.sheet ?? 0]!;
  const mapping = detectMapping(table);
  const o = owners[ownerKey]!;
  return { res, table, mapping, parsed: parseRows(table, mapping, 'f_' + ownerKey), owner: o, suggestion: suggestOwner(table.rows, mapping.headerRow) };
}

function expectSameAsScenario(parsed: ReturnType<typeof parseRows>, o: DemoOwner) {
  expect(parsed.stats.skipped.filter((s) => !/ยกมา|หัวตาราง/.test(s.reason))).toEqual([]);
  expect(parsed.rows).toHaveLength(o.rows.length);
  parsed.rows.forEach((r, i) => {
    const e = o.rows[i]!;
    expect({ ts: r.ts, dir: r.direction, amt: r.amount }, `แถว ${i}`).toEqual({ ts: e.ts, dir: e.dir, amt: e.amount });
    expect(r.balanceAfter).toBeCloseTo(e.balance, 2);
  });
  expect(parsed.stats.balanceMismatches).toBe(0);
}

describe.skipIf(!have)('อ่านไฟล์จริงหลายรูปแบบ', () => {
  it('A: CSV UTF-8 พ.ศ. ถอน/ฝาก', async () => {
    const { parsed, owner, suggestion, mapping } = await load('A_kbank.csv', 'A');
    expect(mapping.amountMode).toBe('two-columns');
    expect(suggestion).toMatchObject({ number: owner.number, name: owner.name, bank: 'KBANK' });
    expectSameAsScenario(parsed, owner);
    expect(parsed.stats.openingBalance).toBeCloseTo(owner.opening, 2);
  });
  it('B1: Excel (วันที่ Date จริง + เวลาแยก, จำนวนเงินมีเครื่องหมาย) และข้ามชีตหมายเหตุ', async () => {
    const { res, parsed, owner, mapping } = await load('B1_scb.xlsx', 'B1');
    expect(res.tables).toHaveLength(2);
    expect(mapping.amountMode).toBe('signed');
    expectSameAsScenario(parsed, owner);
  });
  it('B2: CSV Windows-874 หัวตารางอังกฤษ วันที่ ISO', async () => {
    const { res, parsed, owner, suggestion } = await load('B2_bbl_tis620.csv', 'B2');
    expect(res.notes.join(' ')).toContain('windows-874');
    expect(suggestion.number).toBe(owner.number);
    expectSameAsScenario(parsed, owner);
  });
  it('C: Dr/Cr คอลัมน์เดียว เรียงใหม่→เก่า วันที่+เวลาในเซลล์เดียว', async () => {
    const { parsed, owner, mapping } = await load('C_kbank_drcr_desc.csv', 'C');
    expect(mapping.amountMode).toBe('drcr-column');
    expect(parsed.stats.descendingInput).toBe(true);
    expectSameAsScenario(parsed, owner);
  });
  it('D: TSV เลขไทย', async () => {
    const { parsed, owner, suggestion } = await load('D_scb_thai_digits.tsv', 'D');
    expect(suggestion.number).toBe(owner.number);
    expectSameAsScenario(parsed, owner);
  });
  it('B3: PDF ข้อความ (หลายหน้า) อ่านกลับตรงกับต้นทาง', async () => {
    const { res, parsed, owner } = await load('B3_ktb_text.pdf', 'B3');
    expect(res.tables[0]!.fileType).toBe('pdf-text');
    expectSameAsScenario(parsed, owner);
  }, 60_000);
  it('ไฟล์ใหญ่ 20,000 แถวอ่านและวิเคราะห์ได้ในเวลาที่ยอมรับได้', async () => {
    const t0 = Date.now();
    const { parsed } = await load('big_20000.csv', 'A');
    const rows = parsed.rows;
    expect(rows.length).toBe(20_000);
    expect(parsed.stats.balanceMismatches).toBeLessThan(5);
    const files: FileRows[] = [{ fileId: 'big', owner: { bank: 'KBANK', number: '9999999999', name: 'ใหญ่' }, rows }];
    const c = consolidate(files, [], DEFAULT_SETTINGS);
    const { result } = analyze({ txns: c.txns, accounts: c.accounts, files: [], settings: DEFAULT_SETTINGS });
    expect(result.profiles['KBANK:9999999999']!.inCount + result.profiles['KBANK:9999999999']!.outCount).toBe(20_000);
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);
});

describe.skipIf(!have || !existsSync(resolve(dir, 'B3_ktb_encrypted.pdf')))('PDF ที่มีรหัสผ่าน', () => {
  it('ไม่ให้รหัส/รหัสผิด → PdfPasswordError; รหัสถูก → อ่านได้ตรงต้นทาง', async () => {
    const buf = readFileSync(resolve(dir, 'B3_ktb_encrypted.pdf'));
    const file = new File([buf], 'enc.pdf');
    await expect(readStatementFile(file)).rejects.toMatchObject({ name: 'PdfPasswordError', wrong: false });
    await expect(readStatementFile(file, { password: '9999' })).rejects.toMatchObject({ name: 'PdfPasswordError', wrong: true });
    const res = await readStatementFile(file, { password: '1234' });
    const m = detectMapping(res.tables[0]!);
    expectSameAsScenario(parseRows(res.tables[0]!, m, 'enc'), owners.B3!);
  }, 60_000);
});

describe.skipIf(!have)('ชุดไฟล์ทั้งหมดเทียบกับข้อมูลสาธิต', () => {
  it('นำเข้า A,B1,B2,B3,C,D จากไฟล์หลายรูปแบบ ได้ผลวิเคราะห์ตรงกับ state สาธิตในส่วนที่เกี่ยวข้อง', async () => {
    const specs: [string, string][] = [['A_kbank.csv', 'A'], ['B1_scb.xlsx', 'B1'], ['B2_bbl_tis620.csv', 'B2'], ['B3_ktb_text.pdf', 'B3'], ['C_kbank_drcr_desc.csv', 'C'], ['D_scb_thai_digits.tsv', 'D']];
    const files: FileRows[] = [];
    for (const [name, key] of specs) {
      const l = await load(name, key);
      files.push({ fileId: 'f_' + key, owner: { bank: l.owner.bank, number: l.owner.number, name: l.owner.name }, rows: l.parsed.rows });
    }
    const fromFiles = consolidate(files, [], DEFAULT_SETTINGS);
    // เทียบกับคดีสาธิต (ซึ่งสร้าง StatementRow ตรง ๆ) เฉพาะบัญชีเดียวกัน
    const demo = buildDemoCase();
    demo.files = demo.files.filter((f) => ['A', 'B1', 'B2', 'B3', 'C', 'D'].some((k) => f.record.id === `demo_${k}`));
    const ref = deriveCase(demo);
    expect(fromFiles.txns.length).toBe(ref.txns.length);
    expect(fromFiles.mirrorsMerged).toBe(ref.mirrorsMerged);
    const a = analyze({ txns: fromFiles.txns, accounts: fromFiles.accounts, files: [], settings: DEFAULT_SETTINGS }).result;
    const b = analyze({ txns: ref.txns, accounts: ref.accounts, files: [], settings: DEFAULT_SETTINGS }).result;
    const count = (r: typeof a) => Object.fromEntries([...new Set(r.signals.map((s) => s.type))].map((t) => [t, r.signals.filter((s) => s.type === t).length]));
    expect(count(a)).toEqual(count(b));
    expect(Math.round(Object.values(a.profiles).reduce((x, p) => x + p.totalIn, 0))).toBe(Math.round(Object.values(b.profiles).reduce((x, p) => x + p.totalIn, 0)));
  }, 90_000);
});
