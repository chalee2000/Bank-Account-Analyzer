import ExcelJS from 'exceljs';
import type { RawTable } from './types';

const p2 = (n: number) => String(n).padStart(2, '0');

/** แปลงค่าเซลล์ของ exceljs เป็นข้อความ (วันที่ใช้ UTC getter ตามหลัก wall-clock ของแอป) */
export function cellToString(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    const y = v.getUTCFullYear();
    const hms = `${p2(v.getUTCHours())}:${p2(v.getUTCMinutes())}:${p2(v.getUTCSeconds())}`;
    if (y <= 1900) return hms; // เซลล์เวลาล้วน
    const hasTime = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds();
    return `${y}-${p2(v.getUTCMonth() + 1)}-${p2(v.getUTCDate())}` + (hasTime ? ` ${hms}` : '');
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').trim();
  const o = v as unknown as Record<string, unknown>;
  if (Array.isArray(o.richText)) {
    return (o.richText as { text: string }[]).map((t) => t.text).join('').replace(/\s+/g, ' ').trim();
  }
  if ('result' in o && o.result !== undefined) return cellToString(o.result as ExcelJS.CellValue);
  if (typeof o.text === 'string') return o.text.trim();
  if (typeof o.error === 'string') return '';
  return '';
}

/** อ่านทุกชีตของ .xlsx เป็น RawTable (ชีตว่างถูกข้าม) — ไม่รองรับ .xls รุ่นเก่า */
export async function readXlsx(buf: ArrayBuffer): Promise<RawTable[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out: RawTable[] = [];
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    const width = ws.actualColumnCount || ws.columnCount;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) {
        const cell = row.getCell(c);
        // เซลล์ที่ถูก merge: exceljs คืนค่าของเซลล์หลักซ้ำทุกช่อง — เก็บเฉพาะเซลล์หลักเพื่อไม่ให้ข้อความหัวเอกสารซ้ำ
        cells.push(cell.type === ExcelJS.ValueType.Merge ? '' : cellToString(cell.value));
      }
      rows.push(cells);
    }
    while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
    if (rows.length) out.push({ fileType: 'xlsx', sheetName: ws.name, rows });
  });
  return out;
}
