// เดาโครงสร้างตาราง statement: แถวหัวตาราง, คอลัมน์ต่าง ๆ และโหมดของยอดเงิน
// เป็นการเดาแบบทั่วไปจากชื่อหัวตารางไทย/อังกฤษและเนื้อหา — ไม่ได้อิงรูปแบบเฉพาะธนาคาร
// ผู้ใช้ตรวจ/แก้ใน mapping UI ได้เสมอ

import { compactThai, fixThaiSpacing, parseAmount, parseDateTime, thaiDigitsToArabic } from '../core/thai';
import { normalizeAccountNumber, normalizeBank } from '../core/normalize';
import type { ColumnMapping, OwnerSuggestion, RawTable } from './types';

type FieldKey =
  | 'date' | 'time' | 'description' | 'withdrawal' | 'deposit' | 'amount' | 'drcr'
  | 'balance' | 'channel' | 'cpAccount' | 'cpName' | 'cpBank' | 'reference' | 'location';

/** คำค้นแบบ normalize แล้ว (ตัวพิมพ์เล็ก ไม่มีช่องว่าง/เครื่องหมาย) */
const KEYWORDS: Record<FieldKey, string[]> = {
  date: ['วันที่ทำรายการ', 'วันที่รายการ', 'วันที่เวลา', 'วันที่และเวลา', 'วันเดือนปี', 'วันที่', 'transactiondate', 'txndate', 'postingdate', 'valuedate', 'effectivedate', 'datetime', 'dateandtime', 'date'],
  time: ['เวลาทำรายการ', 'เวลา', 'time'],
  description: ['รายละเอียดรายการ', 'รายละเอียด', 'ประเภทรายการ', 'รายการ', 'description', 'particulars', 'details', 'narrative', 'transaction', 'remark', 'หมายเหตุ', 'memo'],
  withdrawal: ['จำนวนเงินถอน', 'เงินถอน', 'ถอนเงิน', 'ถอน', 'withdrawal', 'withdrawals', 'debit', 'dr', 'รายจ่าย', 'เงินออก', 'โอนออก', 'จ่าย'],
  deposit: ['จำนวนเงินฝาก', 'เงินฝาก', 'ฝากเงิน', 'ฝาก', 'deposit', 'deposits', 'credit', 'cr', 'รายรับ', 'เงินเข้า', 'โอนเข้า', 'รับ'],
  amount: ['จำนวนเงิน', 'ยอดเงิน', 'amount', 'มูลค่า', 'จำนวน'],
  drcr: ['drcr', 'debitcredit', 'เดบิตเครดิต', 'ฝากถอน', 'ทิศทาง', 'indicator', 'dc', 'ประเภท', 'type'],
  balance: ['ยอดเงินคงเหลือ', 'ยอดคงเหลือ', 'คงเหลือ', 'runningbalance', 'balance'],
  channel: ['ช่องทางการทำรายการ', 'ช่องทาง', 'channel', 'terminal'],
  cpAccount: ['เลขที่บัญชีปลายทาง', 'เลขบัญชีปลายทาง', 'บัญชีปลายทาง', 'เลขที่บัญชีต้นทาง', 'เลขบัญชีต้นทาง', 'บัญชีต้นทาง', 'เลขที่บัญชีคู่โอน', 'เลขบัญชีคู่โอน', 'บัญชีคู่โอน', 'เลขที่บัญชีผู้รับ', 'เลขบัญชีผู้รับ', 'เลขที่บัญชีผู้โอน', 'toaccount', 'fromaccount', 'beneficiaryaccount', 'counterpartyaccount', 'payeeaccount'],
  cpName: ['ชื่อบัญชีปลายทาง', 'ชื่อบัญชีต้นทาง', 'ชื่อผู้รับโอน', 'ชื่อผู้รับเงิน', 'ชื่อผู้รับ', 'ชื่อผู้โอน', 'ชื่อคู่โอน', 'beneficiaryname', 'counterpartyname', 'payeename', 'toname', 'fromname'],
  cpBank: ['ธนาคารปลายทาง', 'ธนาคารต้นทาง', 'ธนาคารคู่โอน', 'ธนาคารผู้รับ', 'ธนาคารผู้โอน', 'tobank', 'frombank', 'beneficiarybank', 'counterpartybank'],
  reference: ['หมายเลขอ้างอิง', 'เลขที่อ้างอิง', 'เลขที่รายการ', 'รหัสอ้างอิง', 'อ้างอิง', 'reference', 'refno', 'transactionid', 'txnid', 'ref'],
  location: ['สถานที่', 'สาขา', 'ตู้atm', 'location', 'branch', 'terminalid', 'ที่ตั้ง', 'atm'],
};

/** คำสั้น (ภาษาอังกฤษ ≤3 ตัว หรือไทย ≤3 ตัว) ต้องตรงทั้งคำ เพื่อกันจับผิด */
function keywordMatches(h: string, kw: string): boolean {
  if (kw.length <= 3) return h === kw;
  return h.includes(kw);
}

export function normalizeHeader(s: string): string {
  return thaiDigitsToArabic(s).toLowerCase().replace(/[\s._\-()[\]/\\:*]/g, '');
}

/** คืนฟิลด์ที่หัวคอลัมน์นี้น่าจะเป็น พร้อมคะแนน (ความยาวคำที่ตรง) */
export function classifyHeader(cell: string): { field: FieldKey; score: number } | null {
  const h = normalizeHeader(cell);
  if (!h) return null;
  let best: { field: FieldKey; score: number } | null = null;
  for (const field of Object.keys(KEYWORDS) as FieldKey[]) {
    for (const kw of KEYWORDS[field]) {
      if (keywordMatches(h, kw) && (!best || kw.length > best.score)) best = { field, score: kw.length };
    }
  }
  return best;
}

export interface HeaderScan {
  headerRow: number;
  fields: Partial<Record<FieldKey, number>>;
  extra: number[];
  matched: number;
}

export function findHeader(rows: string[][], maxScan = 80): HeaderScan | null {
  let best: HeaderScan | null = null;
  for (let r = 0; r < Math.min(rows.length, maxScan); r++) {
    const row = rows[r]!;
    const fields: Partial<Record<FieldKey, { col: number; score: number }>> = {};
    const descCols: { col: number; score: number }[] = [];
    row.forEach((cell, col) => {
      const c = classifyHeader(cell);
      if (!c) return;
      if (c.field === 'description') descCols.push({ col, score: c.score });
      const cur = fields[c.field];
      if (!cur || c.score > cur.score) fields[c.field] = { col, score: c.score };
    });
    const keys = Object.keys(fields) as FieldKey[];
    const hasDate = keys.includes('date');
    const hasMoney = keys.some((k) => ['withdrawal', 'deposit', 'amount', 'balance'].includes(k));
    if (!hasDate || !hasMoney || keys.length < 3) continue;
    if (!best || keys.length > best.matched) {
      const primary = fields.description?.col;
      best = {
        headerRow: r,
        fields: Object.fromEntries(keys.map((k) => [k, fields[k]!.col])) as HeaderScan['fields'],
        extra: descCols.map((d) => d.col).filter((c) => c !== primary),
        matched: keys.length,
      };
    }
  }
  return best;
}

const DRCR_TOKENS = new Set(['dr', 'cr', 'd', 'c', 'debit', 'credit', 'ฝาก', 'ถอน', 'เข้า', 'ออก', '+', '-', 'in', 'out', 'เดบิต', 'เครดิต']);

function sample(rows: string[][], start: number, col: number, n = 60): string[] {
  const out: string[] = [];
  for (let r = start; r < rows.length && out.length < n; r++) {
    const v = rows[r]?.[col];
    if (v !== undefined && v !== '') out.push(v);
  }
  return out;
}

function ratio(vals: string[], pred: (v: string) => boolean): number {
  if (!vals.length) return 0;
  return vals.filter(pred).length / vals.length;
}

/** เดาวันที่แบบ dd/mm vs mm/dd จากค่าที่ชี้ชัด */
export function detectDayFirst(dateSamples: string[]): boolean {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  for (const raw of dateSamples) {
    const m = thaiDigitsToArabic(raw).match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{2,4}/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirstEvidence++;
    if (b > 12 && a <= 12) monthFirstEvidence++;
  }
  return !(monthFirstEvidence > dayFirstEvidence);
}

export function detectMapping(table: RawTable): ColumnMapping {
  const rows = table.rows;
  const header = findHeader(rows);
  const base: ColumnMapping = {
    headerRow: -1,
    amountMode: 'signed',
    yearMode: 'auto',
    dayFirst: true,
    cpFromDescription: true,
  };

  if (header) {
    const f = header.fields;
    const m: ColumnMapping = {
      ...base,
      headerRow: header.headerRow,
      date: f.date,
      time: f.time,
      description: f.description,
      withdrawal: f.withdrawal,
      deposit: f.deposit,
      amount: f.amount,
      drcr: f.drcr,
      balance: f.balance,
      channel: f.channel,
      cpAccount: f.cpAccount,
      cpName: f.cpName,
      cpBank: f.cpBank,
      reference: f.reference,
      location: f.location,
      extra: header.extra.length ? header.extra : undefined,
    };
    const start = header.headerRow + 1;

    // ตรวจเนื้อหาของคอลัมน์ drcr: ถ้าไม่เหมือนตัวบอกทิศทางจริง ให้ทิ้ง
    if (m.drcr !== undefined) {
      const vals = sample(rows, start, m.drcr).map((v) => normalizeHeader(v));
      if (ratio(vals, (v) => DRCR_TOKENS.has(v) || /^(dr|cr)/.test(v)) < 0.6) m.drcr = undefined;
    }
    // 'amount' กับ 'withdrawal+deposit' พร้อมกัน → ใช้ withdrawal/deposit
    if (m.withdrawal !== undefined && m.deposit !== undefined) {
      m.amountMode = 'two-columns';
      m.amount = undefined;
    } else if (m.amount !== undefined && m.drcr !== undefined) {
      m.amountMode = 'drcr-column';
    } else if (m.amount !== undefined) {
      m.amountMode = 'signed';
    } else if (m.balance !== undefined) {
      m.amountMode = 'infer-balance';
    }
    // คอลัมน์วันที่ต้อง parse ได้จริง
    if (m.date !== undefined) {
      const ds = sample(rows, start, m.date);
      m.dayFirst = detectDayFirst(ds);
      if (ratio(ds, (v) => parseDateTime(v, { dayFirst: m.dayFirst }) !== null) < 0.5) m.date = undefined;
    }
    // ถ้าคอลัมน์เวลาเป็นคอลัมน์เดียวกับวันที่ ให้ตัดทิ้ง
    if (m.time === m.date) m.time = undefined;
    // ถ้าไม่พบคอลัมน์รายละเอียด แต่มีข้อความยาว ๆ คอลัมน์หนึ่ง → ใช้เป็นรายละเอียด
    if (m.description === undefined) m.description = guessDescriptionColumn(rows, start, m);
    return m;
  }

  return detectHeaderless(rows, base);
}

function guessDescriptionColumn(rows: string[][], start: number, m: ColumnMapping): number | undefined {
  const used = new Set(Object.entries(m).filter(([k, v]) => typeof v === 'number' && k !== 'headerRow').map(([, v]) => v as number));
  const width = Math.max(0, ...rows.slice(start, start + 40).map((r) => r.length));
  let best: { col: number; len: number } | null = null;
  for (let c = 0; c < width; c++) {
    if (used.has(c)) continue;
    const vals = sample(rows, start, c, 40);
    if (!vals.length) continue;
    const textRatio = ratio(vals, (v) => parseAmount(v) === null);
    const avg = vals.reduce((a, v) => a + v.length, 0) / vals.length;
    if (textRatio > 0.7 && (!best || avg > best.len)) best = { col: c, len: avg };
  }
  return best?.col;
}

/** ไม่มีหัวตาราง: เดาจากเนื้อหา — วันที่ในคอลัมน์ที่ parse ได้, ตัวเลขคอลัมน์สุดท้าย=ยอดคงเหลือ */
function detectHeaderless(rows: string[][], base: ColumnMapping): ColumnMapping {
  const width = Math.max(0, ...rows.slice(0, 60).map((r) => r.length));
  const m: ColumnMapping = { ...base };
  let bestDate = { col: -1, r: 0 };
  for (let c = 0; c < width; c++) {
    const vals = sample(rows, 0, c);
    const r = ratio(vals, (v) => parseDateTime(v) !== null);
    if (r > bestDate.r) bestDate = { col: c, r };
  }
  if (bestDate.col >= 0 && bestDate.r >= 0.6) {
    m.date = bestDate.col;
    m.dayFirst = detectDayFirst(sample(rows, 0, bestDate.col));
  }
  const numericCols: number[] = [];
  for (let c = 0; c < width; c++) {
    if (c === m.date) continue;
    const vals = sample(rows, 0, c);
    if (vals.length >= 3 && ratio(vals, (v) => parseAmount(v) !== null) >= 0.5) numericCols.push(c);
  }
  if (numericCols.length >= 3) {
    m.withdrawal = numericCols[numericCols.length - 3];
    m.deposit = numericCols[numericCols.length - 2];
    m.balance = numericCols[numericCols.length - 1];
    m.amountMode = 'two-columns';
  } else if (numericCols.length === 2) {
    m.amount = numericCols[0];
    m.balance = numericCols[1];
    m.amountMode = 'infer-balance';
  } else if (numericCols.length === 1) {
    m.amount = numericCols[0];
    m.amountMode = 'signed';
  }
  const used = new Set([m.date, ...numericCols]);
  let desc: { col: number; len: number } | null = null;
  for (let c = 0; c < width; c++) {
    if (used.has(c)) continue;
    const vals = sample(rows, 0, c, 40);
    if (!vals.length) continue;
    const avg = vals.reduce((a, v) => a + v.length, 0) / vals.length;
    if (!desc || avg > desc.len) desc = { col: c, len: avg };
  }
  if (desc) m.description = desc.col;
  return m;
}

// ---------------- Owner (statement header) ----------------

/** regex ที่ยอมให้มีช่องว่างแทรกระหว่างตัวอักษรของคำ (OCR มักแทรกช่องว่างกลางคำไทย) */
const spaced = (words: string[]) =>
  new RegExp('(' + words.map((w) => [...w].map((c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('\\s*')).join('|') + ')', 'i');
const ACCT_LABEL_RE = spaced(['เลขที่บัญชี', 'หมายเลขบัญชี', 'เลขบัญชี', 'accountno', 'accountnumber', 'account#', 'a/cno', 'acctno', 'acct.no']);
const NAME_LABEL_RE = spaced(['ชื่อบัญชี', 'ชื่อเจ้าของบัญชี', 'ชื่อลูกค้า', 'accountname', 'customername', 'nameofaccount', 'a/cname']);
const PERIOD_LABEL_RE = spaced(['ระหว่างวันที่', 'ช่วงเวลา', 'statementperiod', 'period', 'ตั้งแต่วันที่', 'fromdate']);

/** หาเลขบัญชี/ชื่อ/ธนาคารเจ้าของ statement จากบรรทัดก่อนหัวตาราง (หรือ 15 บรรทัดแรกถ้าไม่มีหัวตาราง) */
export function suggestOwner(rows: string[][], headerRow: number, extraText: string[] = []): OwnerSuggestion {
  const limit = headerRow > 0 ? headerRow : Math.min(rows.length, 15);
  const lines: string[] = [...extraText];
  for (let r = 0; r < limit; r++) {
    const line = rows[r]!.filter(Boolean).join(' ');
    if (line) lines.push(line);
  }
  const out: OwnerSuggestion = {};
  for (const rawLine of lines) {
    const line = fixThaiSpacing(rawLine);
    if (!out.bank) out.bank = normalizeBank(compactThai(line));
    // บรรทัดเดียวอาจมีหลายช่อง คั่นด้วย · | • หรือ " - " (เช่น จากการอ่าน PDF/OCR)
    const segments = [line, ...line.split(/\s*[·|•]\s*|\s+-\s+/)];
    for (const seg of segments) {
      if (!out.number && ACCT_LABEL_RE.test(seg)) {
        const after = seg.split(ACCT_LABEL_RE).slice(2).join(' ') || seg;
        const m = thaiDigitsToArabic(after).match(/[0-9Xx*][0-9Xx*\-\s]{5,20}[0-9Xx*]/);
        const n = m ? normalizeAccountNumber(m[0]) : null;
        if (n) out.number = n.number;
      }
      if (!out.name && NAME_LABEL_RE.test(seg)) {
        const after = seg.split(NAME_LABEL_RE).slice(2).join(' ').replace(/^[\s:：]+/, '').trim();
        if (after && after.length < 80 && !/^[0-9\s\-:]+$/.test(after) && !ACCT_LABEL_RE.test(after)) out.name = after;
      }
      if (!out.period && PERIOD_LABEL_RE.test(seg)) out.period = seg;
    }
  }
  return out;
}
