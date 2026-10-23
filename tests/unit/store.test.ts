import { describe, it, expect } from 'vitest';
import { createCaseState, deriveCase } from '../../src/store/model';
import { exportCase, importCase, inspectCaseFile, WrongPassphraseError } from '../../src/store/caseFile';
import { readCsv } from '../../src/ingest/csv';
import { detectMapping } from '../../src/ingest/detectColumns';
import { parseRows } from '../../src/ingest/parseRows';

const enc = (s: string) => new TextEncoder().encode(s);
const buf = async (b: Blob) => await b.arrayBuffer();

function stateWithFile() {
  const st = createCaseState('คดีทดสอบ', { caseNumber: '1/2567', investigator: 'ผู้ตรวจสอบ' });
  const t = readCsv(enc('วันที่,เวลา,รายการ,ถอน,ฝาก,ยอดคงเหลือ\n05/03/2567,09:00,โอนเงินไป ไทยพาณิชย์ 222-2-22222-2,"20,000.00",,"80,000.00"'));
  const res = parseRows(t, detectMapping(t), 'f1');
  st.files.push({
    record: {
      id: 'f1', name: 'a.csv', size: 10, sha256: 'x', type: 'csv', importedAt: 1, ownerAccountId: 'KBANK:1111111111',
      rowsTotal: 1, rowsImported: 1, rowsSkipped: 0, duplicatesRemoved: 0, warnings: [],
    },
    owner: { bank: 'KBANK', number: '1111111111', name: 'นายเอ' },
    rows: res.rows,
    skipped: [],
  });
  st.accountNotes['SCB:2222222222'] = { label: 'นายบี (ตั้งชื่อเอง)' };
  return st;
}

describe('deriveCase', () => {
  it('สร้าง txns/accounts และใส่ชื่อที่ผู้ใช้ตั้งเอง', () => {
    const d = deriveCase(stateWithFile());
    expect(d.txns).toHaveLength(1);
    expect(d.accounts['SCB:2222222222']!.label).toBe('นายบี (ตั้งชื่อเอง)');
  });
});

describe('ไฟล์คดี', () => {
  it('เข้ารหัสแล้วถอดกลับได้ตรงเดิม', async () => {
    const st = stateWithFile();
    const blob = await exportCase(st, 'รหัสลับ-123');
    const b = await buf(blob);
    expect((await inspectCaseFile(b)).encrypted).toBe(true);
    // ข้อมูลต้องไม่อ่านออกได้ใน ciphertext
    expect(new TextDecoder('latin1').decode(new Uint8Array(b))).not.toContain('นายเอ');
    const back = await importCase(b, 'รหัสลับ-123');
    expect(back.meta.name).toBe('คดีทดสอบ');
    expect(back.files[0]!.rows[0]!.amount).toBe(20000);
    expect(back.accountNotes['SCB:2222222222']!.label).toContain('นายบี');
  });
  it('รหัสผ่านผิดหรือไม่ใส่ → ผิดพลาด', async () => {
    const b = await buf(await exportCase(stateWithFile(), 'abc'));
    await expect(importCase(b, 'wrong')).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(importCase(b)).rejects.toBeInstanceOf(WrongPassphraseError);
  });
  it('ไฟล์ที่ไม่เข้ารหัส (เลือกโดยผู้ใช้)', async () => {
    const b = await buf(await exportCase(stateWithFile()));
    expect((await inspectCaseFile(b)).encrypted).toBe(false);
    expect((await importCase(b)).meta.caseNumber).toBe('1/2567');
  });
  it('ไฟล์ที่ไม่ใช่ไฟล์คดี', async () => {
    await expect(importCase(enc('hello world, not a case').buffer as ArrayBuffer)).rejects.toThrow();
  });
});
