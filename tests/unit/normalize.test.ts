import { describe, it, expect } from 'vitest';
import {
  normalizeBank, normalizeAccountNumber, accountsCompatible, normalizeName, namesMatch,
  extractCounterparty, formatAccountNumber, buildAccountId, isPseudoAccount, cashAccountId,
} from '../../src/core/normalize';

describe('normalizeBank', () => {
  it('ชื่อไทยและอังกฤษ', () => {
    expect(normalizeBank('ธนาคารกสิกรไทย')).toBe('KBANK');
    expect(normalizeBank('SCB')).toBe('SCB');
    expect(normalizeBank('ไทยพาณิชย์')).toBe('SCB');
    expect(normalizeBank('Krungthai')).toBe('KTB');
    expect(normalizeBank('ทรูมันนี่ วอลเล็ท')).toBe('TRUEMONEY');
  });
  it('ไม่จับตัวย่อในคำอื่น', () => {
    expect(normalizeBank('scbx holdings')).toBeUndefined();
    expect(normalizeBank('')).toBeUndefined();
    expect(normalizeBank('โอนเงินทั่วไป')).toBeUndefined();
  });
});

describe('normalizeAccountNumber', () => {
  it('ตัดขีดและช่องว่าง', () => {
    expect(normalizeAccountNumber('123-4-56789-0')).toEqual({ number: '1234567890', masked: false, digitsVisible: 10 });
    expect(normalizeAccountNumber('123 4 56789 0')?.number).toBe('1234567890');
  });
  it('เลขไทย', () => expect(normalizeAccountNumber('๑๒๓-๔-๕๖๗๘๙-๐')?.number).toBe('1234567890'));
  it('ปิดบางส่วน', () => {
    const n = normalizeAccountNumber('xxx-x-x1234-x');
    expect(n).toEqual({ number: 'XXXXX1234X', masked: true, digitsVisible: 4 });
    expect(normalizeAccountNumber('***-*-**123-*')?.masked).toBe(true);
  });
  it('ปิดมากเกินไป/ไม่ใช่เลขบัญชี → null', () => {
    expect(normalizeAccountNumber('XXXXXXXX12')).toBeNull();
    expect(normalizeAccountNumber('abc')).toBeNull();
    expect(normalizeAccountNumber('')).toBeNull();
  });
});

describe('accountsCompatible', () => {
  it('เหมือนกัน', () => expect(accountsCompatible('1234567890', '1234567890')).toBe(true));
  it('ปิดบางส่วนเข้ากันได้ (ต้องให้ผู้ใช้ยืนยันก่อนรวม)', () => expect(accountsCompatible('XXXXX1234X', '1234512345')).toBe(true));
  it('ปิดบางส่วนที่ตรง', () => expect(accountsCompatible('XXXXX6789X', '1234567890')).toBe(true));
  it('ต่างกันที่หลักที่เห็น', () => expect(accountsCompatible('XXXXX6788X', '1234567890')).toBe(false));
  it('เห็นน้อยกว่า 3 หลักที่ตรงกัน → ไม่ถือว่าเข้ากันได้', () => expect(accountsCompatible('XXXXXXXX90', '1234567890')).toBe(false));
});

describe('names', () => {
  it('ตัดคำนำหน้า', () => {
    expect(normalizeName('นาย  สมชาย   ใจดี')).toBe('สมชาย ใจดี');
    expect(namesMatch('นาย สมชาย ใจดี', 'สมชาย ใจดี')).toBe(true);
    expect(namesMatch('นาย สมชาย ใจดี', 'นาย สมศักดิ์ ใจดี')).toBe(false);
    expect(namesMatch('', '')).toBe(false);
  });
});

describe('extractCounterparty', () => {
  it('ดึงธนาคาร เลขบัญชี ชื่อ', () => {
    const r = extractCounterparty('โอนเงินไป กสิกรไทย xxx-x-x1234-x นาย สมชาย ใจดี');
    expect(r.bank).toBe('KBANK');
    expect(r.accountNumber?.number).toBe('XXXXX1234X');
    expect(r.name).toBe('นาย สมชาย ใจดี');
  });
  it('ไม่มีข้อมูล', () => expect(extractCounterparty('ค่าธรรมเนียม')).toEqual({}));
  it('ไม่ตีความจำนวนเงินหรือวันที่เป็นเลขบัญชี', () => {
    expect(extractCounterparty('ถอนเงิน 5,000.00 บาท')).toEqual({});
  });
});

describe('ids', () => {
  it('format และ id', () => {
    expect(formatAccountNumber('1234567890')).toBe('123-4-56789-0');
    expect(buildAccountId('SCB', '1234567890')).toBe('SCB:1234567890');
    expect(buildAccountId(undefined, '1234567890')).toBe('?:1234567890');
    expect(isPseudoAccount(cashAccountId('SCB:1'))).toBe(true);
    expect(isPseudoAccount('SCB:1')).toBe(false);
  });
});
