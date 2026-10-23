import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dir = resolve(__dirname, '../fixtures/generated');
const FILES = ['A_kbank.csv', 'B1_scb.xlsx', 'B2_bbl_tis620.csv', 'B3_ktb_text.pdf', 'C_kbank_drcr_desc.csv', 'D_scb_thai_digits.tsv', 'E_bay_scan.pdf', 'F_ttb_photo.png'];
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(__dirname, 'screenshots', `${test.info().project.name}-${name}.png`) });

test.describe.configure({ mode: 'serial' });

test('นำเข้า 8 ไฟล์หลายรูปแบบ (CSV/Excel/PDF/OCR) → วิเคราะห์ → รายงาน PDF + Excel', async ({ page }) => {
  test.skip(!existsSync(resolve(dir, 'A_kbank.csv')), 'ยังไม่ได้สร้างไฟล์ทดสอบ (npm run fixtures)');
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://localhost:4173') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await expect(page.getByText('ข้อมูลทั้งหมดประมวลผลและเก็บในเครื่องนี้เท่านั้น')).toBeVisible();
  await shot(page, '01-cases');

  // สร้างคดี
  await page.getByRole('button', { name: 'สร้างคดีใหม่' }).first().click();
  await page.locator('.modal input').first().fill('คดีทดสอบ E2E');
  await page.getByRole('button', { name: 'สร้างและเริ่มนำเข้าไฟล์' }).click();
  await expect(page.getByText('ลากไฟล์ Statement มาวางที่นี่')).toBeVisible();

  // เลือกไฟล์ทั้ง 8
  await page.setInputFiles('input[type=file]', FILES.map((f) => resolve(dir, f)));
  // รอจนทุกไฟล์อ่านเสร็จ (OCR อาจนาน)
  await expect(page.locator('button', { hasText: /^นำเข้า [\d,]+ รายการ$/ })).toHaveCount(8, { timeout: 180_000 });
  await shot(page, '02-import-queue');

  // เปิดตรวจแผงของไฟล์ OCR ตัวหนึ่ง เพื่อถ่ายภาพ
  for (let i = 0; i < 8; i++) {
    const btn = page.locator('button', { hasText: /^นำเข้า [\d,]+ รายการ$/ }).first();
    await expect(btn).toBeEnabled({ timeout: 30_000 });
    if (i === 0) await shot(page, '03-import-review');
    await btn.click();
    await expect(page.locator('button', { hasText: /^นำเข้า [\d,]+ รายการ$/ })).toHaveCount(7 - i, { timeout: 60_000 });
  }
  await expect(page.getByText('ไฟล์ในคดีนี้ (8)')).toBeVisible();

  // ภาพรวม: ผลต้องตรงกับสถานการณ์สมมติ (17 บัญชี, 52 ธุรกรรม)
  await page.getByRole('link', { name: 'ภาพรวม', exact: false }).first().click();
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await expect(page.locator('.kpi').nth(0)).toContainText('17');
  await expect(page.locator('.kpi').nth(1)).toContainText('52');
  await expect(page.locator('.kpi').nth(1)).toContainText('32 รายการ');
  await page.waitForTimeout(800);
  await shot(page, '04-dashboard');

  // ตรวจรูปแบบ: ต้องพบ Structuring/Convergence/Layering/Cash-out/Circular
  await page.goto('/#/patterns');
  for (const t of ['แบ่งโอนยอดใกล้เคียงกัน', 'รวมเงินเข้าบัญชีเดียว', 'ส่งต่อเงินผ่านบัญชีต่อเนื่อง', 'ถอนเงินสดหลังรับโอน', 'เงินวนกลับต้นทาง']) {
    await expect(page.locator('.chip', { hasText: t }).first()).toBeVisible();
  }
  await shot(page, '05-patterns');

  // เครือข่าย
  await page.goto('/#/network');
  await expect(page.locator('.net-canvas canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot(page, '06-network');

  // เส้นทางเงิน
  await page.goto('/#/trace?acc=KBANK:1111111111&dir=forward');
  await expect(page.getByText('แผนภาพการเคลื่อนที่ของเงิน')).toBeVisible({ timeout: 20_000 });
  await shot(page, '07-trace');
  await page.getByRole('button', { name: /ปักหมุดใส่รายงาน/ }).click();

  // ผลวิเคราะห์
  await page.goto('/#/findings');
  await expect(page.getByText('ข้อสังเกต').first()).toBeVisible();

  // รายงาน → PDF
  await page.goto('/#/report');
  await expect(page.locator('.rpt')).toBeVisible();
  await expect(page.locator('.report-controls .spinner')).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  await expect(page.locator('.rpt img[alt^="ผังเครือข่าย"]')).toBeVisible();
  await shot(page, '08-report');
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  expect(pdf.length).toBeGreaterThan(50_000);
  // pdf.js แตกอักขระไทยเป็นชิ้นเล็กและอาจทำวรรณยุกต์หาย จึงเทียบแบบตัดช่องว่างและเครื่องหมายวรรณยุกต์/สระบนล่างออกทั้งสองฝั่ง
  const norm = (t: string) => t.replace(/\u0E33/g, '\u0E32').replace(/[\s\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '');
  const pdfText = norm(await extractPdfText(pdf));
  for (const phrase of ['รายงานประกอบการสืบสวน', 'ไม่ใช่ข้อพิสูจน์ความผิด', 'Executive Summary', 'SHA-256', 'Money Trail', 'ข้อจำกัดของการวิเคราะห์', 'CDR, Cell Site']) {
    expect(pdfText, `ไม่พบ "${phrase}" ใน PDF`).toContain(norm(phrase));
  }

  // Excel
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /ส่งออก Excel/ }).click()]);
  const xlsx = readFileSync((await dl.path())!);
  expect(xlsx.subarray(0, 2).toString()).toBe('PK'); // ไฟล์ .xlsx (zip) — เนื้อหาตรวจใน tests/unit/xlsx-export.test.ts
  expect(xlsx.length).toBeGreaterThan(10_000);

  // ไม่มีคำขอเครือข่ายภายนอก และไม่มี error ใน console
  expect(external, 'พบคำขอไปยังเครือข่ายภายนอก').toEqual([]);
  // คำเตือนภายในของ tesseract.js (พารามิเตอร์ที่ไม่มีในรุ่นโมเดลที่ใช้) ไม่ใช่ข้อผิดพลาดของแอป
  expect(errors.filter((e) => !/favicon|manifest|Parameter not found/i.test(e))).toEqual([]);
});

test('ไฟล์คดีเข้ารหัส: ส่งออก → ลบคดี → นำเข้า → ข้อมูลกลับมาครบ', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองด้วยข้อมูลสมมติ' }).click();
  await page.waitForURL('**/#/dashboard');
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await page.goto('/#/settings');
  await page.getByRole('button', { name: /ส่งออกไฟล์คดี/ }).click();
  const inputs = page.locator('.modal input[type=password]');
  await inputs.nth(0).fill('รหัสทดสอบ-12345');
  await inputs.nth(1).fill('รหัสทดสอบ-12345');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ส่งออก', exact: true }).click()]);
  const file = await dl.path();
  const bytes = readFileSync(file!);
  expect(bytes.subarray(0, 4).toString()).toBe('BAA1');
  expect(bytes.toString('latin1')).not.toContain('statement_A');

  // ลบคดีทั้งหมดแล้วนำเข้ากลับ
  await page.goto('/#/');
  await page.getByRole('button', { name: /ลบ$/ }).first().click();
  await page.getByRole('button', { name: 'ลบถาวร' }).click();
  await expect(page.getByText('ยังไม่มีคดี')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /นำเข้าไฟล์คดี/ }).click();
  await (await chooser).setFiles(file!);
  await page.locator('.modal input[type=password]').fill('ผิดรหัส');
  await page.getByRole('button', { name: 'ถอดรหัส' }).click();
  await expect(page.getByText('รหัสผ่านไม่ถูกต้อง')).toBeVisible();
  await page.locator('.modal input[type=password]').fill('รหัสทดสอบ-12345');
  await page.getByRole('button', { name: 'ถอดรหัส' }).click();
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.kpi').nth(1)).toContainText('52');
});

test('PDF ที่มีรหัสผ่าน: ถามรหัส → รหัสผิดแจ้งเตือน → รหัสถูกอ่านได้', async ({ page }) => {
  test.skip(!existsSync(resolve(dir, 'B3_ktb_encrypted.pdf')), 'ไม่มีไฟล์ PDF ที่มีรหัสผ่าน');
  await page.goto('/');
  await page.getByRole('button', { name: 'สร้างคดีใหม่' }).first().click();
  await page.locator('.modal input').first().fill('ทดสอบรหัสผ่าน PDF');
  await page.getByRole('button', { name: 'สร้างและเริ่มนำเข้าไฟล์' }).click();
  await expect(page.getByText('ลากไฟล์ Statement มาวางที่นี่')).toBeVisible();
  await page.setInputFiles('input[type=file]', resolve(dir, 'B3_ktb_encrypted.pdf'));
  await expect(page.getByText('PDF นี้มีรหัสผ่าน')).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder('รหัสผ่าน PDF').fill('0000');
  await page.getByRole('button', { name: 'เปิดไฟล์' }).click();
  await expect(page.getByText('รหัสผ่านไม่ถูกต้อง ลองอีกครั้ง')).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder('รหัสผ่าน PDF').fill('1234');
  await page.getByRole('button', { name: 'เปิดไฟล์' }).click();
  await expect(page.locator('button', { hasText: /^นำเข้า 8 รายการ$/ })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByPlaceholder('เช่น 123-4-56789-0')).toHaveValue('444-4-44444-3');
});

async function extractPdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out += tc.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
  }
  return out;
}
