// ถอดรหัสไฟล์ OOXML (.xlsx) ที่ตั้งรหัสผ่านแบบ Office 2010+ ("Agile Encryption", MS-OFFCRYPTO §2.3.4.10–13)
// ทำงานในเครื่องทั้งหมด ไม่ส่งรหัสผ่านหรือไฟล์ออกนอกอุปกรณ์
// ใช้ SHA/AES แบบ synchronous (noble) เพราะต้องวน hash ~100,000 รอบ — เร็วกว่า WebCrypto แบบ async มาก
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { cbc } from '@noble/ciphers/aes.js';
import { parseCfb, type Cfb } from './cfb';
import { FilePasswordError, UnsupportedFileError } from './errors';

type Hash = (data: Uint8Array) => Uint8Array;
const HASHES: Record<string, Hash> = { SHA1: sha1, SHA256: sha256, SHA384: sha384, SHA512: sha512 };

/** ค่าคงที่ "block key" ที่สเปกกำหนดสำหรับแต่ละขั้นของการหา key */
const BLOCK_KEY_VERIFIER_INPUT = Uint8Array.of(0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79);
const BLOCK_KEY_VERIFIER_VALUE = Uint8Array.of(0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e);
const BLOCK_KEY_ENCRYPTED_KEY = Uint8Array.of(0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6);
const SEGMENT_SIZE = 4096;
const AGILE_VERSION = [4, 4];

/** ไฟล์ Office ที่มี stream สำหรับ OOXML ที่เข้ารหัส (EncryptionInfo + EncryptedPackage) */
export function openEncryptedPackage(bytes: Uint8Array): Cfb | null {
  const cfb = parseCfb(bytes);
  return cfb.has('EncryptionInfo') && cfb.has('EncryptedPackage') ? cfb : null;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const le32 = (n: number): Uint8Array => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
const fromBase64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utf16le = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) { out[2 * i] = s.charCodeAt(i) & 255; out[2 * i + 1] = s.charCodeAt(i) >> 8; }
  return out;
};
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
/** ปรับความยาว key/IV ตามสเปก: ตัดถ้ายาวเกิน, เติม 0x36 ถ้าสั้นไป */
const fit = (b: Uint8Array, n: number): Uint8Array => {
  if (b.length >= n) return b.subarray(0, n);
  const out = new Uint8Array(n).fill(0x36);
  out.set(b);
  return out;
};
const aesCbcDecrypt = (key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array =>
  cbc(key, iv, { disablePadding: true }).decrypt(data);

function xmlAttrs(xml: string, tag: string): Record<string, string> {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)>`));
  if (!m) throw new UnsupportedFileError('อ่านข้อมูลการเข้ารหัสของไฟล์ Excel ไม่ได้');
  const out: Record<string, string> = {};
  for (const a of m[1]!.matchAll(/([\w:]+)="([^"]*)"/g)) out[a[1]!] = a[2]!;
  return out;
}

/** ถอดรหัสไฟล์ OOXML ที่เข้ารหัส (ผลลัพธ์คือไฟล์ .xlsx/.zip ปกติ) — โยน FilePasswordError เมื่อไม่มี/รหัสผิด */
export function decryptOoxml(cfb: Cfb, password: string | undefined): Uint8Array {
  const info = cfb.read('EncryptionInfo');
  const pkg = cfb.read('EncryptedPackage');
  if (!info || !pkg || info.length < 12) throw new UnsupportedFileError('อ่านข้อมูลการเข้ารหัสของไฟล์ Excel ไม่ได้');
  const version = [info[0]! | (info[1]! << 8), info[2]! | (info[3]! << 8)];
  if (version[0] !== AGILE_VERSION[0] || version[1] !== AGILE_VERSION[1]) {
    throw new UnsupportedFileError(
      'ไฟล์นี้ใช้การเข้ารหัสแบบ Office 2007 ซึ่งยังไม่รองรับ — เปิดด้วย Excel แล้วบันทึกเป็น .xlsx ใหม่ (ตั้งรหัสผ่านแบบ Excel 2013 ขึ้นไป หรือบันทึกโดยไม่ตั้งรหัสผ่าน) ก่อนนำเข้า',
    );
  }
  if (!password) throw new FilePasswordError(false, 'Excel');

  const xml = new TextDecoder().decode(info.subarray(8));
  const kd = xmlAttrs(xml, 'keyData');
  const ek = xmlAttrs(xml, 'encryptedKey');
  for (const a of [kd, ek]) {
    if (a.cipherAlgorithm !== 'AES' || a.cipherChaining !== 'ChainingModeCBC' || !HASHES[a.hashAlgorithm ?? '']) {
      throw new UnsupportedFileError(`รูปแบบการเข้ารหัสนี้ (${a.cipherAlgorithm}/${a.cipherChaining}/${a.hashAlgorithm}) ยังไม่รองรับ`);
    }
  }
  const hashKey = HASHES[ek.hashAlgorithm!]!;
  const hashData = HASHES[kd.hashAlgorithm!]!;
  const spin = Number(ek.spinCount);
  const keyBytes = Number(ek.keyBits) / 8;
  const hashSize = Number(ek.hashSize);
  const salt = fromBase64(ek.saltValue!);
  const iv = fit(salt, Number(ek.blockSize));
  if (![16, 24, 32].includes(keyBytes) || !Number.isInteger(spin) || spin < 0 || spin > 10_000_000) {
    throw new UnsupportedFileError('พารามิเตอร์การเข้ารหัสของไฟล์ไม่ถูกต้อง');
  }

  // H0 = H(salt ‖ password) แล้ววน H(i ‖ H) ตาม spinCount
  let h = hashKey(concat(salt, utf16le(password)));
  const buf = new Uint8Array(4 + h.length);
  for (let i = 0; i < spin; i++) {
    buf.set(le32(i), 0);
    buf.set(h, 4);
    h = hashKey(buf);
  }
  const keyFor = (blockKey: Uint8Array) => fit(hashKey(concat(h, blockKey)), keyBytes);

  try {
    const verifierInput = aesCbcDecrypt(keyFor(BLOCK_KEY_VERIFIER_INPUT), iv, fromBase64(ek.encryptedVerifierHashInput!));
    const verifierValue = aesCbcDecrypt(keyFor(BLOCK_KEY_VERIFIER_VALUE), iv, fromBase64(ek.encryptedVerifierHashValue!)).subarray(0, hashSize);
    if (!sameBytes(hashKey(verifierInput.subarray(0, Number(ek.saltSize))), verifierValue)) throw new FilePasswordError(true, 'Excel');

    const secretKey = aesCbcDecrypt(keyFor(BLOCK_KEY_ENCRYPTED_KEY), iv, fromBase64(ek.encryptedKeyValue!)).subarray(0, Number(kd.keyBits) / 8);
    const dataSalt = fromBase64(kd.saltValue!);
    const blockSize = Number(kd.blockSize);

    const declared = pkg[0]! + pkg[1]! * 2 ** 8 + pkg[2]! * 2 ** 16 + pkg[3]! * 2 ** 24 + (pkg[4]! + pkg[5]! * 2 ** 8) * 2 ** 32;
    const body = pkg.subarray(8);
    const out = new Uint8Array(body.length);
    for (let off = 0, i = 0; off < body.length; off += SEGMENT_SIZE, i++) {
      const segIv = fit(hashData(concat(dataSalt, le32(i))), blockSize);
      out.set(aesCbcDecrypt(secretKey, segIv, body.subarray(off, off + SEGMENT_SIZE)), off);
    }
    if (declared > out.length) throw new UnsupportedFileError('ไฟล์ Excel ที่เข้ารหัสเสียหาย (ขนาดข้อมูลไม่ตรง)');
    return out.subarray(0, declared);
  } catch (e) {
    if (e instanceof FilePasswordError || e instanceof UnsupportedFileError) throw e;
    throw new UnsupportedFileError('ถอดรหัสไฟล์ Excel ไม่สำเร็จ — ไฟล์อาจเสียหาย');
  }
}
