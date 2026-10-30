// คลิกขวาที่จุดบัญชีบนผังเครือข่าย → ตั้งชื่อ-นามสกุล + ใส่รูปบุคคล (คดีตัวอย่างข้อมูลสมมติ, รูปสังเคราะห์สีม่วงแดงล้วน)
import { test, expect, type Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shot = (name: string) => resolve(__dirname, 'screenshots', `${test.info().project.name}-${name}.png`);
const NAME = 'นายทดสอบ ภาพบุคคล';
const HOST = '.net-canvas [role=img]';

type Pos = Record<string, { x: number; y: number }>;

/** รอให้ผังจัดวางเสร็จ แล้วคืนตำแหน่งทุกจุด */
async function positions(page: Page): Promise<Pos> {
  await page.waitForFunction((sel) => {
    const cy = (document.querySelector(sel) as HTMLElement & { __cy?: { nodes: () => { length: number } } })?.__cy;
    return !!cy && cy.nodes().length > 0;
  }, HOST);
  await page.waitForTimeout(800);
  return page.evaluate((sel) => {
    const cy = (document.querySelector(sel) as any).__cy;
    const out: Record<string, { x: number; y: number }> = {};
    cy.nodes().forEach((n: any) => { out[n.id()] = { ...n.position() }; });
    return out;
  }, HOST);
}

/** จุดคู่บัญชี (ไม่ใช่เจ้าของ) ที่ไม่ถูกแผงเครื่องมือ/คำอธิบายสีบัง — คืน id และพิกัดบนหน้าจอ */
async function pickPlainNode(page: Page) {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel) as any;
    const r = host.getBoundingClientRect();
    for (const n of host.__cy.nodes('.plain').toArray()) {
      if (n.data('kind') !== 'account') continue;
      const p = n.renderedPosition();
      const x = r.left + p.x;
      const y = r.top + p.y;
      const hit = document.elementFromPoint(x, y);
      if (hit && host.contains(hit)) return { id: n.id() as string, x, y };
    }
    return null;
  }, HOST);
}

/** นับพิกุลสีม่วงแดง (สีของรูปทดสอบ ไม่มีในชุดสีของผัง) ในภาพ data URL */
async function magentaPixels(page: Page, dataUrl: string): Promise<number> {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! < 80 && d[i + 2]! > 200) n++;
    return n;
  }, dataUrl);
}

const networkPng = (page: Page) => page.evaluate((sel) => (document.querySelector(sel) as any).__cy.png({ output: 'base64uri', full: true, scale: 1 }) as string, HOST);

test('คลิกขวาที่จุดบัญชี → ตั้งชื่อ-นามสกุลและใส่รูปบุคคล โดยผังไม่จัดวางใหม่ และแสดงในแผงบัญชี/รายงานตามตัวเลือก', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองด้วยข้อมูลสมมติ' }).click();
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await page.goto('/#/network');
  await expect(page.locator('.net-canvas canvas').first()).toBeVisible({ timeout: 20_000 });
  const before = await positions(page);
  const target = await pickPlainNode(page);
  expect(target, 'ต้องมีจุดคู่บัญชีที่คลิกได้').not.toBeNull();

  // คลิกขวา → เมนู → หน้าต่างตั้งชื่อ/ใส่รูป
  await page.mouse.click(target!.x, target!.y, { button: 'right' });
  const menu = page.locator('.ctx-menu');
  await expect(menu).toBeVisible();
  await page.screenshot({ path: shot('person-menu') });
  await menu.getByRole('menuitem', { name: /ตั้งชื่อ-นามสกุล \/ ใส่รูปบุคคล/ }).click();
  const modal = page.getByRole('dialog', { name: 'ชื่อ-นามสกุล และรูปบุคคล' });
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder('เช่น นายสมมติ ตัวอย่าง').fill(NAME);
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 160;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ff00ff';
    g.fillRect(0, 0, 120, 160);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  await modal.locator('input[type=file]').setInputFiles({ name: 'face.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(modal.locator('img.person-photo')).toHaveAttribute('src', /^data:image\/jpeg/);
  await page.screenshot({ path: shot('person-modal') });
  await modal.getByRole('button', { name: 'บันทึก' }).click();
  await expect(modal).toBeHidden();

  // จุดเดิมได้ชื่อและรูป และทุกจุดอยู่ที่เดิม (ไม่จัดวางใหม่)
  const node = await page.evaluate(([sel, id]) => {
    const n = (document.querySelector(sel!) as any).__cy.getElementById(id);
    return { label: n.data('label') as string, photo: (n.data('photo') ?? '') as string };
  }, [HOST, target!.id]);
  expect(node.label.split('\n')[0]).toBe(NAME);
  expect(node.photo).toMatch(/^data:image\/jpeg;base64,/);
  const after = await positions(page);
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  for (const [id, p] of Object.entries(before)) {
    expect(after[id]!.x).toBeCloseTo(p.x, 3);
    expect(after[id]!.y).toBeCloseTo(p.y, 3);
  }
  // รูปถูกวาดบนผังจริง
  await expect.poll(async () => magentaPixels(page, await networkPng(page)), { timeout: 10_000 }).toBeGreaterThan(100);
  await page.screenshot({ path: shot('person-node') });

  // แผงรายละเอียดบัญชีแสดงรูปและชื่อ
  await page.mouse.click(target!.x, target!.y);
  const panel = page.locator('.inspector');
  await expect(panel.locator(`img.person-photo[alt="รูปของ ${NAME}"]`).first()).toBeVisible();
  await expect(panel.getByText(NAME, { exact: true }).first()).toBeVisible();

  // รีโหลดแล้วยังอยู่ (เก็บใน IndexedDB)
  await page.reload();
  await expect(page.locator('.net-canvas canvas').first()).toBeVisible({ timeout: 20_000 });
  await positions(page);
  const persisted = await page.evaluate(([sel, id]) => {
    const n = (document.querySelector(sel!) as any).__cy.getElementById(id);
    return { label: n.data('label') as string, photo: (n.data('photo') ?? '') as string };
  }, [HOST, target!.id]);
  expect(persisted.label.split('\n')[0]).toBe(NAME);
  expect(persisted.photo).toMatch(/^data:image\/jpeg/);

  // รายงาน: ค่าเริ่มต้นไม่มีรูปในภาพผัง → ติ๊กตัวเลือกแล้วมี
  await page.goto('/#/report');
  const netImg = page.locator('img[alt="ผังเครือข่ายความเชื่อมโยงระหว่างบัญชี"]');
  await expect(netImg).toBeVisible({ timeout: 30_000 });
  expect(await magentaPixels(page, (await netImg.getAttribute('src'))!)).toBe(0);
  await page.getByText('เลือกส่วนที่จะรวมในรายงาน').click();
  const srcOff = await netImg.getAttribute('src');
  await page.getByLabel('รูปบุคคลในผังความเชื่อมโยง').check();
  await expect.poll(async () => netImg.getAttribute('src'), { timeout: 30_000 }).not.toBe(srcOff);
  expect(await magentaPixels(page, (await netImg.getAttribute('src'))!)).toBeGreaterThan(50);

  expect(errors.filter((e) => !/favicon|manifest/i.test(e))).toEqual([]);
});
