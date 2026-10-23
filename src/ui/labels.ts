import type { TxnKind } from '../core/types';
import { fmtBaht, fmtDuration, fmtInt } from '../core/thai';

export const KIND_LABEL: Record<TxnKind, string> = {
  transfer: 'โอนเงิน',
  cash_deposit: 'ฝากเงินสด',
  cash_withdrawal: 'ถอนเงินสด',
  payment: 'ชำระเงิน',
  fee: 'ค่าธรรมเนียม',
  interest: 'ดอกเบี้ย',
  other: 'อื่น ๆ',
};

export const FLAG_LABEL: Record<string, string> = {
  balance_mismatch: 'ยอดคงเหลือไม่ต่อเนื่องที่รายการนี้',
  ambiguous_mirror: 'การจับคู่สองฝั่ง (mirror) กำกวม มีหลายรายการที่เป็นไปได้',
  mirror_inferred: 'จับคู่สองฝั่งจากยอดและเวลาเท่านั้น (อ่านคู่บัญชีของฝั่งหนึ่งไม่ได้) — ควรตรวจกับต้นฉบับ',
  time_unreadable: 'อ่านเวลาไม่ได้ จึงใช้เฉพาะวันที่ของรายการนี้',
  low_ocr_confidence: 'OCR ความมั่นใจต่ำ ควรตรวจกับต้นฉบับ',
  direction_from_keyword: 'ทิศทางเงินได้จากการอ่านข้อความ ไม่ใช่จากคอลัมน์',
  amount_from_balance: 'จำนวนเงินคำนวณจากส่วนต่างยอดคงเหลือ (ช่องจำนวนเงินในต้นฉบับว่าง)',
  reversal: 'รายการกลับรายการ/ยกเลิก (ยอดติดลบในต้นฉบับ) — เงินไหลกลับเข้าบัญชี',
};

const METRIC: Record<string, { label: string; fmt?: (v: number | string) => string }> = {
  count: { label: 'จำนวนรายการ' },
  receivers: { label: 'จำนวนบัญชีผู้รับ' },
  senders: { label: 'จำนวนบัญชีผู้ส่ง' },
  minAmount: { label: 'ยอดต่ำสุด', fmt: (v) => fmtBaht(Number(v)) },
  maxAmount: { label: 'ยอดสูงสุด', fmt: (v) => fmtBaht(Number(v)) },
  inflows: { label: 'จำนวนรายการเงินเข้า' },
  totalIn: { label: 'เงินเข้ารวม', fmt: (v) => fmtBaht(Number(v)) },
  totalMoved: { label: 'เงินออกต่อภายในกำหนด', fmt: (v) => fmtBaht(Number(v)) },
  total: { label: 'ยอดรวม', fmt: (v) => fmtBaht(Number(v)) },
  medianHoldingMs: { label: 'ระยะเวลาถือเงินมัธยฐาน', fmt: (v) => fmtDuration(Number(v)) },
  spanMs: { label: 'ช่วงเวลารวม', fmt: (v) => fmtDuration(Number(v)) },
  days: { label: 'จำนวนวันที่ต่างกัน' },
  shareOfInflows: { label: 'สัดส่วนรายการเงินเข้า (%)' },
  forwardedShare: { label: 'สัดส่วนที่ส่งต่อ (%)' },
  fundedPct: { label: 'สัดส่วนยอดถอนที่มีเงินโอนเข้ารองรับ (%)' },
  withdrawals: { label: 'จำนวนครั้งที่ถอน' },
  locations: { label: 'จำนวนตู้/สถานที่' },
  hops: { label: 'จำนวนทอด' },
  accounts: { label: 'จำนวนบัญชี' },
  retainPct: { label: 'ยอดปลายทาง/ต้นทาง (%)' },
  banks: { label: 'จำนวนธนาคาร' },
  cashExit: { label: 'สิ้นสุดที่เงินสด' },
  startAmount: { label: 'ยอดเริ่มต้น', fmt: (v) => fmtBaht(Number(v)) },
  returnAmount: { label: 'ยอดที่กลับมา', fmt: (v) => fmtBaht(Number(v)) },
  threshold: { label: 'วงเงินที่กำหนด', fmt: (v) => fmtBaht(Number(v)) },
  direction: { label: 'ทิศทาง' },
  baseType: { label: 'ชนิดรูปแบบ' },
  occurrences: { label: 'จำนวนครั้ง' },
};

export function metricRows(m: Record<string, number | string>): { label: string; value: string }[] {
  return Object.entries(m).map(([k, v]) => {
    const def = METRIC[k];
    return {
      label: def?.label ?? k,
      value: def?.fmt ? def.fmt(v) : typeof v === 'number' ? fmtInt(v) : String(v),
    };
  });
}
