// ข้อมูลบุคคลที่ผู้สืบสวนบันทึกเอง: เลขประจำตัวประชาชน และพิกัดที่อยู่ — ตรวจรูปแบบเพื่อเตือนพิมพ์ผิด (ไม่ได้ยืนยันตัวตน)
import type { AccountNote } from '../store/model';

/** ตัดขีด/ช่องว่างออกจากเลขบัตรประชาชน */
export const thaiIdDigits = (s: string): string => s.replace(/[\s-]/g, '');

/** เลขประจำตัวประชาชน 13 หลัก: หลักสุดท้ายต้องตรงกับผลรวมถ่วงน้ำหนัก (13..2) — ใช้ตรวจการพิมพ์ผิด */
export function isValidThaiId(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

/** แสดงแบบ 1-2345-67890-12-3 (ถ้าไม่ใช่ 13 หลัก แสดงตามที่กรอก) */
export function formatThaiId(s: string): string {
  const d = thaiIdDigits(s);
  return /^\d{13}$/.test(d) ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : s;
}

/**
 * อ่านพิกัด "ละติจูด, ลองจิจูด" — รับ "13.7563, 100.5018", "13.7563 100.5018", "(13.7563,100.5018)"
 * และลิงก์แผนที่ที่มี "@13.7563,100.5018" หรือ "q=13.7563,100.5018"; คืน null ถ้าไม่ใช่สองตัวเลขในช่วงที่ถูกต้อง
 */
export function parseLatLng(s: string): { lat: number; lng: number } | null {
  const t = s.trim();
  if (!t) return null;
  const m = /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(t)
    ?? /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(t)
    ?? /^\(?\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*\)?$/.exec(t);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export const formatLatLng = (p: { lat: number; lng: number }): string => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;

// ---------- ร่างในหน้าต่างแก้ไข (ไม่มีส่วนที่ต้องใช้เบราว์เซอร์ จึงทดสอบแบบ unit ได้) ----------

export interface PersonDraft {
  idCard: string;
  label: string;
  address: string;
  geo: string;
  note: string;
  photo?: string;
}

export const draftOf = (n: AccountNote | undefined): PersonDraft => ({
  idCard: n?.idCard ? formatThaiId(n.idCard) : '', label: n?.label ?? '', address: n?.address ?? '', geo: n?.geo ?? '', note: n?.note ?? '', photo: n?.photo,
});

/** ค่าที่บันทึก: ค่าว่างแปลว่าลบ (setAccountNote ลบคีย์ที่ว่างให้); เลขบัตรครบ 13 หลักเก็บเป็นตัวเลขล้วน, พิกัดที่อ่านได้เก็บแบบมาตรฐาน */
export const noteOf = (d: PersonDraft): AccountNote => {
  const digits = thaiIdDigits(d.idCard.trim());
  const ll = parseLatLng(d.geo);
  return {
    idCard: /^\d{13}$/.test(digits) ? digits : d.idCard.trim(),
    label: d.label.trim(),
    address: d.address.trim(),
    geo: ll ? formatLatLng(ll) : d.geo.trim(),
    note: d.note.trim(),
    photo: d.photo ?? '',
  };
};

/** คำเตือน/คำยืนยันใต้ช่องเลขบัตร (ไม่บังคับ — ข้อมูลจากหลักฐานอาจไม่ครบ) */
export function idCardHint(s: string): { text: string; warn: boolean } | null {
  const d = thaiIdDigits(s.trim());
  if (!d) return null;
  if (!/^\d{13}$/.test(d)) return { text: 'ควรเป็นตัวเลข 13 หลัก', warn: true };
  return isValidThaiId(d) ? { text: 'รูปแบบถูกต้อง: ' + formatThaiId(d), warn: false } : { text: 'หลักตรวจสอบ (หลักสุดท้าย) ไม่ตรง — ตรวจทานการพิมพ์อีกครั้ง', warn: true };
}

/** คำเตือน/คำยืนยันใต้ช่องพิกัด */
export function geoHint(s: string): { text: string; warn: boolean } | null {
  if (!s.trim()) return null;
  const ll = parseLatLng(s);
  return ll ? { text: `ละติจูด ${ll.lat.toFixed(6)} · ลองจิจูด ${ll.lng.toFixed(6)}`, warn: false } : { text: 'ใส่เป็น ละติจูด, ลองจิจูด เช่น 13.756331, 100.501765', warn: true };
}

