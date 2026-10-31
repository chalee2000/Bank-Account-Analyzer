// วางเมนูลอย (คลิกขวา/กดค้าง) ให้อยู่ในกรอบ และไม่ทับตำแหน่งที่คลิก ถ้าทำได้
// — ด้านขวา/ล่างของตัวชี้ก่อน; ไม่พอก็พลิกไปซ้าย/บน; ยังไม่พอ (จอเตี้ย/แคบ) ค่อยบีบให้อยู่ในกรอบ

export interface Pt { x: number; y: number }
export interface Size { w: number; h: number }

const GAP = 6;
const MARGIN = 8;

export function placeMenu(at: Pt, menu: Size, box: Size): { left: number; top: number } {
  const axis = (p: number, len: number, room: number) => {
    let v = p + GAP;
    if (v + len > room - MARGIN && p - GAP - len >= MARGIN) v = p - GAP - len;
    return Math.max(MARGIN, Math.min(v, room - len - MARGIN));
  };
  return { left: axis(at.x, menu.w, box.w), top: axis(at.y, menu.h, box.h) };
}
