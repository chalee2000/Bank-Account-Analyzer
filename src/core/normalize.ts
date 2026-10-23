// Normalize เลขบัญชี ชื่อ และธนาคาร เพื่อให้รายการจากหลายไฟล์เทียบกันได้
// หลักการ: ไม่เดาเลขบัญชี — เลขที่ถูกปิดบางส่วนจะเทียบแบบ "เข้ากันได้" (compatible) เท่านั้น
// และไม่รวมเป็นบัญชีเดียวกันอัตโนมัติ นอกจากผู้ใช้ยืนยัน

import { compactThai, fixThaiSpacing, thaiDigitsToArabic } from './thai';

export interface BankInfo {
  code: string;
  nameTh: string;
  aliases: string[];
}

// รหัส/ชื่อธนาคารที่พบบ่อย (ข้อมูลทั่วไป ใช้จับคู่ข้อความเท่านั้น ไม่ได้อิงรูปแบบไฟล์ของธนาคาร)
export const BANKS: BankInfo[] = [
  { code: 'KBANK', nameTh: 'กสิกรไทย', aliases: ['kbank', 'kasikorn', 'กสิกร', 'ธ.กสิกรไทย', 'k-bank', 'kplus', 'k plus'] },
  { code: 'SCB', nameTh: 'ไทยพาณิชย์', aliases: ['scb', 'siam commercial', 'ไทยพาณิชย์', 'ธ.ไทยพาณิชย์'] },
  { code: 'BBL', nameTh: 'กรุงเทพ', aliases: ['bbl', 'bangkok bank', 'ธนาคารกรุงเทพ', 'ธ.กรุงเทพ', 'กรุงเทพ'] },
  { code: 'KTB', nameTh: 'กรุงไทย', aliases: ['ktb', 'krungthai', 'krung thai', 'กรุงไทย', 'ธ.กรุงไทย'] },
  { code: 'BAY', nameTh: 'กรุงศรีอยุธยา', aliases: ['bay', 'krungsri', 'กรุงศรี', 'กรุงศรีอยุธยา', 'ธ.กรุงศรี'] },
  { code: 'TTB', nameTh: 'ทีทีบี', aliases: ['ttb', 'tmbthanachart', 'tmb', 'thanachart', 'ทหารไทยธนชาต', 'ทหารไทย', 'ธนชาต', 'ทีเอ็มบี'] },
  { code: 'GSB', nameTh: 'ออมสิน', aliases: ['gsb', 'government savings', 'ออมสิน', 'ธ.ออมสิน'] },
  { code: 'BAAC', nameTh: 'ธ.ก.ส.', aliases: ['baac', 'ธกส', 'ธ.ก.ส.', 'เพื่อการเกษตร'] },
  { code: 'GHB', nameTh: 'อาคารสงเคราะห์', aliases: ['ghb', 'อาคารสงเคราะห์', 'ธอส', 'ธ.อ.ส.'] },
  { code: 'UOB', nameTh: 'ยูโอบี', aliases: ['uob', 'ยูโอบี'] },
  { code: 'CIMBT', nameTh: 'ซีไอเอ็มบี ไทย', aliases: ['cimb', 'cimbt', 'ซีไอเอ็มบี'] },
  { code: 'LHBANK', nameTh: 'แลนด์ แอนด์ เฮ้าส์', aliases: ['lhbank', 'lh bank', 'แลนด์ แอนด์ เฮ้าส์', 'แลนด์แอนด์เฮ้าส์'] },
  { code: 'TISCO', nameTh: 'ทิสโก้', aliases: ['tisco', 'ทิสโก้'] },
  { code: 'KKP', nameTh: 'เกียรตินาคินภัทร', aliases: ['kkp', 'kiatnakin', 'เกียรตินาคิน'] },
  { code: 'ICBC', nameTh: 'ไอซีบีซี', aliases: ['icbc', 'ไอซีบีซี'] },
  { code: 'IBANK', nameTh: 'อิสลาม', aliases: ['ibank', 'islamic bank', 'อิสลาม', 'ธนาคารอิสลาม'] },
  { code: 'SME', nameTh: 'เอสเอ็มอี', aliases: ['sme bank', 'sme d', 'เอสเอ็มอี'] },
  { code: 'EXIM', nameTh: 'เพื่อการส่งออกและนำเข้า', aliases: ['exim', 'เอ็กซิม'] },
  { code: 'TRUEMONEY', nameTh: 'ทรูมันนี่', aliases: ['truemoney', 'true money', 'ทรูมันนี่', 'ทรูมันนี่วอลเล็ท', 'true wallet'] },
  { code: 'PROMPTPAY', nameTh: 'พร้อมเพย์', aliases: ['promptpay', 'prompt pay', 'พร้อมเพย์'] },
  { code: 'LINEPAY', nameTh: 'ไลน์เพย์ / Rabbit LINE Pay', aliases: ['line pay', 'linepay', 'rabbit line pay', 'ไลน์เพย์'] },
  { code: 'SHOPEEPAY', nameTh: 'ShopeePay / AirPay', aliases: ['shopeepay', 'airpay', 'ช้อปปี้เพย์'] },
];

const BANK_BY_ALIAS: [string, string][] = BANKS.flatMap((b) =>
  [b.code.toLowerCase(), ...b.aliases.map((a) => a.toLowerCase())].map((a) => [a, b.code] as [string, string]),
).sort((a, b) => b[0].length - a[0].length); // alias ยาวก่อน

/** แปลงชื่อ/ตัวย่อธนาคารในข้อความ → รหัสมาตรฐาน (undefined ถ้าไม่พบ) */
export function normalizeBank(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const s = thaiDigitsToArabic(String(raw)).toLowerCase().trim();
  if (!s) return undefined;
  for (const [alias, code] of BANK_BY_ALIAS) {
    if (alias.length <= 4 && /^[a-z]+$/.test(alias)) {
      // ตัวย่ออังกฤษสั้น ต้องเป็นคำเต็ม ป้องกันจับผิดในคำอื่น
      if (new RegExp(`(^|[^a-z])${alias}([^a-z]|$)`).test(s)) return code;
    } else if (s.includes(alias)) return code;
  }
  return undefined;
}

export function bankDisplay(code: string | undefined): string {
  if (!code) return '';
  return BANKS.find((b) => b.code === code)?.nameTh ?? code;
}

// ---------------- Account number ----------------

export interface NormalizedAccount {
  /** เลขบัญชีสะอาด: ตัวเลข + X แทนหลักที่ถูกปิดบัง */
  number: string;
  masked: boolean;
  digitsVisible: number;
}

/** ตัดขีด/ช่องว่าง/จุด แปลงเลขไทย แปลงตัวปิดบัง (x, X, *, #, •) เป็น X */
export function normalizeAccountNumber(raw: string | undefined | null): NormalizedAccount | null {
  if (!raw) return null;
  const s = thaiDigitsToArabic(String(raw))
    .replace(/[\s\-–—.]/g, '')
    .replace(/[xX*#•●_]/g, 'X');
  if (!/^[0-9X]+$/.test(s)) return null;
  const visible = (s.match(/\d/g) ?? []).length;
  if (visible < 3) return null; // สั้น/ปิดบางเกินกว่าจะใช้ระบุบัญชีได้
  return { number: s, masked: s.includes('X'), digitsVisible: visible };
}

/** เลขสองชุดเข้ากันได้หรือไม่ (X ตรงกับเลขใดก็ได้) — เทียบจากหลักท้าย เพราะธนาคารมักแสดงหลักท้าย */
export function accountsCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 4) return false;
  const ta = a.slice(-n);
  const tb = b.slice(-n);
  let strong = 0;
  for (let i = 0; i < n; i++) {
    const ca = ta[i]!;
    const cb = tb[i]!;
    if (ca === 'X' || cb === 'X') continue;
    if (ca !== cb) return false;
    strong++;
  }
  // ต้องมีหลักที่ตรงกันจริง (ไม่ใช่ X ทั้งคู่) อย่างน้อย 3 หลัก
  return strong >= 3;
}

export function buildAccountId(bank: string | undefined, number: string): string {
  return `${bank ?? '?'}:${number}`;
}

export function cashAccountId(ownerId: string): string {
  return `cash:${ownerId}`;
}
export function unknownAccountId(ownerId: string): string {
  return `unknown:${ownerId}`;
}

export function isPseudoAccount(id: string): boolean {
  return id.startsWith('cash:') || id.startsWith('unknown:');
}

/** แสดงเลขบัญชีแบบอ่านง่าย 123-4-56789-0 (สำหรับเลข 10 หลัก) หรือคงรูปเดิม */
export function formatAccountNumber(n: string): string {
  const s = n.replace(/\s/g, '');
  if (/^[0-9X]{10}$/.test(s)) return `${s.slice(0, 3)}-${s.slice(3, 4)}-${s.slice(4, 9)}-${s.slice(9)}`;
  if (/^[0-9X]{12}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  return s;
}

// ---------------- Names ----------------

const TITLE_RE = /^(นาย|นางสาว|นาง|น\.ส\.|น\.ส|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|mr\.?|mrs\.?|ms\.?|miss)\s*/i;

/** ทำให้ชื่อเทียบกันได้: ตัดคำนำหน้า ช่องว่างซ้ำ ตัวพิมพ์ใหญ่เล็ก */
export function normalizeName(raw: string | undefined | null): string {
  if (!raw) return '';
  return thaiDigitsToArabic(String(raw))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TITLE_RE, '')
    .toLowerCase();
}

export function namesMatch(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return !!na && !!nb && na === nb;
}

// ---------------- Counterparty extraction from free text ----------------

export interface ExtractedCounterparty {
  accountNumber?: NormalizedAccount;
  bank?: string;
  name?: string;
}

const NAME_PREFIX_RE =
  /(?:นาย|นางสาว|นาง|น\.ส\.|น\.ส|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|บริษัท|บจก\.?|หจก\.?|ห้างหุ้นส่วน|MR\.?|MRS\.?|MS\.?|MISS)\s*[ก-๙A-Za-z.][ก-๙A-Za-z.\s]{1,60}/i;

/**
 * ดึงข้อมูลคู่บัญชีแบบ "ทำเต็มที่" จากข้อความรายการ เช่น
 *   "โอนเงินไป กสิกรไทย xxx-x-x1234-x นาย สมชาย ใจดี"
 * ผลลัพธ์เป็นการเดาจากข้อความ — ผู้เรียกต้องติดธง inferred
 */
export function extractCounterparty(text: string | undefined | null): ExtractedCounterparty {
  const out: ExtractedCounterparty = {};
  if (!text) return out;
  const s = fixThaiSpacing(thaiDigitsToArabic(String(text)));

  out.bank = normalizeBank(compactThai(s));

  // รูปแบบเลขบัญชี: ตัวเลข/X อย่างน้อย 6 ตัว คั่นด้วยขีดได้
  const acctRe = /(?:[0-9Xx*#]{1,4}[-\s]?){2,5}[0-9Xx*#]{1,5}/g;
  let best: NormalizedAccount | null = null;
  for (const m of s.matchAll(acctRe)) {
    const cand = normalizeAccountNumber(m[0]);
    if (!cand) continue;
    if (cand.number.length < 6 || cand.number.length > 16) continue;
    if (!best || cand.digitsVisible > best.digitsVisible) best = cand;
  }
  if (best) out.accountNumber = best;

  const nm = s.match(NAME_PREFIX_RE);
  if (nm) {
    // ตัดส่วนที่อาจติดมา เช่น เลขบัญชี/ชื่อธนาคารต่อท้าย
    let name = nm[0].replace(/\s+/g, ' ').trim();
    name = name.replace(/[0-9Xx*#\-]{4,}.*$/, '').trim();
    if (name.length >= 4) out.name = name;
  }
  return out;
}
