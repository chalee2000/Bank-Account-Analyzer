// สร้างไฟล์ Statement สังเคราะห์ (ข้อมูลสมมติทั้งหมด) หลายรูปแบบ เพื่อทดสอบการนำเข้าแบบ end-to-end
//   npm run fixtures   →  tests/fixtures/generated/
// รูปแบบที่สร้าง: CSV UTF-8 (พ.ศ.), XLSX, CSV Windows-874 (หัวตารางอังกฤษ), PDF ข้อความ, CSV Dr/Cr เรียงใหม่→เก่า, CSV เลขไทย,
// PDF สแกน (ภาพ), PNG (OCR) และไฟล์ใหญ่ 20,000 แถวสำหรับทดสอบประสิทธิภาพ
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import ExcelJS from 'exceljs';
import { chromium } from '@playwright/test';
import { buildDemoScenario, type DemoOwner, type DemoRow } from '../src/demo';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'tests/fixtures/generated');
mkdirSync(out, { recursive: true });

const owners = buildDemoScenario();
const byKey = Object.fromEntries(owners.map((o) => [o.key, o])) as Record<string, DemoOwner>;
const p2 = (n: number) => String(n).padStart(2, '0');
const be = (ts: number) => { const d = new Date(ts); return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear() + 543}`; };
const ce = (ts: number) => { const d = new Date(ts); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };
const hm = (ts: number) => { const d = new Date(ts); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thaiDigits = (s: string) => s.replace(/[0-9]/g, (d) => '๐๑๒๓๔๕๖๗๘๙'[Number(d)]!);
const csvEsc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const acctFmt = (n: string) => `${n.slice(0, 3)}-${n[3]}-${n.slice(4, 9)}-${n[9]}`;
const bankTh: Record<string, string> = { KBANK: 'กสิกรไทย', SCB: 'ไทยพาณิชย์', BBL: 'กรุงเทพ', KTB: 'กรุงไทย', BAY: 'กรุงศรีอยุธยา', TTB: 'ทีทีบี' };
const head = (o: DemoOwner) => [`ชื่อบัญชี: ${o.name}`, `เลขที่บัญชี: ${acctFmt(o.number)}`, `ธนาคาร${bankTh[o.bank]}`, 'ระหว่างวันที่ 01/03/2567 ถึง 31/03/2567'];

// ---- A: CSV UTF-8 BOM, พ.ศ., ถอน/ฝาก แยกคอลัมน์ ----
{
  const o = byKey.A!;
  const lines = [...head(o), '', 'วันที่,เวลา,รายการ,ถอน,ฝาก,ยอดคงเหลือ,ช่องทาง', `ยอดยกมา,,,,,"${money(o.opening)}",`];
  for (const r of o.rows) lines.push([be(r.ts), hm(r.ts), csvEsc(r.description), r.dir === 'out' ? csvEsc(money(r.amount)) : '', r.dir === 'in' ? csvEsc(money(r.amount)) : '', csvEsc(money(r.balance)), r.channel].join(','));
  writeFileSync(resolve(out, 'A_kbank.csv'), '﻿' + lines.join('\r\n'), 'utf8');
}

// ---- B1: XLSX, วันที่เป็น Date จริง + เวลาแยก, จำนวนเงินคอลัมน์เดียวมีเครื่องหมาย ----
{
  const o = byKey.B1!;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Statement');
  head(o).forEach((l) => ws.addRow([l]));
  ws.addRow([]);
  ws.addRow(['วันที่ทำรายการ', 'เวลา', 'รายละเอียด', 'จำนวนเงิน', 'ยอดเงินคงเหลือ', 'ช่องทาง']);
  ws.addRow(['ยอดยกมา', '', '', '', o.opening, '']);
  for (const r of o.rows) {
    const d = new Date(r.ts);
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const row = ws.addRow([day, hm(r.ts), r.description, r.dir === 'out' ? -r.amount : r.amount, r.balance, r.channel]);
    row.getCell(1).numFmt = 'dd/mm/yyyy';
    row.getCell(4).numFmt = '#,##0.00;-#,##0.00';
  }
  const ws2 = wb.addWorksheet('หมายเหตุ');
  ws2.addRow(['ชีตนี้ไม่ใช่ Statement']);
  await wb.xlsx.writeFile(resolve(out, 'B1_scb.xlsx'));
}

// ---- B2: CSV Windows-874 หัวตารางอังกฤษ วันที่ ISO ----
{
  const o = byKey.B2!;
  const lines = ['Account Name: ' + o.name, 'Account No: ' + acctFmt(o.number), 'Bangkok Bank Statement', '', 'Date,Time,Description,Debit,Credit,Balance'];
  for (const r of o.rows) lines.push([ce(r.ts), hm(r.ts), csvEsc(r.description), r.dir === 'out' ? csvEsc(money(r.amount)) : '', r.dir === 'in' ? csvEsc(money(r.amount)) : '', csvEsc(money(r.balance))].join(','));
  writeFileSync(resolve(out, 'B2_bbl_tis620.csv'), iconv.encode(lines.join('\r\n'), 'win874'));
}

// ---- C: CSV จำนวนเงินคอลัมน์เดียว + Dr/Cr, เรียงใหม่→เก่า ----
{
  const o = byKey.C!;
  const lines = [...head(o), '', 'Date/Time,Description,Amount,Dr/Cr,Balance'];
  for (const r of [...o.rows].reverse()) lines.push([`${be(r.ts)} ${hm(r.ts)}`, csvEsc(r.description), csvEsc(money(r.amount)), r.dir === 'out' ? 'DR' : 'CR', csvEsc(money(r.balance))].join(','));
  writeFileSync(resolve(out, 'C_kbank_drcr_desc.csv'), '﻿' + lines.join('\r\n'), 'utf8');
}

// ---- D: TSV เลขไทย ----
{
  const o = byKey.D!;
  const lines = [...head(o).map(thaiDigits), '', ['วันที่', 'เวลา', 'รายการ', 'ถอน', 'ฝาก', 'ยอดคงเหลือ'].join('\t')];
  for (const r of o.rows) lines.push([thaiDigits(be(r.ts)), thaiDigits(hm(r.ts)), r.description, r.dir === 'out' ? thaiDigits(money(r.amount)) : '', r.dir === 'in' ? thaiDigits(money(r.amount)) : '', thaiDigits(money(r.balance))].join('\t'));
  writeFileSync(resolve(out, 'D_scb_thai_digits.tsv'), lines.join('\n'), 'utf8');
}

// ---- HTML สำหรับ PDF/ภาพ ----
const fontDir = resolve(root, 'node_modules/@fontsource/noto-sans-thai/files');
const fontCss = ['thai', 'latin'].map((sub) => [400, 700].map((w) => `@font-face{font-family:'NT';font-weight:${w};src:url('file://${fontDir}/noto-sans-thai-${sub}-${w}-normal.woff2') format('woff2');unicode-range:${sub === 'thai' ? 'U+0E01-0E5B,U+200C-200D' : 'U+0000-00FF,U+2000-206F'};}`).join('')).join('');
function statementHtml(o: DemoOwner, rowsPerPage = 28, scale = 1): string {
  const pages: DemoRow[][] = [];
  for (let i = 0; i < o.rows.length; i += rowsPerPage) pages.push(o.rows.slice(i, i + rowsPerPage));
  const body = pages.map((rows, pi) => `
    <section class="pg" style="${pi ? 'page-break-before:always' : ''}">
      <div class="hd"><div class="b">รายการเดินบัญชี (Statement)</div><div>${head(o).join(' · ')}</div></div>
      <table><thead><tr><th>วันที่</th><th>เวลา</th><th>รายการ</th><th class="n">ถอน</th><th class="n">ฝาก</th><th class="n">ยอดคงเหลือ</th></tr></thead>
      <tbody>${pi === 0 ? '' : ''}${rows.map((r) => `<tr><td>${be(r.ts)}</td><td>${hm(r.ts)}</td><td>${r.description.replace(/&/g, '&amp;')}</td><td class="n">${r.dir === 'out' ? money(r.amount) : ''}</td><td class="n">${r.dir === 'in' ? money(r.amount) : ''}</td><td class="n">${money(r.balance)}</td></tr>`).join('')}</tbody></table>
      <div class="ft">หน้า ${pi + 1}/${pages.length}</div>
    </section>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>${fontCss}
    body{font-family:'NT',sans-serif;font-size:${11 * scale}px;margin:0;color:#000;background:#fff}
    .pg{padding:30px 34px;width:${794 * scale}px;box-sizing:border-box}
    .hd{margin-bottom:12px;line-height:1.5}.b{font-weight:700;font-size:${15 * scale}px}
    table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
    th{background:#eee}.n{text-align:right;white-space:nowrap}.ft{margin-top:10px;font-size:${9 * scale}px;color:#555}
  </style>${body}`;
}

const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const page = await browser.newPage();
// B3: PDF ข้อความ
{
  await page.setContent(statementHtml(byKey.B3!, 30), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: resolve(out, 'B3_ktb_text.pdf'), format: 'A4', printBackground: true });
}
// E: PDF สแกน (เป็นภาพล้วน ไม่มีข้อความ) — เรนเดอร์ HTML เป็น PNG แล้วฝังในหน้า PDF
{
  await page.setViewportSize({ width: 794 * 2, height: 1123 * 2 });
  await page.setContent(statementHtml(byKey.E!, 40, 2), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: 'png', fullPage: true });
  writeFileSync(resolve(out, 'E_bay_scan.png'), png);
  const b64 = png.toString('base64');
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.setContent(`<!doctype html><style>@page{margin:0}body{margin:0}img{width:100%;display:block}</style><img src="data:image/png;base64,${b64}">`, { waitUntil: 'load' });
  await page.pdf({ path: resolve(out, 'E_bay_scan.pdf'), format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
}
// F: PNG ภาพถ่ายหน้าจอ (OCR)
{
  await page.setViewportSize({ width: 794 * 2, height: 1123 * 2 });
  await page.setContent(statementHtml(byKey.F!, 40, 2), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(resolve(out, 'F_ttb_photo.png'), await page.screenshot({ type: 'png', fullPage: true }));
}
await browser.close();

// ---- PDF มีรหัสผ่าน (ธนาคารมักใช้เลขบัตรประชาชน/วันเกิดเป็นรหัส) — ต้องมี python3 + pypdf ----
try {
  const { execFileSync } = await import('node:child_process');
  execFileSync('python3', ['-c', [
    'import sys',
    'from pypdf import PdfReader, PdfWriter',
    'r = PdfReader(sys.argv[1]); w = PdfWriter()',
    'for p in r.pages: w.add_page(p)',
    'w.encrypt("1234")',
    'w.write(open(sys.argv[2], "wb"))',
  ].join('\n'), resolve(out, 'B3_ktb_text.pdf'), resolve(out, 'B3_ktb_encrypted.pdf')]);
} catch {
  console.warn('ข้ามการสร้าง PDF ที่มีรหัสผ่าน (ไม่มี python3/pypdf)');
}

// ---- ไฟล์ใหญ่ สำหรับทดสอบประสิทธิภาพ (20,000 แถว) ----
{
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const lines = ['ชื่อบัญชี: นายใหญ่ ทดสอบประสิทธิภาพ', 'เลขที่บัญชี: 999-9-99999-9', 'ธนาคารกสิกรไทย', '', 'วันที่,เวลา,รายการ,ถอน,ฝาก,ยอดคงเหลือ'];
  let bal = 1_000_000;
  const t0 = Date.UTC(2024, 0, 1);
  for (let i = 0; i < 20_000; i++) {
    const ts = t0 + i * 400_000 + Math.floor(rnd() * 300_000);
    const amt = Math.round((100 + rnd() * 30_000) * 100) / 100;
    const out_ = rnd() < 0.5;
    bal += out_ ? -amt : amt;
    if (bal < 0) bal += amt * 2;
    const cp = `${bankTh.SCB} ${acctFmt(String(1000000000 + Math.floor(rnd() * 400)))} คู่โอน${Math.floor(rnd() * 400)}`;
    lines.push([be(ts), hm(ts), `${out_ ? 'โอนเงินไป' : 'รับโอนจาก'} ${cp}`, out_ ? `"${money(amt)}"` : '', out_ ? '' : `"${money(amt)}"`, `"${money(bal)}"`].join(','));
  }
  writeFileSync(resolve(out, 'big_20000.csv'), '﻿' + lines.join('\n'), 'utf8');
}
console.log('สร้างไฟล์ทดสอบที่', out);
