// นำเข้าไฟล์ที่จำลองรูปแบบ statement ของธนาคาร (สังเคราะห์) + Excel ที่ตั้งรหัสผ่าน ผ่านหน้าจอจริง
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const gen = resolve(__dirname, '../fixtures/generated');
const BANK_FILES = ['bank_kbank_like.xlsx', 'bank_std_export_like.xlsx', 'bank_baac_like.xlsx', 'bank_ktb_like.xlsx'].map((f) => resolve(gen, f));
const ENCRYPTED = resolve(__dirname, '../fixtures/static/agile-encrypted.xlsx');
const shot = (name: string) => resolve(__dirname, 'screenshots', `${test.info().project.name}-${name}.png`);

test('รูปแบบ Statement ของธนาคาร + Excel ที่ตั้งรหัสผ่าน → ตรวจพบรูปแบบ → นำเข้า → ผังเครือข่าย', async ({ page }) => {
  test.skip(!existsSync(BANK_FILES[0]!), 'ยังไม่ได้สร้างไฟล์ทดสอบ (npm run fixtures)');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/tesseract/i.test(m.text())) errors.push(m.text()); });

  await page.goto('/');
  await page.getByRole('button', { name: 'สร้างคดีใหม่' }).first().click();
  await page.locator('.modal input').first().fill('ทดสอบรูปแบบธนาคาร');
  await page.getByRole('button', { name: 'สร้างและเริ่มนำเข้าไฟล์' }).click();
  await expect(page.getByText('ลากไฟล์ Statement มาวางที่นี่')).toBeVisible();

  await page.setInputFiles('input[type=file]', [...BANK_FILES, ENCRYPTED]);

  // Excel ที่ตั้งรหัสผ่าน: ขอรหัส → รหัสผิดแจ้งเตือน → รหัสถูก (มีอักษรไทย) อ่านได้
  const pw = page.getByPlaceholder('รหัสผ่านของไฟล์');
  await expect(pw).toBeVisible({ timeout: 60_000 });
  await pw.fill('ผิดรหัส');
  await page.getByRole('button', { name: 'เปิดไฟล์' }).click();
  await expect(page.getByText('รหัสผ่านไม่ถูกต้อง ลองอีกครั้ง')).toBeVisible({ timeout: 30_000 });
  await pw.fill('ทดสอบ-8421');
  await page.getByRole('button', { name: 'เปิดไฟล์' }).click();

  const importBtns = page.locator('button', { hasText: /^นำเข้า [\d,]+ รายการ$/ });
  await expect(importBtns).toHaveCount(5, { timeout: 60_000 });

  // ทั้ง 4 รูปแบบของธนาคารถูกตรวจพบและจับคู่คอลัมน์ให้อัตโนมัติ
  for (const label of ['กสิกรไทย — แยกต้นทาง/ปลายทาง', 'ไฟล์ส่งออกมาตรฐานจากธนาคาร', 'ธ.ก.ส. — รายการเคลื่อนไหวธุรกรรม', 'กรุงไทย — รายการ (ผู้โอน / ผู้รับโอน)']) {
    await expect(page.getByText('ตรวจพบรูปแบบ: ' + label)).toBeVisible();
  }
  await page.screenshot({ path: shot('banks-import-ready') });

  for (let i = 0; i < 5; i++) {
    await importBtns.first().click();
    await expect(importBtns).toHaveCount(4 - i, { timeout: 60_000 });
  }
  await expect(page.getByText('ไฟล์ในคดีนี้ (5)')).toBeVisible();

  // ภาพรวม: 6 + 60 + 8 + 6 + 3 = 83 ธุรกรรม (แถวเปิดบัญชียอด 0 และแถวสรุปท้ายตารางไม่นับ)
  await page.getByRole('link', { name: 'ภาพรวม', exact: false }).first().click();
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await expect(page.locator('.kpi').nth(1)).toContainText('83');
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot('banks-dashboard') });

  // ผังเครือข่ายแกนหลัก: เจ้าของ Statement เด่นและมีคำอธิบายสี
  await page.getByRole('link', { name: 'เครือข่าย', exact: false }).first().click();
  await expect(page.locator('.net-canvas canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.net-legend')).toContainText('เจ้าของ Statement');
  await expect(page.getByText('แกนหลัก: ')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot('banks-network') });

  // หลักฐานเสริม: ค้นหาด้วย IP ที่มากับ statement แล้วเห็นในแผงรายละเอียด
  await page.goto('/#/transactions?q=203.0.113.45');
  const summary = await page.getByText(/จาก 83 รายการ/).first().innerText();
  const shown = Number(summary.split(' ')[0]!.replace(/,/g, ''));
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(83);
  await page.locator('.vt-row.clickable').first().click();
  await expect(page.getByText('หลักฐานเสริมจาก Statement')).toBeVisible();
  await expect(page.locator('.inspector').getByText('203.0.113.45')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
