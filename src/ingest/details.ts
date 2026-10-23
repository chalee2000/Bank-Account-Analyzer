// อ่านข้อความรายละเอียดที่ธนาคารเขียนเป็นแม่แบบตายตัว (ไม่ใช่การเดาจากข้อความอิสระ)
// ใช้กับ ธ.ก.ส. ซึ่งใส่รหัสอ้างอิง ตู้ ATM และข้อมูลผู้โอนไว้ในช่อง "รายละเอียดธุรกรรม"
import { thaiDigitsToArabic } from '../core/thai';
import { bankFromBotCode, bankDisplay, normalizeAccountForBank, normalizeBank } from '../core/normalize';

export interface DetailInfo {
  reference?: string;
  atmId?: string;
  atmBank?: string;
  cp?: { bank?: string; number?: string; name?: string };
}

const REF_RE = /รหัสอ้างอิงธุรกรรม\s*([A-Za-z0-9]+)/;
const ATM_RE = /ผ่านตู้\s*ATM\/?ADM\s*รหัส\s*(\S+)\s*ของธนาคาร\s*(\S+)/i;
const FROM_RE = /รับโอนจากธนาคารรหัส\s*(\d{1,3})\s*เลขที่บัญชีผู้โอน\s*([0-9Xx*\-]+)\s*ชื่อบัญชี\s*(.+)$/;

export function parseBaacDetails(raw: string): DetailInfo {
  const text = thaiDigitsToArabic(raw).replace(/\s+/g, ' ').trim();
  const out: DetailInfo = {};
  const ref = text.match(REF_RE);
  if (ref) out.reference = ref[1];
  const atm = text.match(ATM_RE);
  if (atm) {
    out.atmId = atm[1];
    const b = normalizeBank(atm[2]);
    out.atmBank = b ? bankDisplay(b) : atm[2];
  }
  const from = text.match(FROM_RE);
  if (from) {
    const bank = bankFromBotCode(from[1]);
    const acct = normalizeAccountForBank(from[2], bank);
    out.cp = { bank, number: acct?.number, name: from[3]!.trim() || undefined };
  }
  return out;
}
