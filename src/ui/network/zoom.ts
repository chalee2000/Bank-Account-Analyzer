// ซูมผังด้วยลูกกลิ้งเมาส์/ทัชแพด — สูตรเดียวกับ d3-zoom (มาตรฐานของเว็บแผนที่/ผัง)
// Cytoscape ตั้ง wheelSensitivity ค่าเดียวใช้ทั้งเมาส์และทัชแพด และลดทอนลูกกลิ้งเมาส์ทั่วไปอีกชั้น
// (ที่ 0.25 เดิมซูมราว 0.7% ต่อคลิก) จึงจัดการลูกกลิ้งเองแทน

export type ZoomSpeed = 'slow' | 'normal' | 'fast';

/** ตัวคูณความไว: ปกติ ≈ 18% ต่อคลิกของเมาส์ (deltaY 100 px), เร็ว ≈ 28%, ช้า ≈ 8% */
export const ZOOM_SPEED: Record<ZoomSpeed, number> = { slow: 0.6, normal: 1.4, fast: 2.4 };
export const ZOOM_SPEED_LABEL: Record<ZoomSpeed, string> = { slow: 'ช้า', normal: 'ปกติ', fast: 'เร็ว' };

/**
 * ตัวคูณซูมของเหตุการณ์ wheel หนึ่งครั้ง (> 1 = ขยาย)
 * deltaMode: 0 = พิกเซล, 1 = บรรทัด (Firefox), 2 = หน้า; ctrlKey = บีบนิ้วบนทัชแพด (เบราว์เซอร์ส่งค่าเล็ก ๆ ถี่ ๆ)
 * จำกัดที่ ×0.5–×2 ต่อเหตุการณ์ กันผังกระโดดเมื่อได้ค่าผิดปกติ
 */
export function wheelZoomFactor(e: { deltaY: number; deltaMode: number; ctrlKey?: boolean }, speed: ZoomSpeed = 'normal'): number {
  const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.002;
  const k = Math.pow(2, -e.deltaY * unit * (e.ctrlKey ? 10 : 1) * ZOOM_SPEED[speed]);
  return Math.min(2, Math.max(0.5, k));
}

const KEY = 'baa.zoomSpeed';

/** ความไวการซูมที่เลือกไว้ในเบราว์เซอร์นี้ (ขึ้นกับเมาส์/ทัชแพดของเครื่อง ไม่ใช่ข้อมูลคดี) */
export function loadZoomSpeed(): ZoomSpeed {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'slow' || v === 'fast' || v === 'normal' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveZoomSpeed(v: ZoomSpeed): void {
  try { localStorage.setItem(KEY, v); } catch { /* เบราว์เซอร์ไม่ให้เก็บ — ใช้ค่าในหน้านี้ต่อไป */ }
}
