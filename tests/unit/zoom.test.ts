// ซูมด้วยลูกกลิ้ง: เมาส์หนึ่งคลิกต้องซูมได้ชัดเจน (เดิมราว 0.7%) ทัชแพดไม่ไวเกิน และไม่กระโดด
import { describe, it, expect } from 'vitest';
import { wheelZoomFactor } from '../../src/ui/network/zoom';

const notch = (deltaY: number, speed?: 'slow' | 'normal' | 'fast') => wheelZoomFactor({ deltaY, deltaMode: 0 }, speed);

describe('wheelZoomFactor', () => {
  it('เมาส์หนึ่งคลิก (deltaY 100 px) ระดับปกติซูมออก 12–25% และหมุนกลับซูมเข้าเท่ากันพอดี', () => {
    const out = notch(100);
    expect(1 - out).toBeGreaterThan(0.12);
    expect(1 - out).toBeLessThan(0.25);
    expect(notch(-100) * out).toBeCloseTo(1, 10);
    // ไวกว่าค่าเดิมของแอป (Cytoscape wheelSensitivity 0.25 ≈ 0.7% ต่อคลิก) หลายสิบเท่า
    const old = 1 - Math.pow(10, (3 / -250) * 0.25);
    expect((1 - out) / old).toBeGreaterThan(20);
  });

  it('Firefox (นับเป็นบรรทัด 3 บรรทัดต่อคลิก) ได้ใกล้เคียงเมาส์แบบพิกเซล', () => {
    const lines = wheelZoomFactor({ deltaY: 3, deltaMode: 1 });
    expect(Math.abs(lines - notch(100))).toBeLessThan(0.08);
  });

  it('ทัชแพดก้าวเล็กเปลี่ยนน้อย; บีบนิ้ว (ctrlKey) ไวขึ้นแต่ยังพอดี', () => {
    expect(1 - notch(4)).toBeLessThan(0.02);
    const pinch = wheelZoomFactor({ deltaY: 4, deltaMode: 0, ctrlKey: true });
    expect(1 - pinch).toBeGreaterThan(1 - notch(4));
    expect(1 - pinch).toBeLessThan(0.15);
  });

  it('ช้า < ปกติ < เร็ว', () => {
    expect(1 - notch(100, 'slow')).toBeLessThan(1 - notch(100, 'normal'));
    expect(1 - notch(100, 'normal')).toBeLessThan(1 - notch(100, 'fast'));
  });

  it('ค่าผิดปกติจำกัดที่ ×0.5–×2 ต่อเหตุการณ์', () => {
    expect(notch(100000)).toBe(0.5);
    expect(notch(-100000)).toBe(2);
    expect(wheelZoomFactor({ deltaY: 5, deltaMode: 2 })).toBe(0.5);
    expect(notch(0)).toBe(1);
  });
});
