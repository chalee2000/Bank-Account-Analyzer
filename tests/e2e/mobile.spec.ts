import { test, expect } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('iPhone: ทุกหน้าใช้งานได้ ไม่มี horizontal overflow และมีแถบเมนูล่าง', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองด้วยข้อมูลสมมติ' }).click();
  await page.waitForURL('**/#/dashboard');
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await expect(page.locator('.tabbar')).toBeVisible();
  const pages = ['/dashboard', '/import', '/accounts', '/transactions', '/patterns', '/trace?acc=KBANK:1111111111&dir=forward', '/network', '/timeline', '/findings', '/report', '/settings'];
  for (const [i, p] of pages.entries()) {
    await page.evaluate((h) => (location.hash = h), p);
    await page.waitForTimeout(1200);
    const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(ov.sw, `หน้า ${p} มี horizontal overflow`).toBeLessThanOrEqual(ov.cw + 1);
    await page.screenshot({ path: resolve(__dirname, 'screenshots', `iphone-${String(i + 1).padStart(2, '0')}-${p.split('?')[0]!.slice(1)}.png`) });
  }
  // เปิดแผงรายละเอียดบัญชีเป็น bottom sheet
  await page.evaluate(() => (location.hash = '/accounts'));
  await page.waitForTimeout(800);
  await page.locator('.vt-row.clickable').first().click();
  await expect(page.locator('.inspector')).toBeVisible();
  await page.screenshot({ path: resolve(__dirname, 'screenshots', 'iphone-12-inspector.png') });
  expect(errors).toEqual([]);
});
