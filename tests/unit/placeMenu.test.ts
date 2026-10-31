// เมนูคลิกขวาต้องไม่ทับตำแหน่งที่คลิก (ไม่เช่นนั้นเมนูของเบราว์เซอร์บน Windows จะเด้งทับ) และต้องอยู่ในกรอบผัง
import { describe, it, expect } from 'vitest';
import { placeMenu } from '../../src/ui/placeMenu';

const box = { w: 1000, h: 700 };
const menu = { w: 300, h: 420 };
const covers = (p: { x: number; y: number }, r: { left: number; top: number }) =>
  p.x >= r.left && p.x <= r.left + menu.w && p.y >= r.top && p.y <= r.top + menu.h;
const inside = (r: { left: number; top: number }) => r.left >= 8 && r.top >= 8 && r.left + menu.w <= box.w - 8 && r.top + menu.h <= box.h - 8;

describe('ตำแหน่งเมนูลอย', () => {
  it('มีที่พอ → ขวา-ล่างของตัวชี้ ห่าง 6 px', () => {
    expect(placeMenu({ x: 100, y: 100 }, menu, box)).toEqual({ left: 106, top: 106 });
  });

  it('ชิดขอบขวา/ล่าง → พลิกไปซ้าย/บนของตัวชี้ ไม่ทับจุดที่คลิก และอยู่ในกรอบ', () => {
    for (const p of [{ x: 950, y: 100 }, { x: 100, y: 650 }, { x: 990, y: 690 }, { x: 500, y: 600 }]) {
      const r = placeMenu(p, menu, box);
      expect(covers(p, r), JSON.stringify(p)).toBe(false);
      expect(inside(r)).toBe(true);
    }
    expect(placeMenu({ x: 950, y: 100 }, menu, box).left).toBe(950 - 6 - 300);
    expect(placeMenu({ x: 100, y: 650 }, menu, box).top).toBe(650 - 6 - 420);
  });

  it('ทุกจุดบนผังที่มีที่ด้านใดด้านหนึ่ง → ไม่ทับจุดที่คลิก', () => {
    for (let x = 0; x <= box.w; x += 25) {
      for (let y = 0; y <= box.h; y += 25) {
        const r = placeMenu({ x, y }, menu, box);
        expect(inside(r)).toBe(true);
        const roomX = x + 6 + menu.w <= box.w - 8 || x - 6 - menu.w >= 8;
        const roomY = y + 6 + menu.h <= box.h - 8 || y - 6 - menu.h >= 8;
        // มีที่ด้านซ้าย/ขวา → ตัวชี้อยู่นอกช่วงกว้างของเมนู; มีที่ด้านบน/ล่าง → อยู่นอกช่วงสูง — ด้านใดด้านหนึ่งพอก็ไม่ทับ
        if (roomX) expect(x < r.left || x > r.left + menu.w, `${x},${y}`).toBe(true);
        if (roomY) expect(y < r.top || y > r.top + menu.h, `${x},${y}`).toBe(true);
        if (roomX || roomY) expect(covers({ x, y }, r)).toBe(false);
      }
    }
  });

  it('เมนูสูงกว่ากรอบ (จอเตี้ย) → ชิดขอบบนในกรอบ ไม่ล้นออกนอก', () => {
    const r = placeMenu({ x: 100, y: 200 }, { w: 300, h: 900 }, box);
    expect(r.top).toBe(8);
    expect(r.left).toBe(106);
  });
});
