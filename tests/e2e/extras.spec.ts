import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = resolve(__dirname, '../fixtures/generated');
const shot = (name: string) => resolve(__dirname, 'screenshots', `${test.info().project.name}-${name}.png`);

test('ประสิทธิภาพ: นำเข้า 20,000 แถว วิเคราะห์ และเลื่อน/กรองตารางธุรกรรม', async ({ page }) => {
  test.skip(!existsSync(resolve(dir, 'big_20000.csv')), 'ไม่มีไฟล์ใหญ่ (npm run fixtures)');
  await page.goto('/');
  await page.getByRole('button', { name: 'สร้างคดีใหม่' }).first().click();
  await page.locator('.modal input').first().fill('ทดสอบประสิทธิภาพ');
  await page.getByRole('button', { name: 'สร้างและเริ่มนำเข้าไฟล์' }).click();
  await expect(page.getByText('ลากไฟล์ Statement มาวางที่นี่')).toBeVisible();
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', resolve(dir, 'big_20000.csv'));
  const btn = page.locator('button', { hasText: /^นำเข้า [\d,]+ รายการ$/ });
  await expect(btn).toBeEnabled({ timeout: 60_000 });
  const tRead = Date.now() - t0;
  await expect(btn).toContainText('20,000');
  await btn.click();
  await expect(page.getByText('นำเข้าเรียบร้อย')).toBeVisible({ timeout: 60_000 });
  const tImport = Date.now() - t0;
  await page.goto('/#/transactions');
  await expect(page.getByText(/20,000 จาก 20,000 รายการ/)).toBeVisible({ timeout: 60_000 });
  const tTable = Date.now() - t0;
  // เลื่อนไปท้ายตาราง
  await page.evaluate(() => { const el = document.querySelector('.vt') as HTMLElement; el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(300);
  const rows = await page.locator('.vt-row:not(.head)').count();
  expect(rows).toBeGreaterThan(5);
  expect(rows).toBeLessThan(120); // virtualized: ไม่ render ครบ 20,000 แถว
  // กรองด้วยข้อความ
  const f0 = Date.now();
  await page.getByLabel('ค้นหาธุรกรรม').fill('คู่โอน7');
  await expect(page.getByText(/จาก 20,000 รายการ/)).toBeVisible();
  await expect(page.getByText(/^20,000 จาก/)).toHaveCount(0);
  const tFilter = Date.now() - f0;
  console.log(`PERF read=${tRead}ms import=${tImport}ms table=${tTable}ms filter=${tFilter}ms`);
  expect(tImport).toBeLessThan(30_000);
  expect(tFilter).toBeLessThan(5_000);
  await page.screenshot({ path: shot('perf-transactions') });
  await page.goto('/#/dashboard');
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot('perf-dashboard') });
});

test('ออฟไลน์: ติดตั้ง Service Worker แล้วโหลดแอปและเปิดคดีตัวอย่างได้เมื่อไม่มีเครือข่าย', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // รอให้ precache เสร็จ
  await page.waitForTimeout(2500);
  await page.reload();
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'ทดลองด้วยข้อมูลสมมติ' })).toBeVisible();
  await page.getByRole('button', { name: 'ทดลองด้วยข้อมูลสมมติ' }).click();
  await page.waitForURL('**/#/dashboard');
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await page.goto('/#/network');
  await expect(page.locator('.net-canvas canvas').first()).toBeVisible({ timeout: 20_000 });
  await page.goto('/#/report');
  await expect(page.locator('.rpt')).toBeVisible();
  await context.setOffline(false);
});

test('โหมดมืด: พื้นหลังและกราฟเปลี่ยนตามระบบ', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองด้วยข้อมูลสมมติ' }).click();
  await page.waitForURL('**/#/dashboard');
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await page.waitForTimeout(1200);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(12, 14, 32)');
  await page.screenshot({ path: shot('dark-dashboard') });
  await page.goto('/#/network');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: shot('dark-network') });
  await page.goto('/#/patterns');
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('dark-patterns') });
  await ctx.close();
});

test('เปิดแอปค้างที่หน้าเครือข่ายก่อนวิเคราะห์เสร็จ: ผังต้องขึ้นเมื่อข้อมูลพร้อม', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองด้วยข้อมูลสมมติ' }).click();
  await page.waitForURL('**/#/dashboard');
  await page.goto('/#/network');
  await expect(page.locator('.net-canvas canvas').first()).toBeVisible({ timeout: 20_000 });
  // โหลดใหม่ที่หน้านี้: คดีล่าสุดถูกกู้คืนและวิเคราะห์ใหม่ขณะที่หน้ากำลังแสดงอยู่
  await page.reload();
  await expect(page.locator('.net-canvas canvas').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('เจ้าของ Statement').first()).toBeVisible();
});
