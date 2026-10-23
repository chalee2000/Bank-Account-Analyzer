// ตรวจไฟล์ statement ก่อนนำเข้าแอป: ระบบรู้จักรูปแบบหรือไม่ อ่านได้กี่แถว ทิศทาง/คู่บัญชี/ยอดคงเหลือเป็นอย่างไร
// ใช้: npm run check -- <ไฟล์> [รหัสผ่าน]   (ประมวลผลในเครื่องเท่านั้น ไม่ส่งข้อมูลออก)
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readStatementFile } from '../src/ingest';
import { inspectTable, pickBestTable } from '../src/ingest/detectColumns';
import { parseRows } from '../src/ingest/parseRows';
import { bankDisplay, formatAccountNumber } from '../src/core/normalize';

const [path, password] = process.argv.slice(2);
if (!path) {
  console.error('ใช้: npm run check -- <ไฟล์> [รหัสผ่าน]');
  process.exit(2);
}

const hist = (xs: string[]) =>
  Object.entries(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {}))
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}×${v}`)
    .join(', ') || '-';
const iso = (ts: number) => new Date(ts).toISOString().slice(0, 19).replace('T', ' ');

const name = basename(path);
const res = await readStatementFile(new File([readFileSync(path)], name), { password, ocr: 'off' });
const idx = pickBestTable(res.tables);
const table = res.tables[idx]!;
const { mapping, owner } = inspectTable(table);
const parsed = parseRows(table, mapping, 'check');
const rows = parsed.rows;

console.log(`ไฟล์        : ${name} (${res.kind}, ${(res.size / 1024).toFixed(0)} KB) SHA-256 ${res.sha256.slice(0, 16)}…`);
console.log(`ตาราง/ชีต   : ${res.tables.map((t, i) => `${i === idx ? '▶' : ' '}${t.sheetName ?? i} (${t.rows.length} แถว)`).join(' | ')}`);
console.log(`รูปแบบ      : ${owner.formatLabel ?? 'ไม่รู้จักรูปแบบนี้ — ใช้การเดาคอลัมน์ทั่วไป (ตรวจในหน้านำเข้าเข้าได้)'}`);
console.log(`เจ้าของบัญชี : ${owner.bank ? bankDisplay(owner.bank) : 'ไม่ระบุธนาคาร'} | ${owner.number ? formatAccountNumber(owner.number) : 'ไม่พบเลขบัญชี'} | ${owner.name ?? '-'}`);
if (owner.meta) console.log(`ข้อมูลบัญชี  : ${Object.entries(owner.meta).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
(owner.notes ?? []).forEach((n) => console.log(`ข้อสังเกต    : ${n}`));
console.log(`อ่านได้      : ${rows.length} / ${parsed.stats.totalRows} แถว (ข้าม ${parsed.stats.skipped.length}: ${hist(parsed.stats.skipped.map((s) => s.reason))})`);
console.log(`ช่วงเวลา    : ${rows.length ? `${iso(rows[0]!.ts)} → ${iso(rows[rows.length - 1]!.ts)}` : '-'}`);
console.log(`เข้า/ออก    : ${rows.filter((r) => r.direction === 'in').length} / ${rows.filter((r) => r.direction === 'out').length} | ทิศทางได้จาก: ${hist(rows.map((r) => r.directionSource))}`);
console.log(`ชนิดรายการ  : ${hist(rows.map((r) => r.kind))}`);
console.log(`ยอดคงเหลือ  : ตรวจ ${parsed.stats.balanceChecked} ไม่ต่อเนื่อง ${parsed.stats.balanceMismatches}`);
console.log(`คู่บัญชี     : มีเลขบัญชี ${rows.filter((r) => r.cp.number).length}/${rows.length} | ธนาคาร ${hist(rows.map((r) => (r.cp.bank ? bankDisplay(r.cp.bank) : 'ไม่ทราบ'))).slice(0, 140)}`);
console.log(`หลักฐานเสริม : ${hist(rows.flatMap((r) => Object.keys(r.extra ?? {})))}`);
console.log(`ธงเตือน      : ${hist(rows.flatMap((r) => r.flags))}`);
parsed.stats.warnings.forEach((w) => console.log(`⚠ ${w}`));
parsed.stats.notes.forEach((n) => console.log(`ℹ ${n}`));
