// แปลง RawTable + ColumnMapping → StatementRow[] พร้อมสถิติคุณภาพข้อมูล
// หลักการ: ไม่เดาค่าที่ไม่ชัดเจน — แถวที่ระบุวันที่/ยอด/ทิศทางไม่ได้ถูกข้ามพร้อมเหตุผลให้ผู้ใช้เห็น

import { combineDateAndTime, parseAmount, parseDateTime, thaiDigitsToArabic } from '../core/thai';
import {
  bankDisplay, bankFromCell, extractCounterparty, normalizeAccountForBank, normalizeAccountNumber, normalizeBank,
} from '../core/normalize';
import type { EvidenceKey, TxnExtra, TxnKind } from '../core/types';
import { classifyHeader } from './detectColumns';
import { parseBaacDetails } from './details';
import { formatDirection, formatKind } from './formats';
import type {
  ColumnMapping, CounterpartyRef, ParseResult, PartyCols, RawTable, SkippedRow, StatementRow,
} from './types';

const OPENING_RE = /ยอดยกมา|ยกมา|brought\s*forward|opening\s*balance|balance\s*b\/?f|b\/f/i;
const TOTAL_RE = /^(รวม|ยอดรวม|สรุป|total|grand\s*total|ยอดยกไป|carried\s*forward|c\/f|closing\s*balance|ยอดสิ้นสุด)/i;
const OUT_TOKENS = new Set(['dr', 'd', 'debit', 'ถอน', 'ออก', '-', 'out', 'เดบิต', 'โอนออก', 'จ่าย']);
const IN_TOKENS = new Set(['cr', 'c', 'credit', 'ฝาก', 'เข้า', '+', 'in', 'เครดิต', 'โอนเข้า', 'รับ']);

const CASH_RE = /เงินสด|atm|cdm|cash|ตู้|เคาน์เตอร์|counter|teller|ถอน|ฝาก/i;
const NOT_CASH_RE = /โอน|transfer|promptpay|พร้อมเพย์|\bqr\b|เช็ค|cheque|check|bill|ชำระ/i;
const FEE_RE = /ค่าธรรมเนียม|\bfee\b|charge|ค่าบริการ|ค่าปรับ|ภาษี|\btax\b/i;
const INTEREST_RE = /ดอกเบี้ย|interest/i;
const PAYMENT_RE = /ชำระ|payment|\bbill\b|บัตรเครดิต|\bcard\b|\bpos\b|ซื้อสินค้า|purchase|เติมเงิน|top-?up/i;
const OUT_WORDS = /ถอน|โอนออก|โอนเงินออก|โอนไป|จ่าย|ชำระ|หัก|withdraw|debit|payment|transfer\s*out|ซื้อ|เติมเงิน|ค่าธรรมเนียม/i;
const IN_WORDS = /ฝาก|รับโอน|โอนเข้า|โอนเงินเข้า|รับเงิน|ดอกเบี้ย|deposit|credit|transfer\s*in|เงินเข้า|คืนเงิน|refund/i;

function cell(row: string[], idx: number | undefined): string {
  if (idx === undefined || idx < 0) return '';
  return (row[idx] ?? '').trim();
}

export function classifyKind(direction: 'in' | 'out', text: string): TxnKind {
  if (INTEREST_RE.test(text) && direction === 'in') return 'interest';
  if (FEE_RE.test(text) && direction === 'out') return 'fee';
  if (CASH_RE.test(text) && !NOT_CASH_RE.test(text)) return direction === 'out' ? 'cash_withdrawal' : 'cash_deposit';
  if (PAYMENT_RE.test(text) && direction === 'out') return 'payment';
  return 'transfer';
}

interface Draft {
  rowIdx: number;
  ts: number;
  hasTime: boolean;
  amount: number | null;
  direction: 'in' | 'out' | null;
  directionSource: StatementRow['directionSource'];
  balance?: number;
  description: string;
  channel?: string;
  reference?: string;
  location?: string;
  cp: CounterpartyRef;
  /** คู่บัญชีฝั่งต้นทาง/ปลายทางที่อ่านได้จากคอลัมน์แยก — เลือกใช้ตามทิศทางตอนท้าย */
  cpFrom?: CounterpartyRef;
  cpTo?: CounterpartyRef;
  extra?: TxnExtra;
  /** ช่องจำนวนเงินระบุ 0 ชัดเจน (เช่น รายการเปิดบัญชี) */
  zero?: boolean;
  /** ทิศทางที่เครื่องหมายของจำนวนเงินบอก — ใช้เป็นตัวสำรองเมื่อยอดคงเหลือตัดสินไม่ได้ */
  signHint?: 'in' | 'out';
  /** จำนวนเงินคำนวณจากส่วนต่างยอดคงเหลือ (ไม่ได้อ่านจากช่องจำนวนเงิน) */
  amountDerived?: boolean;
  flags: string[];
  minConf?: number;
  textForKind: string;
}

/** แถวหัวตารางที่ซ้ำข้ามหน้า: มีคำหัวตาราง ≥3 ช่อง และ "ไม่มี" ช่องที่เป็นวันที่หรือจำนวนเงิน (แถวข้อมูลจริงจะมี) */
function isHeaderRepeat(row: string[]): boolean {
  let n = 0;
  for (const c of row) {
    if (!c) continue;
    if (parseDateTime(c) !== null) return false;
    if (classifyHeader(c)) n++;
  }
  return n >= 3;
}

function tokenDirection(raw: string): 'in' | 'out' | null {
  const t = raw.toLowerCase().replace(/[\s.]/g, '');
  if (!t) return null;
  if (OUT_TOKENS.has(t) || /^(dr|debit)/.test(t)) return 'out';
  if (IN_TOKENS.has(t) || /^(cr|credit)/.test(t)) return 'in';
  return null;
}

const hasParty = (row: string[], cols?: PartyCols): boolean =>
  !!cols && [cols.account, cols.name, cols.bank].some((c) => cell(row, c) !== '');

/** อ่านข้อมูลคู่บัญชีฝั่งหนึ่งจากคอลัมน์ที่ระบุ (ธนาคารเป็นรหัสตัวเลข ธปท. หรือชื่อก็ได้) */
function readParty(row: string[], cols: PartyCols | undefined, onPad: () => void): CounterpartyRef | undefined {
  if (!cols || !hasParty(row, cols)) return undefined;
  const bank = bankFromCell(cell(row, cols.bank));
  const raw = cell(row, cols.account);
  const acct = raw ? normalizeAccountForBank(raw, bank) : null;
  if (acct?.padded) onPad();
  const name = cell(row, cols.name).replace(/\s+/g, ' ') || undefined;
  return { number: acct?.number, name, bank, inferred: false };
}

/** หลักฐานเสริมรายแถว (IP, ตู้ ATM, พิกัด ฯลฯ) */
function readEvidence(row: string[], mapping: ColumnMapping): TxnExtra | undefined {
  if (!mapping.evidence) return undefined;
  const out: TxnExtra = {};
  for (const [k, col] of Object.entries(mapping.evidence) as [EvidenceKey, number][]) {
    let v = cell(row, col);
    if (!v) continue;
    if ((k === 'lat' || k === 'lng') && Number(v) === 0) continue; // พิกัด 0,0 = ไม่มีข้อมูล
    if (k === 'atmBank') {
      const b = normalizeBank(v);
      v = b ? bankDisplay(b) : v;
    }
    out[k] = v.slice(0, 120);
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseRows(table: RawTable, mapping: ColumnMapping, fileId: string): ParseResult {
  const rows = table.rows;
  const start = mapping.headerRow + 1;
  const skipped: SkippedRow[] = [];
  const drafts: Draft[] = [];
  let openingBalance: number | undefined;
  const warnings: string[] = [];
  const notes: string[] = [];
  let totalRows = 0;
  let declaredRows: number | undefined;
  let paddedAccounts = 0;
  const onPad = () => { paddedAccounts++; };

  const skip = (r: number, reason: string) =>
    skipped.push({ row: r + 1, reason, text: rows[r]!.filter(Boolean).join(' | ').slice(0, 140) });

  const descCols = [mapping.description, ...(mapping.extra ?? [])].filter((c): c is number => c !== undefined);

  for (let r = start; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.every((c) => !c)) continue;
    totalRows++;
    if (isHeaderRepeat(row)) {
      skip(r, 'แถวหัวตารางซ้ำ (ข้ามหน้า)');
      continue;
    }
    const joined = row.filter(Boolean).join(' ');
    const dt =
      mapping.date !== undefined
        ? combineDateAndTime(cell(row, mapping.date), cell(row, mapping.time), {
            yearMode: mapping.yearMode,
            dayFirst: mapping.dayFirst,
          })
        : null;

    if (!dt) {
      if (OPENING_RE.test(joined)) {
        const b = parseAmount(cell(row, mapping.balance));
        if (b) openingBalance = b.sign < 0 ? -b.value : b.value;
        skip(r, 'ยอดยกมา');
        continue;
      }
      const declared = thaiDigitsToArabic(joined).match(/รวมทั้งสิ้น\s*([\d,]+)\s*รายการ/);
      if (declared) declaredRows = Number(declared[1]!.replace(/,/g, ''));
      if (TOTAL_RE.test(joined.trim())) {
        skip(r, 'แถวสรุป/ยอดรวม');
        continue;
      }
      // บรรทัดต่อของรายละเอียด (ข้อความยาวขึ้นบรรทัดใหม่) — ไม่มียอดเงินและไม่มีวันที่
      const hasMoney = [mapping.withdrawal, mapping.deposit, mapping.amount, mapping.balance].some(
        (c) => c !== undefined && parseAmount(cell(row, c)) !== null,
      );
      const prev = drafts[drafts.length - 1];
      if (prev && !hasMoney) {
        const extra = descCols.map((c) => cell(row, c)).filter(Boolean).join(' ') || joined;
        prev.description = `${prev.description} ${extra}`.trim();
        prev.textForKind = `${prev.textForKind} ${extra}`;
        continue;
      }
      skip(r, mapping.date === undefined ? 'ไม่ได้กำหนดคอลัมน์วันที่' : 'อ่านวันที่ไม่ได้');
      continue;
    }
    if (OPENING_RE.test(joined) && !hasAnyMovement(row, mapping)) {
      const b = parseAmount(cell(row, mapping.balance));
      if (b) openingBalance = b.sign < 0 ? -b.value : b.value;
      skip(r, 'ยอดยกมา');
      continue;
    }

    let amount: number | null = null;
    let direction: 'in' | 'out' | null = null;
    let directionSource: StatementRow['directionSource'] = 'column';
    let zero = false;
    let signHint: 'in' | 'out' | undefined;
    const flags: string[] = [];
    if (mapping.time !== undefined && cell(row, mapping.time) && !dt.hasTime) flags.push('time_unreadable');

    switch (mapping.amountMode) {
      case 'two-columns': {
        const w = parseAmount(cell(row, mapping.withdrawal));
        const d = parseAmount(cell(row, mapping.deposit));
        const wv = w && w.value > 0 ? w.value : 0;
        const dv = d && d.value > 0 ? d.value : 0;
        if (wv > 0 && dv === 0) { amount = wv; direction = 'out'; }
        else if (dv > 0 && wv === 0) { amount = dv; direction = 'in'; }
        else if (wv > 0 && dv > 0) {
          skip(r, 'มีทั้งยอดฝากและถอนในแถวเดียว — ตรวจไฟล์ต้นฉบับ');
          continue;
        } else if (w?.value === 0 || d?.value === 0) zero = true;
        break;
      }
      case 'drcr-column': {
        const a = parseAmount(cell(row, mapping.amount));
        if (a && a.value > 0) {
          amount = a.value;
          const tok = tokenDirection(cell(row, mapping.drcr));
          if (tok) { direction = tok; directionSource = 'drcr'; }
          else if (a.sign !== 0) { direction = a.sign < 0 ? 'out' : 'in'; directionSource = 'sign'; }
        }
        break;
      }
      case 'signed': {
        const a = parseAmount(cell(row, mapping.amount));
        if (a && a.value > 0) {
          amount = a.value;
          if (a.sign !== 0) { direction = a.sign < 0 ? 'out' : 'in'; directionSource = 'sign'; }
        }
        break;
      }
      case 'infer-balance': {
        const a = parseAmount(cell(row, mapping.amount));
        if (a && a.value > 0) {
          amount = a.value;
          // เครื่องหมายเป็นเพียงคำใบ้ — ให้ส่วนต่างยอดคงเหลือตัดสินทิศทางก่อน
          if (a.sign < 0 && mapping.format === 'baac-detail') flags.push('reversal'); // ธ.ก.ส.: ยอดติดลบ = กลับรายการ (ยอดคงเหลือเพิ่ม)
          else if (a.sign !== 0) signHint = a.sign < 0 ? 'out' : 'in';
        }
        break;
      }
    }

    const balParsed = parseAmount(cell(row, mapping.balance));
    const balance = balParsed ? (balParsed.sign < 0 ? -balParsed.value : balParsed.value) : undefined;

    const description = descCols.map((c) => cell(row, c)).filter(Boolean).join(' ');
    const channel = cell(row, mapping.channel) || undefined;
    let reference = cell(row, mapping.reference) || undefined;
    const location = cell(row, mapping.location) || undefined;

    // ---- ทิศทางจากช่องรายการที่ธนาคารระบุตรง ๆ (ฝาก/ถอน/ชำระ) หรือจากฝั่งผู้โอน/ผู้รับโอน ----
    if (amount !== null && direction === null) {
      const byType = formatDirection(mapping.format, cell(row, mapping.description));
      if (byType) direction = byType;
      else if (mapping.directionFromParties) {
        const hasFrom = hasParty(row, mapping.cpFrom);
        const hasTo = hasParty(row, mapping.cpTo);
        if (hasFrom && !hasTo) { direction = 'in'; directionSource = 'parties'; }
        else if (hasTo && !hasFrom) { direction = 'out'; directionSource = 'parties'; }
      }
    }

    // ---- คู่บัญชีและหลักฐานเสริมจากคอลัมน์/แม่แบบรายละเอียดของธนาคาร ----
    let cpFrom = readParty(row, mapping.cpFrom, onPad);
    const cpTo = readParty(row, mapping.cpTo, onPad);
    let extra = readEvidence(row, mapping);
    if (mapping.format === 'baac-detail') {
      const info = parseBaacDetails(description);
      reference ??= info.reference;
      if (info.cp) cpFrom = { ...info.cp, inferred: false };
      if (info.atmId || info.atmBank) extra = { ...extra, ...(info.atmId ? { atmId: info.atmId } : {}), ...(info.atmBank ? { atmBank: info.atmBank } : {}) };
    }

    // ---- คู่บัญชี ----
    const cp: CounterpartyRef = { inferred: false };
    const acctRaw = cell(row, mapping.cpAccount);
    if (acctRaw) {
      const n = normalizeAccountNumber(acctRaw);
      if (n) cp.number = n.number;
    }
    const nameRaw = cell(row, mapping.cpName);
    if (nameRaw) cp.name = nameRaw;
    const bankRaw = cell(row, mapping.cpBank);
    if (bankRaw) cp.bank = normalizeBank(bankRaw) ?? undefined;

    // ความมั่นใจ OCR ต่ำสุดของเซลล์สำคัญ
    let minConf: number | undefined;
    if (table.confidence) {
      const cols = [mapping.date, mapping.withdrawal, mapping.deposit, mapping.amount, mapping.balance].filter(
        (c): c is number => c !== undefined,
      );
      for (const c of cols) {
        const v = table.confidence[r]?.[c];
        if (v !== undefined && cell(row, c)) minConf = minConf === undefined ? v : Math.min(minConf, v);
      }
    }

    drafts.push({
      rowIdx: r,
      ts: dt.ts,
      hasTime: dt.hasTime,
      amount,
      direction,
      directionSource,
      balance,
      description,
      channel,
      reference,
      location,
      cp,
      cpFrom,
      cpTo,
      extra,
      zero,
      signHint,
      flags,
      minConf,
      textForKind: [description, channel, location].filter(Boolean).join(' '),
    });
  }

  // ---- ลำดับเวลา ----
  let desc = 0;
  let asc = 0;
  for (let i = 1; i < drafts.length; i++) {
    const a = drafts[i - 1]!.ts;
    const b = drafts[i]!.ts;
    if (b < a) desc++;
    else if (b > a) asc++;
  }
  const descendingInput = desc > asc;
  const ordered = (descendingInput ? [...drafts].reverse() : [...drafts]).sort((a, b) => a.ts - b.ts); // sort ใน JS เสถียร
  if (descendingInput) warnings.push('ไฟล์เรียงจากใหม่ไปเก่า — จัดเรียงใหม่ตามเวลาแล้ว');

  // ---- เติมทิศทาง/ยอดที่ขาดจากยอดคงเหลือ แล้วจึงใช้คำสำคัญ ----
  let prevBal = openingBalance;
  for (const d of ordered) {
    if (d.balance !== undefined && prevBal !== undefined) {
      const delta = d.balance - prevBal;
      if (d.amount === null && Math.abs(delta) > 0.004) {
        d.amount = Math.abs(delta);
        d.amountDerived = true;
        d.direction = delta > 0 ? 'in' : 'out';
        d.directionSource = 'balance';
        d.flags.push('amount_from_balance');
      } else if (d.amount !== null && d.direction === null) {
        if (Math.abs(Math.abs(delta) - d.amount) <= 0.01) {
          d.direction = delta > 0 ? 'in' : 'out';
          d.directionSource = 'balance';
        }
      }
    }
    if (d.balance !== undefined) prevBal = d.balance;
  }
  for (const d of ordered) {
    if (d.amount !== null && d.direction === null) {
      // "ดอกเบี้ย…จ่าย" ในบัญชีเงินฝาก = ธนาคารจ่ายดอกเบี้ยให้ลูกค้า (เงินเข้า) ไม่ใช่เงินออก เว้นแต่เป็นการหักภาษี
      const interestIn = INTEREST_RE.test(d.textForKind) && !/ภาษี|\btax\b|หัก/i.test(d.textForKind);
      const out = !interestIn && OUT_WORDS.test(d.textForKind);
      const inn = interestIn || IN_WORDS.test(d.textForKind);
      if (out && !inn) { d.direction = 'out'; d.directionSource = 'keyword'; d.flags.push('direction_from_keyword'); }
      else if (inn && !out) { d.direction = 'in'; d.directionSource = 'keyword'; d.flags.push('direction_from_keyword'); }
      else if (d.signHint) { d.direction = d.signHint; d.directionSource = 'sign'; }
    }
  }

  // ---- ไฟล์ที่ปัดจำนวนเงินเป็นบาทเต็ม: ยอดคงเหลือมีสตางค์ แต่จำนวนเงินเป็นจำนวนเต็มเสมอ ----
  // ส่วนต่างระหว่างยอดคงเหลือกับจำนวนเงินจึงคลาดเคลื่อนได้ไม่เกิน 0.50 บาทต่อรายการ ซึ่งไม่ใช่ข้อมูลตกหล่น
  let tolerance = 0.011;
  {
    let prev = openingBalance;
    let checked = 0;
    let near = 0;
    let allInteger = true;
    for (const d of ordered) {
      if (d.amount !== null && d.amount > 0 && d.direction !== null) {
        if (!d.amountDerived && !Number.isInteger(d.amount)) allInteger = false;
        if (d.balance !== undefined && prev !== undefined) {
          checked++;
          const resid = Math.abs(prev + (d.direction === 'in' ? d.amount : -d.amount) - d.balance);
          if (resid > 0.011 && resid <= 0.5001) near++;
        }
        prev = d.balance;
      } else if (d.balance !== undefined) prev = d.balance;
    }
    if (allInteger && checked >= 20 && near / checked >= 0.02) {
      tolerance = 0.5001;
      notes.push('จำนวนเงินในไฟล์นี้เป็นบาทเต็ม (ปัดจากยอดจริง — ยอดคงเหลือมีสตางค์) จึงยอมให้ยอดคงเหลือคลาดเคลื่อนไม่เกิน 0.50 บาทต่อรายการ; การจับคู่รายการ mirror กับ statement อื่นอาจพลาดเมื่อยอดต่างกันเศษสตางค์');
    }
  }

  // ---- สร้างผลลัพธ์ + ตรวจ running balance ----
  const out: StatementRow[] = [];
  let seq = 0;
  let balanceChecked = 0;
  let balanceMismatches = 0;
  let expectedPrev = openingBalance;
  let noCounterparty = 0;
  let noTime = 0;
  let inferredCp = 0;
  for (const d of ordered) {
    if (d.amount === null || d.amount <= 0) {
      skipped.push({
        row: d.rowIdx + 1,
        reason: d.zero ? 'ยอดเงินเป็น 0 บาท (เช่น รายการเปิดบัญชี) — ไม่มีเงินเคลื่อนไหว' : 'ไม่มียอดเงินที่อ่านได้',
        text: rows[d.rowIdx]!.filter(Boolean).join(' | ').slice(0, 140),
      });
      if (d.balance !== undefined) expectedPrev = d.balance;
      continue;
    }
    if (d.direction === null) {
      skipped.push({ row: d.rowIdx + 1, reason: 'ระบุทิศทางเงิน (เข้า/ออก) ไม่ได้ — ตรวจการจับคู่คอลัมน์', text: rows[d.rowIdx]!.filter(Boolean).join(' | ').slice(0, 140) });
      if (d.balance !== undefined) expectedPrev = d.balance;
      continue;
    }
    const flags = [...d.flags];
    if (d.balance !== undefined && expectedPrev !== undefined) {
      balanceChecked++;
      const expected = expectedPrev + (d.direction === 'in' ? d.amount : -d.amount);
      if (Math.abs(expected - d.balance) > tolerance) {
        balanceMismatches++;
        flags.push('balance_mismatch');
      }
    }
    if (d.balance !== undefined) expectedPrev = d.balance;
    else expectedPrev = undefined;

    // คอลัมน์ต้นทาง/ปลายทางแยกกัน: คู่บัญชีคือฝั่งตรงข้ามเจ้าของ (ขาเข้า=ต้นทาง ขาออก=ปลายทาง)
    const side = d.direction === 'in' ? d.cpFrom : d.cpTo;
    if (side) d.cp = side;

    if (mapping.cpFromDescription && (!d.cp.number || !d.cp.name || !d.cp.bank)) {
      // ทำหลังรวมบรรทัดต่อแล้ว เพื่อให้ได้ข้อความรายละเอียดครบ
      const ex = extractCounterparty(d.textForKind);
      let usedGuess = false;
      if (!d.cp.number && ex.accountNumber) { d.cp.number = ex.accountNumber.number; usedGuess = true; }
      if (!d.cp.name && ex.name) { d.cp.name = ex.name; usedGuess = true; }
      if (!d.cp.bank && ex.bank) { d.cp.bank = ex.bank; usedGuess = true; }
      if (usedGuess) d.cp.inferred = true;
    }

    const kind = flags.includes('reversal') ? 'other' : (formatKind(mapping.format, d.description) ?? classifyKind(d.direction, d.textForKind));
    if (!d.hasTime) noTime++;
    const hasCpId = !!(d.cp.number || d.cp.name);
    if (!hasCpId && kind === 'transfer') noCounterparty++;
    if (d.cp.inferred) inferredCp++;
    if (d.minConf !== undefined && d.minConf < 80) flags.push('low_ocr_confidence');

    out.push({
      fileId,
      row: d.rowIdx + 1,
      seq: seq++,
      ts: d.ts,
      hasTime: d.hasTime,
      direction: d.direction,
      amount: Math.round(d.amount * 100) / 100,
      kind,
      channel: d.channel,
      description: d.description || undefined,
      reference: d.reference,
      location: d.location,
      balanceAfter: d.balance,
      cp: d.cp,
      directionSource: d.directionSource,
      extra: d.extra,
      flags,
      minConfidence: d.minConf,
    });
  }

  if (balanceChecked > 0 && balanceMismatches > 0) {
    warnings.push(
      `ยอดคงเหลือไม่ต่อเนื่อง ${balanceMismatches}/${balanceChecked} รายการ — ข้อมูลอาจตกหล่น/ซ้ำ หรือจับคู่คอลัมน์ผิด`,
    );
  }
  if (noTime > 0 && noTime === out.length) {
    warnings.push('ไฟล์นี้ไม่มีเวลาของรายการ — การวิเคราะห์ระยะเวลา (Holding Time/Rapid Movement) จะละเอียดระดับวันเท่านั้น');
  }
  if (declaredRows !== undefined && declaredRows !== drafts.length) {
    warnings.push(`ท้ายตารางระบุ ${declaredRows} รายการ แต่อ่านแถวข้อมูลได้ ${drafts.length} แถว — ตรวจว่าไฟล์ครบถ้วน`);
  }
  if (paddedAccounts > 0) {
    notes.push(`เติมเลข 0 นำหน้าเลขบัญชีคู่โอน ${paddedAccounts} รายการให้ครบหลักของธนาคาร (Excel ตัด 0 นำหน้าเมื่อเก็บเลขบัญชีเป็นตัวเลข)`);
  }

  return {
    rows: out,
    stats: {
      totalRows,
      imported: out.length,
      skipped,
      openingBalance,
      descendingInput,
      balanceChecked,
      balanceMismatches,
      noCounterparty,
      noTime,
      inferredCounterparty: inferredCp,
      warnings,
      notes,
      declaredRows,
    },
  };
}

function hasAnyMovement(row: string[], m: ColumnMapping): boolean {
  return [m.withdrawal, m.deposit, m.amount].some((c) => {
    const p = parseAmount(cell(row, c));
    return p !== null && p.value > 0;
  });
}
