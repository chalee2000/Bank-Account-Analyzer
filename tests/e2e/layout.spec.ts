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
  const concentric = page.getByRole('button', { name: 'วงซ้อน', exact: true });
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
  await expect(page.getByRole('button', { name: 'วงซ้อน', exact: true })).toHaveAttribute('aria-pressed', 'true');
  let p = await nodePos(page, t!.id);
  expect(p.x).toBeCloseTo(dragged.x, 0);
  expect(p.y).toBeCloseTo(dragged.y, 0);

  // สลับเป็นอัตโนมัติแล้วกลับมาวงซ้อน → ตำแหน่งของวงซ้อนยังอยู่ (เก็บแยกตามรูปแบบ)
  await page.getByRole('button', { name: 'อัตโนมัติ', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'วงซ้อน', exact: true }).click();
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

test('ผังไหลเงิน: เส้นมุมฉาก 3 ส่วน ป้ายแคปซูลมีลูกศร ลากแล้วจำ และรายงานบอกรูปแบบ', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองด้วยข้อมูลสมมติ' }).click();
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await page.goto('/#/network');
  await waitGraph(page);

  const flow = page.getByRole('button', { name: 'ผังไหลเงิน', exact: true });
  await flow.click();
  await expect(flow).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(900);

  const info = await page.evaluate((sel) => {
    const cy = (document.querySelector(sel) as any).__cy;
    const col = (c: string) => cy.nodes(`[fcol = "${c}"]`).map((n: any) => n.position('x')) as number[];
    const es = cy.edges('.flow').not('.elabel').map((e: any) => ({
      h: e.hasClass('flow-h'), back: e.hasClass('flow-back'), s: { ...e.source().position() }, t: { ...e.target().position() },
      seg: e.segmentPoints() as { x: number; y: number }[], pill: String(e.data('pillText')),
    }));
    return { src: col('src'), hub: col('hub'), sink: col('sink'), owners: cy.nodes('.owner').map((n: any) => n.data('fcol')), es, labelled: cy.edges('.lbl-plain').not('.elabel').length };
  }, HOST);
  // 3 ส่วน: ซ้าย < ขั้นบันได (เลนไม่ซ้ำ) < ขวา; เจ้าของทุกรายอยู่ขั้นบันได
  expect(info.owners.every((c: string) => c === 'hub')).toBe(true);
  expect(Math.max(...info.src)).toBeLessThan(Math.min(...info.hub));
  expect(Math.max(...info.hub)).toBeLessThan(Math.min(...info.sink));
  expect(new Set(info.hub).size).toBe(info.hub.length);
  // เส้นรูปตัว L: flow-v ดิ่งตามเลนต้นทางก่อน (มุมที่ x ต้นทาง, y ปลายทาง) / flow-h แนวนอนก่อน (มุมที่ x ปลายทาง, y ต้นทาง)
  expect(info.es.length).toBeGreaterThan(5);
  for (const e of info.es) {
    expect(e.seg.length).toBe(1);
    const c = e.seg[0]!;
    if (e.h) { expect(c.x).toBeCloseTo(e.t.x, 0); expect(c.y).toBeCloseTo(e.s.y, 0); }
    else { expect(c.x).toBeCloseTo(e.s.x, 0); expect(c.y).toBeCloseTo(e.t.y, 0); }
    expect(e.pill).toMatch(/^฿[\d,]+ \([\d,]+×\) [▸◂▴▾]$/);
  }
  // เลือกผังไหลเงินแล้วป้ายบนเส้นเปิดให้เอง
  expect(info.labelled).toBeGreaterThan(5);
  await page.screenshot({ path: shot('layout-flow') });

  // ป้ายยอดเงินอยู่บนเส้นเสมอ: ทุกเส้นที่มีป้ายมี "เส้นพาป้าย" ที่มองไม่เห็นเส้น วาดหลังเส้นเงินทุกเส้น และคลิกทะลุได้
  const carriers = () => page.evaluate((sel) => {
    const cy = (document.querySelector(sel) as any).__cy;
    const orig = cy.edges('.flow').not('.elabel');
    const maxZ = Math.max(...orig.map((e: any) => e.pstyle('z-index').value));
    const cs = cy.edges('.elabel');
    return {
      n: cs.length, labelled: orig.filter((e: any) => e.hasClass('lbl-plain') || e.hasClass('lbl-pin') || e.hasClass('lbl-card')).length,
      above: cs.every((c: any) => c.pstyle('z-index').value > maxZ), invisible: cs.every((c: any) => c.pstyle('line-opacity').value === 0),
      noEvents: cs.every((c: any) => c.pstyle('events').strValue === 'no'),
      paired: cs.every((c: any) => { const e = cy.getElementById(String(c.id()).slice(4)); return e.nonempty() && e.source().same(c.source()) && e.target().same(c.target()); }),
      card: cs.filter((c: any) => c.hasClass('lbl-card')).length,
    };
  }, HOST);
  let cr = await carriers();
  expect(cr.n).toBe(cr.labelled);
  expect(cr.n).toBeGreaterThan(5);
  expect([cr.above, cr.invisible, cr.noEvents, cr.paired]).toEqual([true, true, true, true]);

  // คลิกขวาที่ป้ายบนเส้น → ได้เมนูของเส้น (เส้นพาป้ายไม่บังการคลิก)
  const pillAt = await page.evaluate((sel) => {
    const host = document.querySelector(sel) as any;
    const cy = host.__cy;
    const r = host.getBoundingClientRect();
    const pan = cy.pan();
    const z = cy.zoom();
    for (const c of cy.edges('.elabel').toArray()) {
      const bb = c.boundingBox({ includeNodes: false, includeEdges: false, includeLabels: true, includeMainLabels: false, includeSourceLabels: true, includeTargetLabels: true });
      if (!bb || !isFinite(bb.x1) || bb.w === 0) continue;
      const x = r.left + ((bb.x1 + bb.x2) / 2) * z + pan.x;
      const y = r.top + ((bb.y1 + bb.y2) / 2) * z + pan.y;
      const hit = document.elementFromPoint(x, y);
      if (hit && host.contains(hit)) return { x, y };
    }
    return null;
  }, HOST);
  expect(pillAt, 'ต้องมีป้ายบนเส้นที่อยู่ในจอ').not.toBeNull();
  await page.mouse.click(pillAt!.x, pillAt!.y, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'เมนูของเส้น' })).toBeVisible();
  await page.keyboard.press('Escape');

  // เมนูคลิกขวาที่พื้นที่ว่าง: จัดวาง ▸ แสดงว่าใช้ผังไหลเงินอยู่ / เปลี่ยนเป็นแบบการ์ดแล้วเส้นพาป้ายตามไปด้วย
  const blank = await page.evaluate((sel) => {
    const host = document.querySelector(sel) as any;
    const cy = host.__cy;
    const r = host.getBoundingClientRect();
    const pan = cy.pan();
    const z = cy.zoom();
    for (let fy = 0.1; fy < 0.9; fy += 0.04) {
      for (let fx = 0.3; fx < 0.98; fx += 0.03) {
        const rx = r.width * fx;
        const ry = r.height * fy;
        const hit = document.elementFromPoint(r.left + rx, r.top + ry);
        if (!hit || !host.contains(hit)) continue;
        if (cy.renderer().findNearestElements((Math.round(r.left + rx) - r.left - pan.x) / z, (Math.round(r.top + ry) - r.top - pan.y) / z, true, true).length) continue;
        if (cy.nodes().some((n: any) => { const p = n.renderedPosition(); return Math.hypot(p.x - rx, p.y - ry) < 60; })) continue;
        return { x: Math.round(r.left + rx), y: Math.round(r.top + ry) };
      }
    }
    return null;
  }, HOST);
  expect(blank, 'ต้องมีพื้นที่ว่างบนผัง').not.toBeNull();
  await page.mouse.click(blank!.x, blank!.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'เมนูของผัง' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /^จัดวาง/ }).click();
  await expect(menu.getByRole('menuitemradio', { name: 'ผังไหลเงิน: เส้นมุมฉาก' })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemcheckbox', { name: 'แสดงรายละเอียดเส้นเงินทุกเส้น แบบการ์ด' }).click();
  await expect.poll(async () => (await carriers()).card).toBeGreaterThan(5);
  cr = await carriers();
  expect(cr.card).toBe(cr.n);
  expect([cr.n === cr.labelled, cr.above, cr.invisible, cr.paired]).toEqual([true, true, true, true]);
  await page.screenshot({ path: shot('layout-flow-card') });

  // ผังไหลเงินเปิดที่ซูมอ่านตัวเลขได้ (ผังยาวเห็นแค่ส่วนบนซ้าย) — กด "พอดีจอ" เพื่อเห็นทั้งผัง
  const zoomBefore = await page.evaluate((sel) => (document.querySelector(sel) as any).__cy.zoom() as number, HOST);
  expect(zoomBefore).toBeGreaterThanOrEqual(0.79);
  await page.getByRole('button', { name: 'พอดีจอ', exact: true }).click();
  await page.waitForTimeout(300);

  // ลากผู้รับรายหนึ่ง → รีโหลด → ยังเป็นผังไหลเงินและอยู่ที่เดิม
  const t = await page.evaluate((sel) => {
    const host = document.querySelector(sel) as any;
    const r = host.getBoundingClientRect();
    for (const n of host.__cy.nodes('[fcol = "sink"]').toArray()) {
      const p = n.renderedPosition();
      const x = r.left + p.x;
      const y = r.top + p.y;
      const hit = document.elementFromPoint(x, y);
      const dest = document.elementFromPoint(x - 60, y + 30);
      if (hit && host.contains(hit) && dest && host.contains(dest)) return { id: n.id() as string, x, y };
    }
    return null;
  }, HOST);
  expect(t, 'ต้องมีผู้รับที่ลากได้').not.toBeNull();
  await page.mouse.move(t!.x, t!.y);
  await page.mouse.down();
  await page.mouse.move(t!.x - 60, t!.y + 30, { steps: 8 });
  await page.mouse.up();
  const dragged = await nodePos(page, t!.id);
  await page.waitForTimeout(600);
  await page.reload();
  await waitGraph(page);
  await expect(page.getByRole('button', { name: 'ผังไหลเงิน', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const p = await nodePos(page, t!.id);
  expect(p.x).toBeCloseTo(dragged.x, 0);
  expect(p.y).toBeCloseTo(dragged.y, 0);

  // รายงาน: ภาพผังใช้ผังไหลเงิน และคำบรรยายรูปบอกรูปแบบ
  await page.goto('/#/report');
  await expect(page.locator('img[alt="ผังเครือข่ายความเชื่อมโยงระหว่างบัญชี"]')).toBeVisible({ timeout: 30_000 });
  await expect(caption(page)).toContainText('รูปแบบผังไหลเงิน');
  await expect(caption(page)).toContainText('จัดตำแหน่งตามที่ผู้สืบสวนจัดไว้');

  expect(errors.filter((e) => !/favicon|manifest/i.test(e))).toEqual([]);
});
