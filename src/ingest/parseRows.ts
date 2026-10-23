// แปลง RawTable + ColumnMapping → StatementRow[] พร้อมสถิติคุณภาพข้อมูล
// หลักการ: ไม่เดาค่าที่ไม่ชัดเจน — แถวที่ระบุวันที่/ยอด/ทิศทางไม่ได้ถูกข้ามพร้อมเหตุผลให้ผู้ใช้เห็น

import { combineDateAndTime, parseAmount, parseDateTime } from '../core/thai';
import { extractCounterparty, normalizeAccountNumber, normalizeBank } from '../core/normalize';
import type { TxnKind } from '../core/types';
import { classifyHeader } from './detectColumns';
import type {
  ColumnMapping, CounterpartyRef, ParseResult, RawTable, SkippedRow, StatementRow,
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

export function parseRows(table: RawTable, mapping: ColumnMapping, fileId: string): ParseResult {
  const rows = table.rows;
  const start = mapping.headerRow + 1;
  const skipped: SkippedRow[] = [];
  const drafts: Draft[] = [];
  let openingBalance: number | undefined;
  const warnings: string[] = [];
  let totalRows = 0;

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
        }
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
          if (a.sign !== 0) { direction = a.sign < 0 ? 'out' : 'in'; directionSource = 'sign'; }
        }
        break;
      }
    }

    const balParsed = parseAmount(cell(row, mapping.balance));
    const balance = balParsed ? (balParsed.sign < 0 ? -balParsed.value : balParsed.value) : undefined;

    const description = descCols.map((c) => cell(row, c)).filter(Boolean).join(' ');
    const channel = cell(row, mapping.channel) || undefined;
    const reference = cell(row, mapping.reference) || undefined;
    const location = cell(row, mapping.location) || undefined;

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
        d.direction = delta > 0 ? 'in' : 'out';
        d.directionSource = 'balance';
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
      const out = OUT_WORDS.test(d.textForKind);
      const inn = IN_WORDS.test(d.textForKind);
      if (out && !inn) { d.direction = 'out'; d.directionSource = 'keyword'; d.flags.push('direction_from_keyword'); }
      else if (inn && !out) { d.direction = 'in'; d.directionSource = 'keyword'; d.flags.push('direction_from_keyword'); }
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
      skipped.push({ row: d.rowIdx + 1, reason: 'ไม่มียอดเงินที่อ่านได้', text: rows[d.rowIdx]!.filter(Boolean).join(' | ').slice(0, 140) });
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
      if (Math.abs(expected - d.balance) > 0.011) {
        balanceMismatches++;
        flags.push('balance_mismatch');
      }
    }
    if (d.balance !== undefined) expectedPrev = d.balance;
    else expectedPrev = undefined;

    if (mapping.cpFromDescription && (!d.cp.number || !d.cp.name || !d.cp.bank)) {
      // ทำหลังรวมบรรทัดต่อแล้ว เพื่อให้ได้ข้อความรายละเอียดครบ
      const ex = extractCounterparty(d.textForKind);
      let usedGuess = false;
      if (!d.cp.number && ex.accountNumber) { d.cp.number = ex.accountNumber.number; usedGuess = true; }
      if (!d.cp.name && ex.name) { d.cp.name = ex.name; usedGuess = true; }
      if (!d.cp.bank && ex.bank) { d.cp.bank = ex.bank; usedGuess = true; }
      if (usedGuess) d.cp.inferred = true;
    }

    const kind = classifyKind(d.direction, d.textForKind);
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
    },
  };
}

function hasAnyMovement(row: string[], m: ColumnMapping): boolean {
  return [m.withdrawal, m.deposit, m.amount].some((c) => {
    const p = parseAmount(cell(row, c));
    return p !== null && p.value > 0;
  });
}
