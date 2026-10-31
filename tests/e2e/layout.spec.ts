// รูปแบบการจัดผัง (วงซ้อน) + จำตำแหน่งที่ลากเอง + รายงานใช้ตำแหน่งเดียวกัน (คดีตัวอย่างข้อมูลสมมติ)
import { test, expect, type Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shot = (name: string) => resolve(__dirname, 'screenshots', `${test.info().project.name}-${name}.png`);
const HOST = '.net-canvas [role=img]';
type P = { x: number; y: number };

async function waitGraph(page: Page) {
  await expect(page.locator('.net-canvas canvas').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction((sel) => ((document.querySelector(sel) as any)?.__cy?.nodes().length ?? 0) > 0, HOST);
  await page.waitForTimeout(900);
}

const nodePos = (page: Page, id: string) =>
  page.evaluate(([sel, nid]) => ({ ...(document.querySelector(sel!) as any).__cy.getElementById(nid).position() }) as P, [HOST, id]);

/** ระยะจากศูนย์กลาง (ค่าเฉลี่ยตำแหน่งเจ้าของ) แยกตามบทบาท */
const ringDistances = (page: Page) =>
  page.evaluate((sel) => {
    const cy = (document.querySelector(sel) as any).__cy;
    const owners = cy.nodes('.owner');
    const c = { x: 0, y: 0 };
    owners.forEach((n: any) => { c.x += n.position('x') / owners.length; c.y += n.position('y') / owners.length; });
    const d = (n: any) => Math.hypot(n.position('x') - c.x, n.position('y') - c.y);
    return { owner: owners.map(d) as number[], plain: cy.nodes('.plain').map(d) as number[] };
  }, HOST);

async function pickPlainNode(page: Page) {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel) as any;
    const r = host.getBoundingClientRect();
    for (const n of host.__cy.nodes('.plain').toArray()) {
      const p = n.renderedPosition();
      const x = r.left + p.x;
      const y = r.top + p.y;
      // ต้องลากไปทางขวา-ล่างได้โดยไม่ชนแผงเครื่องมือหรือขอบ
      const hit = document.elementFromPoint(x, y);
      const dest = document.elementFromPoint(x + 90, y + 60);
      if (hit && host.contains(hit) && dest && host.contains(dest)) return { id: n.id() as string, x, y };
    }
    return null;
  }, HOST);
}

const caption = (page: Page) => page.locator('figcaption', { hasText: 'รูปที่ 3' });

test('รูปแบบวงซ้อน + ลากจุดแล้วระบบจำตำแหน่ง (ต่อรูปแบบ) และรายงานใช้ตำแหน่งเดียวกัน', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองด้วยข้อมูลสมมติ' }).click();
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await page.goto('/#/network');
  await waitGraph(page);

  // เลือกวงซ้อน → เจ้าของ Statement อยู่วงใน คู่บัญชีวงนอก
  const concentric = page.getByRole('button', { name: 'วงซ้อน: เจ้าของอยู่กลาง', exact: true });
  await concentric.click();
  await expect(concentric).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(900);
  const rings = await ringDistances(page);
  expect(Math.max(...rings.owner)).toBeLessThan(Math.min(...rings.plain));
  await page.screenshot({ path: shot('layout-concentric') });
  await expect(page.locator('.net-pos-status')).toContainText('ลากจุดเพื่อจัดตำแหน่งเอง');

  // ลากจุดหนึ่งไปที่ใหม่
  const t = await pickPlainNode(page);
  expect(t, 'ต้องมีจุดคู่บัญชีที่ลากได้').not.toBeNull();
  const ringPos = await nodePos(page, t!.id);
  await page.mouse.move(t!.x, t!.y);
  await page.mouse.down();
  await page.mouse.move(t!.x + 90, t!.y + 60, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.net-pos-status')).toContainText('ใช้ตำแหน่งที่จัดเอง');
  const dragged = await nodePos(page, t!.id);
  expect(Math.hypot(dragged.x - ringPos.x, dragged.y - ringPos.y)).toBeGreaterThan(20);
  await page.waitForTimeout(500); // ให้บันทึกลง IndexedDB

  // รีโหลด → รูปแบบและตำแหน่งที่ลากยังอยู่
  await page.reload();
  await waitGraph(page);
  await expect(page.getByRole('button', { name: 'วงซ้อน: เจ้าของอยู่กลาง', exact: true })).toHaveAttribute('aria-pressed', 'true');
  let p = await nodePos(page, t!.id);
  expect(p.x).toBeCloseTo(dragged.x, 0);
  expect(p.y).toBeCloseTo(dragged.y, 0);

  // สลับเป็นอัตโนมัติแล้วกลับมาวงซ้อน → ตำแหน่งของวงซ้อนยังอยู่ (เก็บแยกตามรูปแบบ)
  await page.getByRole('button', { name: 'อัตโนมัติ', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'วงซ้อน: เจ้าของอยู่กลาง', exact: true }).click();
  await page.waitForTimeout(900);
  p = await nodePos(page, t!.id);
  expect(p.x).toBeCloseTo(dragged.x, 0);
  expect(p.y).toBeCloseTo(dragged.y, 0);

  // รายงาน: ใช้ตำแหน่งที่จัดไว้และบอกในคำบรรยายรูป
  await page.goto('/#/report');
  await expect(page.locator('img[alt="ผังเครือข่ายความเชื่อมโยงระหว่างบัญชี"]')).toBeVisible({ timeout: 30_000 });
  await expect(caption(page)).toContainText('รูปแบบวงซ้อน');
  await expect(caption(page)).toContainText('จัดตำแหน่งตามที่ผู้สืบสวนจัดไว้');

  // จัดเรียงใหม่ → ล้างตำแหน่งที่ลากเอง จุดกลับเข้าวง และรายงานไม่อ้างว่าจัดเองแล้ว
  await page.goto('/#/network');
  await waitGraph(page);
  await page.getByRole('button', { name: 'จัดเรียงใหม่', exact: true }).click();
  await expect(page.locator('.net-pos-status')).toContainText('ลากจุดเพื่อจัดตำแหน่งเอง');
  await page.waitForTimeout(900);
  p = await nodePos(page, t!.id);
  expect(Math.hypot(p.x - dragged.x, p.y - dragged.y)).toBeGreaterThan(20);
  await page.waitForTimeout(500);
  await page.goto('/#/report');
  await expect(caption(page)).toContainText('รูปแบบวงซ้อน', { timeout: 30_000 });
  await expect(caption(page)).not.toContainText('จัดตำแหน่งตามที่ผู้สืบสวนจัดไว้');

  expect(errors.filter((e) => !/favicon|manifest/i.test(e))).toEqual([]);
});
