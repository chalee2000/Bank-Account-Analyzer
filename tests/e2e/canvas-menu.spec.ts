// เมนูคลิกขวาที่พื้นที่ว่าง/บนเส้นของผังเครือข่าย: ป้ายเส้น (ปกติ/การ์ด), ไอคอนธนาคาร, ข้อความบนผัง, เลือกทั้งหมด, โหมดมือ
// (คดีตัวอย่างข้อมูลสมมติ)
import { test, expect, type Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shot = (name: string) => resolve(__dirname, 'screenshots', `${test.info().project.name}-${name}.png`);
const HOST = '.net-canvas [role=img]';
const NOTE = 'ทดสอบ: ถอนเงินสดหลังรับโอน — ตรวจ CCTV';
type P = { x: number; y: number };

async function waitGraph(page: Page) {
  await expect(page.locator('.net-canvas canvas').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction((sel) => ((document.querySelector(sel) as any)?.__cy?.nodes().length ?? 0) > 0, HOST);
  await page.waitForTimeout(900);
}

/** ตำแหน่งทุกจุดของผัง (ไม่รวมโน้ต) */
const graphPositions = (page: Page) =>
  page.evaluate((sel) => {
    const out: Record<string, P> = {};
    (document.querySelector(sel) as any).__cy.nodes().not('.note').forEach((n: any) => { out[n.id()] = { ...n.position() }; });
    return out;
  }, HOST);

const count = (page: Page, selector: string) =>
  page.evaluate(([sel, s]) => (document.querySelector(sel!) as any).__cy.$(s).length as number, [HOST, selector]);

/** จุดว่างบนผัง (ไม่ชนจุด/เส้น/ป้าย และไม่ถูกแผงเครื่องมือบัง) — คืนพิกัดบนหน้าจอ */
async function blankSpot(page: Page) {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel) as any;
    const cy = host.__cy;
    const r = host.getBoundingClientRect();
    const pan = cy.pan();
    const z = cy.zoom();
    for (let fy = 0.2; fy < 0.8; fy += 0.04) {
      for (let fx = 0.4; fx < 0.95; fx += 0.03) {
        const rx = r.width * fx;
        const ry = r.height * fy;
        const hit = document.elementFromPoint(r.left + rx, r.top + ry);
        if (!hit || !host.contains(hit)) continue;
        if (cy.renderer().findNearestElements((rx - pan.x) / z, (ry - pan.y) / z, true, false).length) continue;
        if (cy.nodes().some((n: any) => { const p = n.renderedPosition(); return Math.hypot(p.x - rx, p.y - ry) < 70; })) continue;
        return { x: r.left + rx, y: r.top + ry };
      }
    }
    return null;
  }, HOST);
}

/** จุดกึ่งกลางของเส้นเงินระหว่างบัญชี (ไม่ใช่เส้นสรุป) ที่คลิกถึงได้ — คืนหลายเส้นเผื่อเส้นแรกคลิกไม่โดน (ผังสุ่มตำแหน่งทุกครั้ง) */
async function edgeSpots(page: Page) {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel) as any;
    const cy = host.__cy;
    const r = host.getBoundingClientRect();
    const pan = cy.pan();
    const z = cy.zoom();
    const out: { x: number; y: number; src: string; dst: string }[] = [];
    for (const e of cy.edges().not('.agg-edge, .manual-link').toArray()) {
      const m = e.midpoint();
      const rx = m.x * z + pan.x;
      const ry = m.y * z + pan.y;
      const hit = document.elementFromPoint(r.left + rx, r.top + ry);
      if (!hit || !host.contains(hit)) continue;
      const near = cy.renderer().findNearestElements(m.x, m.y, true, false);
      if (near.length && near[0].id() === e.id()) out.push({ x: r.left + rx, y: r.top + ry, src: e.source().id() as string, dst: e.target().id() as string });
    }
    return out.slice(0, 4);
  }, HOST);
}

const canvasMenu = (page: Page) => page.getByRole('menu', { name: 'เมนูของผัง' });

async function openCanvasMenu(page: Page) {
  const s = await blankSpot(page);
  expect(s, 'ต้องมีพื้นที่ว่างบนผังให้คลิกขวา').not.toBeNull();
  await page.mouse.click(s!.x, s!.y, { button: 'right' });
  await expect(canvasMenu(page)).toBeVisible();
  return s!;
}

const expectSamePositions = (a: Record<string, P>, b: Record<string, P>) => {
  expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
  for (const [id, p] of Object.entries(a)) {
    expect(b[id]!.x, id).toBeCloseTo(p.x, 1);
    expect(b[id]!.y, id).toBeCloseTo(p.y, 1);
  }
};

test('คลิกขวาที่พื้นที่ว่าง/เส้น: ป้ายเส้น การ์ด ไอคอนธนาคาร ข้อความบนผัง เลือกทั้งหมด และโหมดมือ', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.getByRole('button', { name: 'ทดลองด้วยข้อมูลสมมติ' }).click();
  await expect(page.getByText('ภาพรวมคดี')).toBeVisible();
  await page.goto('/#/network');
  await waitGraph(page);
  const pos0 = await graphPositions(page);

  // เมนูของผังมีคำสั่งครบ และไม่มีคำสั่งของเส้น
  await openCanvasMenu(page);
  const menu = canvasMenu(page);
  for (const name of ['เพิ่มข้อความตรงนี้…', 'แสดงรายละเอียดเส้นเงินทุกเส้น', 'แสดงรายละเอียดเส้นเงินทุกเส้น แบบการ์ด', 'เลือกทั้งหมด', 'โหมดมือ: ลากเลื่อนผัง', 'จัดวาง', 'พอดีจอ', 'แสดงไอคอนธนาคารทุกโหนด']) {
    await expect(menu.locator('button', { hasText: name }).first()).toBeVisible();
  }
  await expect(menu.getByRole('menuitem', { name: 'ดูธุรกรรมของเส้นนี้' })).toHaveCount(0);
  await expect(menu.getByRole('menuitemcheckbox', { name: /โหมดมือ/ })).toHaveAttribute('aria-checked', 'true');
  // จัดวาง ▸ ขยายเมนูย่อย
  await menu.getByRole('menuitem', { name: /^จัดวาง/ }).click();
  await expect(menu.getByRole('menuitemradio', { name: 'อัตโนมัติ' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitem', { name: 'จัดเรียงใหม่' })).toBeVisible();
  await page.screenshot({ path: shot('canvas-menu') });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // เมนูคลิกขวาของเบราว์เซอร์ต้องไม่ขึ้นทับ: เมนูไม่อยู่ใต้ตัวชี้ และ contextmenu ในพื้นที่ผัง (รวมบนเมนู/คำอธิบายสี) ถูกยกเลิก
  // (Playwright ไม่แสดงเมนูของเบราว์เซอร์ จึงตรวจที่ตัวเหตุการณ์แทน)
  const corner = await page.evaluate((sel) => {
    const r = (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
    return { x: Math.round(r.right - 24), y: Math.round(r.bottom - 24) };
  }, HOST);
  for (const p of [await blankSpot(page), corner]) {
    await page.mouse.click(p!.x, p!.y, { button: 'right' });
    await expect(canvasMenu(page)).toBeVisible();
    const b = (await canvasMenu(page).boundingBox())!;
    expect(p!.x >= b.x && p!.x <= b.x + b.width && p!.y >= b.y && p!.y <= b.y + b.height, 'เมนูต้องไม่ทับจุดที่คลิก').toBe(false);
    const prevented = await page.evaluate(([x, y]) => {
      const fire = (el: Element | null) => !!el && !el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
      return { atPointer: fire(document.elementFromPoint(x!, y!)), onMenu: fire(document.querySelector('.ctx-menu button')), legend: fire(document.querySelector('.net-legend')) };
    }, [p!.x, p!.y]);
    expect(prevented).toEqual({ atPointer: true, onMenu: true, legend: true });
    await page.keyboard.press('Escape');
    await expect(canvasMenu(page)).toBeHidden();
  }

  // ป้ายเส้นทุกเส้น → แบบการ์ด → ไอคอนธนาคาร: ไม่จัดผังใหม่
  await openCanvasMenu(page);
  await canvasMenu(page).getByRole('menuitemcheckbox', { name: 'แสดงรายละเอียดเส้นเงินทุกเส้น', exact: true }).click();
  await expect.poll(() => count(page, 'edge.lbl-plain')).toBeGreaterThan(0);
  await openCanvasMenu(page);
  await expect(canvasMenu(page).getByRole('menuitemcheckbox', { name: 'แสดงรายละเอียดเส้นเงินทุกเส้น', exact: true })).toHaveAttribute('aria-checked', 'true');
  await canvasMenu(page).getByRole('menuitemcheckbox', { name: 'แสดงรายละเอียดเส้นเงินทุกเส้น แบบการ์ด' }).click();
  await expect.poll(() => count(page, 'edge.lbl-card')).toBeGreaterThan(0);
  expect(await count(page, 'edge.lbl-plain')).toBe(0);
  await openCanvasMenu(page);
  await canvasMenu(page).getByRole('menuitemcheckbox', { name: 'แสดงไอคอนธนาคารทุกโหนด' }).click();
  await expect.poll(() => count(page, 'node[badge]')).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  expectSamePositions(pos0, await graphPositions(page));
  await page.screenshot({ path: shot('canvas-card-badges') });

  // เพิ่มข้อความตรงนี้ → โน้ตอยู่ที่ตำแหน่งที่คลิก
  const at = await openCanvasMenu(page);
  await canvasMenu(page).getByRole('menuitem', { name: 'เพิ่มข้อความตรงนี้…' }).click();
  const dlg = page.getByRole('dialog', { name: 'เพิ่มข้อความบนผัง' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'บันทึก' })).toBeDisabled();
  await dlg.getByLabel('ข้อความ').fill(NOTE);
  await dlg.getByRole('button', { name: 'บันทึก' }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(() => count(page, 'node.note')).toBe(1);
  const noteAt = await page.evaluate((sel) => {
    const host = document.querySelector(sel) as any;
    const r = host.getBoundingClientRect();
    const n = host.__cy.nodes('.note')[0];
    const p = n.renderedPosition();
    return { x: r.left + p.x, y: r.top + p.y, label: n.data('label') as string };
  }, HOST);
  expect(noteAt.label).toBe(NOTE);
  expect(Math.hypot(noteAt.x - at.x, noteAt.y - at.y)).toBeLessThan(3);

  // ลากโน้ตไปที่ใหม่ แล้วรีโหลด → โน้ต ป้ายการ์ด ไอคอน ยังอยู่ และจุดของผังไม่ขยับ
  await page.mouse.move(noteAt.x, noteAt.y);
  await page.mouse.down();
  await page.mouse.move(noteAt.x - 60, noteAt.y + 40, { steps: 8 });
  await page.mouse.up();
  const notePos = await page.evaluate((sel) => ({ ...(document.querySelector(sel) as any).__cy.nodes('.note')[0].position() }) as P, HOST);
  await page.waitForTimeout(700);
  expectSamePositions(pos0, await graphPositions(page));
  await page.screenshot({ path: shot('canvas-note') });
  await page.reload();
  await waitGraph(page);
  expect(await count(page, 'node.note')).toBe(1);
  const reloaded = await page.evaluate((sel) => ({ ...(document.querySelector(sel) as any).__cy.nodes('.note')[0].position() }) as P, HOST);
  expect(reloaded.x).toBeCloseTo(notePos.x, 0);
  expect(reloaded.y).toBeCloseTo(notePos.y, 0);
  expect(await count(page, 'edge.lbl-card')).toBeGreaterThan(0);
  expect(await count(page, 'node[badge]')).toBeGreaterThan(0);
  expectSamePositions(pos0, await graphPositions(page));

  // เมนูของโน้ต: แก้ข้อความ
  const nAt = await page.evaluate((sel) => {
    const host = document.querySelector(sel) as any;
    const r = host.getBoundingClientRect();
    const p = host.__cy.nodes('.note')[0].renderedPosition();
    return { x: r.left + p.x, y: r.top + p.y };
  }, HOST);
  await page.mouse.click(nAt.x, nAt.y, { button: 'right' });
  const noteMenu = page.getByRole('menu', { name: 'เมนูของข้อความบนผัง' });
  await expect(noteMenu.getByRole('menuitem', { name: 'ลบข้อความ' })).toBeVisible();
  await noteMenu.getByRole('menuitem', { name: 'แก้ข้อความ…' }).click();
  const edit = page.getByRole('dialog', { name: 'แก้ข้อความบนผัง' });
  await expect(edit.getByLabel('ข้อความ')).toHaveValue(NOTE);
  await edit.getByLabel('ข้อความ').fill(NOTE + ' (แก้)');
  await edit.getByRole('button', { name: 'บันทึก' }).click();
  await expect.poll(() => page.evaluate((sel) => (document.querySelector(sel) as any).__cy.nodes('.note')[0].data('label'), HOST)).toBe(NOTE + ' (แก้)');

  // เลือกทั้งหมด (Ctrl+A) / Esc ยกเลิก / H สลับโหมดมือ ↔ โหมดเลือก
  await page.keyboard.press('Control+a');
  expect(await count(page, 'node:selected')).toBe(await count(page, 'node'));
  await page.keyboard.press('Escape');
  expect(await count(page, ':selected')).toBe(0);
  await page.keyboard.press('h');
  await expect(page.locator('.net-mode')).toBeVisible();
  await expect.poll(() => page.evaluate((sel) => (document.querySelector(sel) as any).__cy.userPanningEnabled(), HOST)).toBe(false);
  await openCanvasMenu(page);
  await expect(canvasMenu(page).getByRole('menuitemcheckbox', { name: /โหมดมือ/ })).toHaveAttribute('aria-checked', 'false');
  await canvasMenu(page).getByRole('menuitemcheckbox', { name: /โหมดมือ/ }).click();
  await expect(page.locator('.net-mode')).toBeHidden();
  await expect.poll(() => page.evaluate((sel) => (document.querySelector(sel) as any).__cy.userPanningEnabled(), HOST)).toBe(true);
  // คำสั่งเลือกทั้งหมดในเมนู
  await openCanvasMenu(page);
  await canvasMenu(page).getByRole('menuitem', { name: /เลือกทั้งหมด/ }).click();
  expect(await count(page, 'node:selected')).toBe(await count(page, 'node'));
  await page.keyboard.press('Escape');

  // คลิกขวาบนเส้น → คำสั่งของเส้นอยู่ด้านบน → ดูธุรกรรมของคู่บัญชีนั้น
  const spots = await edgeSpots(page);
  expect(spots.length, 'ต้องมีเส้นที่คลิกขวาได้').toBeGreaterThan(0);
  const edgeMenu = page.getByRole('menu', { name: 'เมนูของเส้น' });
  let e: (typeof spots)[number] | undefined;
  for (const c of spots) {
    await page.mouse.click(c.x, c.y, { button: 'right' });
    if (await edgeMenu.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) { e = c; break; }
    console.log('คลิกขวาที่เส้นแล้วเมนูไม่ขึ้น ลองเส้นถัดไป', JSON.stringify(c), await page.evaluate(() => document.querySelector('.ctx-menu')?.getAttribute('aria-label') ?? 'ไม่มีเมนู'));
    await page.keyboard.press('Escape');
  }
  expect(e, 'คลิกขวาที่เส้นต้องเปิดเมนูของเส้น').toBeDefined();
  await expect(edgeMenu).toBeVisible();
  await expect(edgeMenu.locator('.ctx-head')).toContainText('→');
  await expect(edgeMenu.getByRole('menuitemcheckbox', { name: 'แสดงรายละเอียดเส้นนี้ตลอด' })).toBeVisible();
  await expect(edgeMenu.getByRole('menuitem', { name: 'เพิ่มข้อความตรงนี้…' })).toBeVisible();
  await page.screenshot({ path: shot('canvas-edge-menu') });
  await edgeMenu.getByRole('menuitem', { name: 'ดูธุรกรรมของเส้นนี้' }).click();
  await page.waitForURL(/#\/transactions\?/);
  const q = new URLSearchParams(page.url().split('?')[1]);
  expect(q.get('acc')).toBe(e!.src);
  expect(q.get('to')).toBe(e!.dst);

  // รายงาน: ภาพผังมีโน้ต และมีรายการข้อความประกอบผัง
  await page.goto('/#/report');
  await expect(page.locator('img[alt="ผังเครือข่ายความเชื่อมโยงระหว่างบัญชี"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.rpt-notes')).toContainText('ข้อความประกอบผัง');
  await expect(page.locator('.rpt-notes li')).toHaveText([NOTE + ' (แก้)']);

  expect(errors.filter((x) => !/favicon|manifest/i.test(x))).toEqual([]);
});
