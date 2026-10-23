import { describe, it, expect } from 'vitest';
import {
  parseAmount, parseDateTime, parseTime, combineDateAndTime, thaiDigitsToArabic,
  formatTs, formatThaiDate, formatThaiDateTime, fmtDuration, excelSerialToDateTime,
} from '../../src/core/thai';

const utc = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, m - 1, d, h, mi, s);

describe('thaiDigitsToArabic', () => {
  it('แปลงเลขไทย', () => expect(thaiDigitsToArabic('๑๒๓,๔๕๖.๗๘')).toBe('123,456.78'));
});

describe('parseAmount', () => {
  it('คอมมาและทศนิยม', () => expect(parseAmount('1,234.50')).toEqual({ value: 1234.5, sign: 0, drcr: undefined }));
  it('วงเล็บ = ติดลบ', () => expect(parseAmount('(1,234.50)')?.sign).toBe(-1));
  it('เครื่องหมายลบนำหน้า/ตามหลัง', () => {
    expect(parseAmount('-500')).toMatchObject({ value: 500, sign: -1 });
    expect(parseAmount('500-')).toMatchObject({ value: 500, sign: -1 });
  });
  it('DR/CR', () => {
    expect(parseAmount('500.00 DR')).toMatchObject({ value: 500, sign: -1, drcr: 'DR' });
    expect(parseAmount('2,000.00CR')).toMatchObject({ value: 2000, sign: 1, drcr: 'CR' });
  });
  it('สัญลักษณ์เงินตราและเลขไทย', () => {
    expect(parseAmount('฿ 12,000')?.value).toBe(12000);
    expect(parseAmount('๑,๐๐๐.๕๐')?.value).toBe(1000.5);
    expect(parseAmount('3,500 บาท')?.value).toBe(3500);
  });
  it('ค่าที่ไม่ใช่ตัวเลข → null', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('-')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('12.3.4')).toBeNull();
  });
  it('ตัวเลขจริง', () => expect(parseAmount(-42.5)).toEqual({ value: 42.5, sign: -1 }));
});

describe('parseDateTime', () => {
  it('dd/mm/yyyy ค.ศ.', () => expect(parseDateTime('05/03/2024')).toEqual({ ts: utc(2024, 3, 5), hasTime: false }));
  it('dd/mm/yyyy พ.ศ. → ค.ศ.', () => expect(parseDateTime('05/03/2567')?.ts).toBe(utc(2024, 3, 5)));
  it('ปี 2 หลักแบบ พ.ศ. (67) และ ค.ศ. (24)', () => {
    expect(parseDateTime('05/03/67')?.ts).toBe(utc(2024, 3, 5));
    expect(parseDateTime('05/03/24')?.ts).toBe(utc(2024, 3, 5));
  });
  it('บังคับโหมดปี', () => {
    expect(parseDateTime('05/03/67', { yearMode: 'ce' })?.ts).toBe(utc(2067, 3, 5));
    expect(parseDateTime('05/03/2024', { yearMode: 'be' })?.ts).toBe(utc(2024, 3, 5));
  });
  it('มีเวลาต่อท้าย', () => {
    expect(parseDateTime('05/03/2567 09:55')).toEqual({ ts: utc(2024, 3, 5, 9, 55), hasTime: true });
    expect(parseDateTime('05/03/2567 09:55:30')?.ts).toBe(utc(2024, 3, 5, 9, 55, 30));
    expect(parseDateTime('05/03/2567 09.55 น.')?.ts).toBe(utc(2024, 3, 5, 9, 55));
  });
  it('ISO', () => {
    expect(parseDateTime('2024-03-05')).toEqual({ ts: utc(2024, 3, 5), hasTime: false });
    expect(parseDateTime('2024-03-05T10:20:30')?.ts).toBe(utc(2024, 3, 5, 10, 20, 30));
    expect(parseDateTime('2024-03-05 10:20')?.hasTime).toBe(true);
  });
  it('เดือนไทยย่อ/เต็ม/อังกฤษ', () => {
    expect(parseDateTime('5 มี.ค. 67')?.ts).toBe(utc(2024, 3, 5));
    expect(parseDateTime('5 มีนาคม 2567')?.ts).toBe(utc(2024, 3, 5));
    expect(parseDateTime('05 Mar 2024')?.ts).toBe(utc(2024, 3, 5));
    expect(parseDateTime('5-Mar-24 14:30')?.ts).toBe(utc(2024, 3, 5, 14, 30));
    expect(parseDateTime('๕ ธ.ค. ๒๕๖๗')?.ts).toBe(utc(2024, 12, 5));
  });
  it('เลขไทยใน dd/mm/yyyy', () => expect(parseDateTime('๐๕/๐๓/๒๕๖๗')?.ts).toBe(utc(2024, 3, 5)));
  it('วันที่ไม่ถูกต้อง → null', () => {
    expect(parseDateTime('31/02/2567')).toBeNull();
    expect(parseDateTime('hello')).toBeNull();
    expect(parseDateTime('')).toBeNull();
  });
  it('yyyymmddhhmm', () => expect(parseDateTime('20240305 0955')?.ts).toBe(utc(2024, 3, 5, 9, 55)));
  it('Date object / Excel serial', () => {
    expect(parseDateTime(new Date(utc(2024, 3, 5, 9, 55)))?.hasTime).toBe(true);
    expect(excelSerialToDateTime(45356)).toEqual({ ts: utc(2024, 3, 5), hasTime: false });
    expect(parseDateTime(45356.5)?.ts).toBe(utc(2024, 3, 5, 12));
  });
});

describe('parseTime / combine', () => {
  it('รูปแบบเวลา', () => {
    expect(parseTime('09:55')).toEqual({ h: 9, mi: 55, s: 0 });
    expect(parseTime('9.05 น.')).toEqual({ h: 9, mi: 5, s: 0 });
    expect(parseTime('11:30 PM')).toEqual({ h: 23, mi: 30, s: 0 });
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime(0.5)).toEqual({ h: 12, mi: 0, s: 0 });
  });
  it('รวมคอลัมน์วันที่+เวลา', () => {
    expect(combineDateAndTime('05/03/2567', '09:55:10')).toEqual({ ts: utc(2024, 3, 5, 9, 55, 10), hasTime: true });
    expect(combineDateAndTime('05/03/2567', '')).toEqual({ ts: utc(2024, 3, 5), hasTime: false });
  });
});

describe('format', () => {
  const ts = utc(2024, 3, 5, 9, 5);
  it('ค.ศ./พ.ศ.', () => {
    expect(formatTs(ts, true, false, 'ce')).toBe('05/03/2024 09:05');
    expect(formatTs(ts)).toBe('05/03/2567 09:05');
  });
  it('พ.ศ.', () => {
    expect(formatThaiDate(ts)).toBe('5 มี.ค. 2567');
    expect(formatThaiDateTime(ts, true, true)).toBe('5 มีนาคม 2567 เวลา 09:05 น.');
  });
  it('ระยะเวลา', () => {
    expect(fmtDuration(30_000)).toBe('30 วินาที');
    expect(fmtDuration(10 * 60_000)).toBe('10 นาที');
    expect(fmtDuration(65 * 60_000)).toBe('1 ชม. 5 นาที');
    expect(fmtDuration(50 * 3600_000)).toBe('2 วัน 2 ชม.');
    expect(fmtDuration(null)).toBe('–');
  });
});

import { fixThaiSpacing, compactThai } from '../../src/core/thai';
describe('OCR spacing', () => {
  it('ลบช่องว่างที่เป็นไปไม่ได้ในคำไทย', () => {
    expect(fixThaiSpacing('ธนาค ารกรุงศรี')).toBe('ธนาคารกรุงศรี');
    expect(fixThaiSpacing('ท ีทีบี')).toBe('ทีทีบี');
    expect(fixThaiSpacing('เ ลข')).toBe('เลข');
    expect(fixThaiSpacing('นาย สมชาย ใจดี')).toBe('นาย สมชาย ใจดี'); // ช่องว่างระหว่างคำคงเดิม
  });
  it('compactThai ลบช่องว่างระหว่างอักษรไทยทั้งหมด แต่คงช่องว่างกับตัวเลข', () => {
    expect(compactThai('เล ขที่บัญชี : 888-8-88888-7')).toBe('เลขที่บัญชี : 888-8-88888-7');
  });
});

import { normalizeThaiGlyphs } from '../../src/core/thai';
describe('normalizeThaiGlyphs', () => {
  it('แปลง PUA ของวรรณยุกต์ และรวม นิคหิต+อา เป็นสระอำ', () => {
    expect(normalizeThaiGlyphs('ข\uF70Bอมูล')).toBe('ข\u0E49อมูล');
    expect(normalizeThaiGlyphs('ที\uF70A')).toBe('ที\u0E48');
    expect(normalizeThaiGlyphs('ทํา')).toBe('ทำ');
    expect(normalizeThaiGlyphs('a\uE123b')).toBe('ab');
  });
});
