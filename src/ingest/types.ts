import type { TxnKind, FileRecord, EvidenceKey, TxnExtra } from '../core/types';
import type { YearMode } from '../core/thai';

/** ตารางดิบที่อ่านจากไฟล์ (ยังไม่ตีความ) — แถวแรก ๆ อาจเป็นหัวเอกสารก่อนหัวตาราง */
export interface RawTable {
  fileType: FileRecord['type'];
  sheetName?: string;
  rows: string[][];
  /** ความมั่นใจ OCR ต่อเซลล์ (0–100) ขนานกับ rows — มีเฉพาะที่มาจาก OCR */
  confidence?: number[][];
  /** จำนวนหน้า (PDF) */
  pages?: number;
  notes?: string[];
}

export type AmountMode = 'two-columns' | 'signed' | 'drcr-column' | 'infer-balance';

/** คอลัมน์ของฝ่ายหนึ่งในรายการ (ต้นทางหรือปลายทาง) */
export interface PartyCols {
  account?: number;
  name?: number;
  bank?: number;
}

/** รูปแบบ statement ของธนาคารที่ระบบรู้จัก (ดู formats.ts) */
export type FormatId = 'std-export' | 'from-to-statement' | 'baac-detail' | 'ktb-statement';

export interface ColumnMapping {
  /** index ของแถวหัวตารางใน RawTable.rows (-1 = ไม่มีหัวตาราง) */
  headerRow: number;
  date?: number;
  time?: number;
  description?: number;
  withdrawal?: number;
  deposit?: number;
  amount?: number;
  drcr?: number;
  balance?: number;
  channel?: number;
  cpAccount?: number;
  cpName?: number;
  cpBank?: number;
  reference?: number;
  location?: number;
  /** คอลัมน์ข้อความเพิ่มเติมที่ต่อท้ายรายละเอียด (เช่น ประเภทรายการ + รายละเอียด) */
  extra?: number[];
  /**
   * คอลัมน์ต้นทาง/ปลายทางแยกกัน: คู่บัญชี = ฝั่งตรงข้ามเจ้าของ statement
   * (ขาเข้าใช้ฝั่ง "ต้นทาง" ขาออกใช้ฝั่ง "ปลายทาง")
   */
  cpFrom?: PartyCols;
  cpTo?: PartyCols;
  /** หาทิศทางเงินจากการมีข้อมูลฝั่งต้นทาง (=เข้า) หรือปลายทาง (=ออก) เมื่อจำนวนเงินมีคอลัมน์เดียวและไม่มีเครื่องหมาย */
  directionFromParties?: boolean;
  /** คอลัมน์หลักฐานเสริมรายแถว (IP, ตู้ ATM, พิกัด ฯลฯ) */
  evidence?: Partial<Record<EvidenceKey, number>>;
  /** รูปแบบ statement ที่ตรวจพบ — ใช้กำหนดวิธีจัดประเภทรายการและอ่านรายละเอียดเฉพาะธนาคาร */
  format?: FormatId;
  amountMode: AmountMode;
  yearMode: YearMode;
  dayFirst: boolean;
  /** ดึงเลขบัญชี/ชื่อ/ธนาคารคู่โอนจากคอลัมน์รายละเอียดแบบเดาจากข้อความ */
  cpFromDescription: boolean;
}

export const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; hint?: string }[] = [
  { key: 'date', label: 'วันที่' },
  { key: 'time', label: 'เวลา' },
  { key: 'description', label: 'รายการ/รายละเอียด' },
  { key: 'withdrawal', label: 'ถอน/เงินออก (Debit)' },
  { key: 'deposit', label: 'ฝาก/เงินเข้า (Credit)' },
  { key: 'amount', label: 'จำนวนเงิน (คอลัมน์เดียว)' },
  { key: 'drcr', label: 'ตัวบอกทิศทาง (Dr/Cr, ฝาก/ถอน)' },
  { key: 'balance', label: 'ยอดคงเหลือ' },
  { key: 'channel', label: 'ช่องทาง' },
  { key: 'cpAccount', label: 'เลขบัญชีคู่โอน' },
  { key: 'cpName', label: 'ชื่อคู่โอน' },
  { key: 'cpBank', label: 'ธนาคารคู่โอน' },
  { key: 'reference', label: 'เลขอ้างอิง' },
  { key: 'location', label: 'สถานที่/สาขา/ตู้ ATM' },
];

/** ข้อมูลเจ้าของ statement ที่ผู้ใช้ยืนยัน */
export interface OwnerInfo {
  bank?: string;
  number: string;
  name?: string;
  /** ข้อมูลเจ้าของบัญชีจากหัวเอกสาร (สาขา ที่อยู่ ฯลฯ) */
  meta?: Record<string, string>;
}

/** บัญชีเจ้าของที่ตรวจพบจากหัวเอกสาร */
export interface OwnerSuggestion {
  number?: string;
  name?: string;
  bank?: string;
  /** ช่วงเวลา statement ที่ระบุในหัวเอกสาร (ข้อความดิบ) */
  period?: string;
  meta?: Record<string, string>;
  /** รูปแบบ statement ที่ตรวจพบ (แสดงให้ผู้ใช้เห็นว่าระบบรู้จักไฟล์นี้) */
  formatLabel?: string;
  /** หมายเหตุสำหรับผู้ใช้ เช่น ไฟล์มีหลายบัญชี */
  notes?: string[];
}

export interface CounterpartyRef {
  /** เลขบัญชีที่ normalize แล้ว (อาจมี X) */
  number?: string;
  bank?: string;
  name?: string;
  /** true = ได้จากการเดาข้อความรายละเอียด */
  inferred: boolean;
}

/** แถว statement ที่ parse แล้ว (ยังไม่ผูกเป็น from/to และยังไม่รวม mirror) */
export interface StatementRow {
  fileId: string;
  /** เลขแถวในไฟล์ต้นฉบับ (1-based) */
  row: number;
  /** ลำดับตามเวลา (หลังจัดเรียง) ใช้ตัดสินเมื่อเวลาเท่ากัน */
  seq: number;
  ts: number;
  hasTime: boolean;
  direction: 'in' | 'out';
  amount: number;
  kind: TxnKind;
  channel?: string;
  description?: string;
  reference?: string;
  location?: string;
  balanceAfter?: number;
  cp: CounterpartyRef;
  /** วิธีที่ได้ทิศทาง */
  directionSource: 'column' | 'sign' | 'drcr' | 'balance' | 'keyword' | 'parties';
  /** หลักฐานเสริมจาก statement */
  extra?: TxnExtra;
  flags: string[];
  /** ความมั่นใจต่ำสุดของเซลล์ที่ใช้ (OCR) */
  minConfidence?: number;
}

export interface SkippedRow {
  row: number;
  reason: string;
  text: string;
}

export interface ParseStats {
  totalRows: number;
  imported: number;
  skipped: SkippedRow[];
  openingBalance?: number;
  /** ลำดับต้นฉบับเรียงจากใหม่ไปเก่า */
  descendingInput: boolean;
  balanceChecked: number;
  balanceMismatches: number;
  noCounterparty: number;
  noTime: number;
  inferredCounterparty: number;
  warnings: string[];
  /** ข้อมูลประกอบที่ไม่ใช่คำเตือน (เช่น เติม 0 นำหน้าเลขบัญชี) */
  notes: string[];
  /** จำนวนรายการที่ไฟล์ระบุไว้ท้ายตาราง (เช่น "รวมทั้งสิ้น 298 รายการ") */
  declaredRows?: number;
}

export interface ParseResult {
  rows: StatementRow[];
  stats: ParseStats;
}
