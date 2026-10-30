// การตัดรูปบุคคลเป็นจัตุรัส
import { describe, it, expect } from 'vitest';
import { squareCrop } from '../../src/ui/avatar';

describe('รูปบุคคล: ตัดเป็นจัตุรัส', () => {
  it('ภาพแนวนอนตัดกลาง ภาพจัตุรัสคงเดิม', () => {
    expect(squareCrop(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 });
    expect(squareCrop(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 });
  });
  it('ภาพแนวตั้งค่อนไปทางบน (หน้ามักอยู่ส่วนบน) และไม่เกินขอบภาพ', () => {
    const c = squareCrop(300, 400);
    expect(c).toEqual({ sx: 0, sy: 30, side: 300 });
    expect(c.sy + c.side).toBeLessThanOrEqual(400);
    const tall = squareCrop(1000, 4000);
    expect(tall.sy).toBeGreaterThan(0);
    expect(tall.sy + tall.side).toBeLessThanOrEqual(4000);
  });
});
