import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildDemoCase } from '../../src/demo';
import { deriveCase } from '../../src/store/model';
import { analyze, runTrace } from '../../src/analysis';
import { buildWorkbook } from '../../src/report/exportXlsx';

describe('ส่งออก Excel', () => {
  it('มีครบทุกชีต ตัวเลขตรงกับข้อมูล และข้อความระมัดระวัง/ข้อความปิดท้ายอยู่ในไฟล์', async () => {
    const st = buildDemoCase();
    const d = deriveCase(st);
    const { result, ctx, attr } = analyze({ txns: d.txns, accounts: d.accounts, files: d.files, settings: st.settings });
    const trace = runTrace(ctx, attr, { direction: 'forward', accountId: 'KBANK:1111111111' });
    const blob = await buildWorkbook(st, d, result, [{ label: 'ไล่เงินออก: A', direction: 'forward', result: trace }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(['สรุป', 'ธุรกรรมรวม', 'โปรไฟล์บัญชี', 'คู่บัญชี', 'สัญญาณรูปแบบ', 'ผลวิเคราะห์', 'เส้นทางเงิน', 'ไฟล์และคุณภาพข้อมูล']);

    const tx = wb.getWorksheet('ธุรกรรมรวม')!;
    expect(tx.rowCount - 1).toBe(d.txns.length);
    let sum = 0;
    tx.eachRow((row, i) => { if (i > 1) sum += Number(row.getCell(11).value); });
    expect(sum).toBeCloseTo(d.txns.reduce((a, t) => a + t.amount, 0), 2);
    // วันที่เป็นเซลล์วันที่จริง และไม่เลื่อนตามเขตเวลา (wall-clock ใน UTC)
    const first = d.txns[0]!;
    const cell = tx.getRow(2).getCell(2).value as Date;
    expect(cell instanceof Date && cell.getTime()).toBe(first.ts);
    expect(tx.getRow(2).getCell(3).value).toMatch(/^\d{2}\/\d{2}\/2567 /);

    const prof = wb.getWorksheet('โปรไฟล์บัญชี')!;
    const rows: Record<string, ExcelJS.Row> = {};
    prof.eachRow((r, i) => { if (i > 1) rows[String(r.getCell(2).value)] = r; });
    const c = rows['555-5-55555-4']!;
    expect(Number(c.getCell(5).value)).toBe(result.profiles['KBANK:5555555554']!.totalIn);

    const summary = wb.getWorksheet('สรุป')!;
    const all: string[] = [];
    summary.eachRow((r) => r.eachCell((cl) => all.push(String(cl.value))));
    expect(all.join('\n')).toContain('ไม่ใช่ข้อพิสูจน์ความผิด');

    const sig = wb.getWorksheet('สัญญาณรูปแบบ')!;
    expect(sig.rowCount).toBeGreaterThan(result.signals.length);
    expect(wb.getWorksheet('เส้นทางเงิน')!.rowCount - 1).toBe(trace.edges.length);
  });
});
