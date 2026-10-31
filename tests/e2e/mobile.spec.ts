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

test('iPhone: กดค้างที่พื้นที่ว่าง/จุดบัญชีบนผัง → เมนูไม่ปิดเองเมื่อยกนิ้ว และแตะคำสั่งในเมนูได้', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const HOST = '.net-canvas [role=img]';
  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองด้วยข้อมูลสมมติ' }).tap();
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await page.goto('/#/network');
  await page.waitForFunction((sel) => ((document.querySelector(sel) as any)?.__cy?.nodes().length ?? 0) > 0, HOST);
  await page.waitForTimeout(1000);
  const cdp = await context.newCDPSession(page);
  // กดค้าง 0.9 วินาทีแล้วยกนิ้ว (Cytoscape ส่ง "tap" ตามหลัง taphold — ต้องไม่ปิดเมนู)
  const longPress = async (p: { x: number; y: number }) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
    await page.waitForTimeout(900);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
  };
  const blank = await page.evaluate((sel) => {
    const host = document.querySelector(sel) as any;
    const cy = host.__cy;
    const r = host.getBoundingClientRect();
    const pan = cy.pan();
    const z = cy.zoom();
    for (let fy = 0.2; fy < 0.9; fy += 0.04) {
      for (let fx = 0.05; fx < 0.95; fx += 0.03) {
        const rx = r.width * fx;
        const ry = r.height * fy;
        const hit = document.elementFromPoint(r.left + rx, r.top + ry);
        if (!hit || !host.contains(hit)) continue;
        if (cy.renderer().findNearestElements((rx - pan.x) / z, (ry - pan.y) / z, true, true).length) continue;
        if (cy.nodes().some((n: any) => { const p = n.renderedPosition(); return Math.hypot(p.x - rx, p.y - ry) < 50; })) continue;
        return { x: Math.round(r.left + rx), y: Math.round(r.top + ry) };
      }
    }
    return null;
  }, HOST);
  expect(blank, 'ต้องมีพื้นที่ว่างบนผัง').not.toBeNull();
  await longPress(blank!);
  const menu = page.getByRole('menu', { name: 'เมนูของผัง' });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: resolve(__dirname, 'screenshots', 'iphone-13-canvas-menu.png') });
  await menu.getByRole('menuitemcheckbox', { name: 'แสดงไอคอนธนาคารทุกโหนด' }).tap();
  await expect(menu).toBeHidden();
  await expect.poll(() => page.evaluate((sel) => (document.querySelector(sel) as any).__cy.$('node[badge]').length, HOST)).toBeGreaterThan(0);

  // กดค้างที่จุดบัญชี → เมนูของจุด (ไม่เปิดแผงรายละเอียดจาก tap ที่ตามมา)
  const node = await page.evaluate((sel) => {
    const host = document.querySelector(sel) as any;
    const r = host.getBoundingClientRect();
    for (const n of host.__cy.nodes('.plain').toArray()) {
      if (n.data('kind') !== 'account') continue;
      const p = n.renderedPosition();
      const x = r.left + p.x;
      const y = r.top + p.y;
      const hit = document.elementFromPoint(x, y);
      if (hit && host.contains(hit)) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  }, HOST);
  expect(node).not.toBeNull();
  await longPress(node!);
  await expect(page.locator('.ctx-menu')).toBeVisible();
  await expect(page.locator('.ctx-menu').getByRole('menuitem', { name: /ชื่อ-นามสกุล/ })).toBeVisible();
  await expect(page.locator('.inspector')).toBeHidden();
  expect(errors).toEqual([]);
});
