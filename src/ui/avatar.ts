// แปลงรูปบุคคลที่ผู้สืบสวนเลือกเป็นรูปจัตุรัสขนาดเล็ก (data URL) — ประมวลผลในเบราว์เซอร์เท่านั้น

export const AVATAR_SIZE = 256;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

/** ส่วนกลางของภาพที่เป็นสี่เหลี่ยมจัตุรัสใหญ่ที่สุด (ภาพแนวตั้งค่อนไปทางบนเล็กน้อย เพราะหน้ามักอยู่ส่วนบน) */
export function squareCrop(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  const sx = Math.round((w - side) / 2);
  const sy = h > w ? Math.round((h - side) * 0.3) : Math.round((h - side) / 2);
  return { sx, sy, side };
}

/** อ่านไฟล์รูป → JPEG จัตุรัส ≤ size px (เบราว์เซอร์หมุนตาม EXIF ให้เมื่อเปิดผ่าน <img>) */
export async function imageFileToAvatar(file: File, size = AVATAR_SIZE): Promise<string> {
  if (file.size > MAX_INPUT_BYTES) throw new Error('ไฟล์รูปใหญ่เกิน 15 MB');
  if (file.type && !file.type.startsWith('image/')) throw new Error('ไฟล์นี้ไม่ใช่รูปภาพ');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error('เปิดรูปนี้ไม่ได้ — ลองใช้ไฟล์ JPG หรือ PNG');
    }
    const { sx, sy, side } = squareCrop(img.naturalWidth, img.naturalHeight);
    const out = Math.min(size, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('เบราว์เซอร์นี้ย่อรูปไม่ได้');
    ctx.fillStyle = '#ffffff'; // รูปโปร่งใส (PNG) ให้พื้นขาวเมื่อแปลงเป็น JPEG
    ctx.fillRect(0, 0, out, out);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
