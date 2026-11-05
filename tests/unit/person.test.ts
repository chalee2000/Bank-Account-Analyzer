// เลขประจำตัวประชาชนและพิกัดที่อยู่ที่ผู้สืบสวนกรอก (ข้อมูลสมมติ) — ตรวจรูปแบบเพื่อเตือนพิมพ์ผิด
import { describe, it, expect } from 'vitest';
import { draftOf, formatLatLng, formatThaiId, geoHint, idCardHint, isValidThaiId, noteOf, parseLatLng, thaiIdDigits } from '../../src/core/person';

describe('เลขประจำตัวประชาชน', () => {
  it('หลักสุดท้ายตามสูตรถ่วงน้ำหนัก 13..2', () => {
    expect(isValidThaiId('1234567890121')).toBe(true);
    expect(isValidThaiId('1234567890123')).toBe(false);
    expect(isValidThaiId('123456789012')).toBe(false);
    expect(isValidThaiId('12345678901a1')).toBe(false);
  });
  it('ตัดขีด/ช่องว่าง และจัดรูปแบบ 1-2345-67890-12-1', () => {
    expect(thaiIdDigits('1-2345 67890-12-1')).toBe('1234567890121');
    expect(formatThaiId('1234567890121')).toBe('1-2345-67890-12-1');
    expect(formatThaiId('12345')).toBe('12345');
  });
  it('คำเตือนใต้ช่อง: ไม่ครบ 13 หลัก / หลักตรวจสอบไม่ตรง / ถูกต้อง', () => {
    expect(idCardHint('')).toBeNull();
    expect(idCardHint('12345')).toEqual({ text: 'ควรเป็นตัวเลข 13 หลัก', warn: true });
    expect(idCardHint('1234567890123')!.warn).toBe(true);
    expect(idCardHint('1-2345-67890-12-1')).toEqual({ text: 'รูปแบบถูกต้อง: 1-2345-67890-12-1', warn: false });
  });
});

describe('พิกัดที่อยู่', () => {
  it('อ่านได้หลายรูปแบบ รวมลิงก์แผนที่', () => {
    for (const s of ['13.7563, 100.5018', '13.7563 100.5018', '(13.7563,100.5018)', 'https://maps.example/@13.7563,100.5018,17z', 'https://maps.example/?q=13.7563,100.5018']) {
      expect(parseLatLng(s), s).toEqual({ lat: 13.7563, lng: 100.5018 });
    }
    expect(parseLatLng('-33.8, 151.2')).toEqual({ lat: -33.8, lng: 151.2 });
  });
  it('นอกช่วงหรือไม่ใช่ตัวเลข → null และมีคำเตือน', () => {
    expect(parseLatLng('95, 100')).toBeNull();
    expect(parseLatLng('13.7, 190')).toBeNull();
    expect(parseLatLng('บ้านเลขที่ 9')).toBeNull();
    expect(geoHint('บ้านเลขที่ 9')!.warn).toBe(true);
    expect(geoHint('13.7563, 100.5018')).toEqual({ text: 'ละติจูด 13.756300 · ลองจิจูด 100.501800', warn: false });
    expect(formatLatLng({ lat: 13.7563, lng: 100.5018 })).toBe('13.756300, 100.501800');
  });
});

describe('บันทึกข้อมูลบุคคล', () => {
  it('เลขบัตรครบเก็บเป็นตัวเลขล้วน พิกัดเก็บแบบมาตรฐาน ข้อความตัดช่องว่าง; เปิดอีกครั้งเลขบัตรแสดงแบบมีขีด', () => {
    const n = noteOf({ idCard: ' 1-2345-67890-12-1 ', label: ' นายสมมติ ', address: ' 9 ถนนสมมติ ', geo: '13.7563 100.5018', note: '', photo: undefined });
    expect(n).toEqual({ idCard: '1234567890121', label: 'นายสมมติ', address: '9 ถนนสมมติ', geo: '13.756300, 100.501800', note: '', photo: '' });
    expect(draftOf(n).idCard).toBe('1-2345-67890-12-1');
    // กรอกไม่ครบ/อ่านพิกัดไม่ได้ → เก็บตามที่กรอก (ข้อมูลจากหลักฐานอาจไม่ครบ)
    const raw = noteOf({ idCard: '12345', label: '', address: '', geo: 'ใกล้ตลาด', note: '', photo: undefined });
    expect(raw.idCard).toBe('12345');
    expect(raw.geo).toBe('ใกล้ตลาด');
  });
});
