// ตรวจรูปแบบ statement ที่ระบบรู้จักจากลายเซ็นของหัวตาราง — ไม่เดาจากชื่อไฟล์
// รูปแบบที่ไม่รู้จักจะได้ null แล้ว detectColumns เดาแบบทั่วไปแทน (ผู้ใช้แก้การจับคู่คอลัมน์ได้เสมอ)
//
// รูปแบบที่รองรับ (ตรวจกับไฟล์ตัวอย่างจริงที่ผู้ใช้ให้มา):
//  - std-export        ไฟล์ส่งออกมาตรฐานที่ธนาคารส่งให้เจ้าหน้าที่ (หัวตาราง setid, letterid, txdate, fromaccountno …) เช่น SCB
//  - from-to-statement รายการเดินบัญชีที่มีคอลัมน์ต้นทาง/ปลายทาง + ถอน/ฝาก แยกกัน เช่น กสิกรไทย
//  - baac-detail       รายการเคลื่อนไหวธุรกรรมของ ธ.ก.ส. (จำนวนเงินคอลัมน์เดียว ทิศทางดูจากยอดคงเหลือ)
//  - ktb-statement     รายการของกรุงไทย (จำนวนเงินคอลัมน์เดียว ทิศทางดูจากฝั่งผู้โอน/ผู้รับโอน)

import type { EvidenceKey, TxnKind } from '../core/types';
import { bankFromBotCode, normalizeAccountForBank, normalizeBank } from '../core/normalize';
import { normalizeHeader } from './text';
import type { ColumnMapping, FormatId, OwnerSuggestion, PartyCols, RawTable } from './types';

export interface FormatMatch {
  id: FormatId;
  label: string;
  mapping: ColumnMapping;
  /** ข้อมูลเจ้าของที่รูปแบบนี้บอกได้ (ธนาคาร/หมายเหตุ/meta; std-export บอกเลขบัญชีและชื่อด้วย) */
  owner: OwnerSuggestion;
  score: number;
}

const SCAN_ROWS = 40;

const baseMapping = (headerRow: number, format: FormatId): ColumnMapping => ({
  headerRow,
  amountMode: 'two-columns',
  yearMode: 'auto',
  dayFirst: true,
  cpFromDescription: false,
  format,
});

const nonEmpty = (v: number | undefined): v is number => v !== undefined;
/** ตัดคีย์ที่หาคอลัมน์ไม่เจอ (undefined) ออก */
const compactCols = (o: Partial<Record<EvidenceKey, number | undefined>>): Partial<Record<EvidenceKey, number>> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<Record<EvidenceKey, number>>;
const cellAt = (row: string[], i: number | undefined): string => (i === undefined ? '' : (row[i] ?? '').trim());

/** ค่าที่พบบ่อยที่สุดของคอลัมน์ (ไม่นับค่าว่าง) */
function modeOf(rows: string[][], start: number, col: number | undefined, limit = 3000): string | undefined {
  if (col === undefined) return undefined;
  const counts = new Map<string, number>();
  for (let r = start; r < Math.min(rows.length, start + limit); r++) {
    const v = cellAt(rows[r]!, col);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: [string, number] | undefined;
  for (const e of counts) if (!best || e[1] > best[1]) best = e;
  return best?.[0];
}

/** แถวหัวเอกสารก่อนหัวตาราง → คู่ "ป้าย : ค่า" (แต่ละเซลล์แยกกัน) สำหรับเก็บเป็นข้อมูลประกอบบัญชี */
const META_LABEL: Record<string, string> = {
  'สาขาเจ้าของบัญชี': 'สาขา',
  'สถานะ': 'สถานะบัญชี',
  'วันที่เปิด': 'วันที่เปิดบัญชี',
  'วันที่ปิด': 'วันที่ปิดบัญชี',
  'ID': 'เลขประจำตัว (ID)',
};
const META_SKIP = /เลขที่บัญชี|หมายเลขบัญชี|เลขบัญชี|ชื่อบัญชี|ระหว่างวันที่|ตั้งแต่วันที่/;

function preambleMeta(rows: string[][], headerRow: number): Record<string, string> {
  const meta: Record<string, string> = {};
  for (let r = 0; r < Math.min(headerRow, 15); r++) {
    for (const cell of rows[r] ?? []) {
      const m = cell.match(/^\s*([^:：]{1,40}?)\s*[:：]\s*(.+?)\s*$/);
      if (!m) continue;
      const label = m[1]!.trim();
      const value = m[2]!.trim();
      if (!value || /^[-–—\s]+$/.test(value) || META_SKIP.test(label)) continue;
      meta[META_LABEL[label] ?? label] = value.slice(0, 160);
    }
  }
  return meta;
}

// ---------------------------------------------------------------------------------------------
// std-export

const STD_REQUIRED = ['txdate', 'txtime', 'txtype', 'fromaccountno', 'toaccountno', 'deposit', 'withdrawal', 'balance'];

function matchStdExport(rows: string[][], r: number, h: string[]): FormatMatch | null {
  if (!STD_REQUIRED.every((k) => h.includes(k))) return null;
  const at = (k: string) => {
    const i = h.indexOf(k);
    return i < 0 ? undefined : i;
  };
  const mapping: ColumnMapping = {
    ...baseMapping(r, 'std-export'),
    date: at('txdate'),
    time: at('txtime'),
    description: at('txtype'),
    channel: at('txchannel'),
    deposit: at('deposit'),
    withdrawal: at('withdrawal'),
    balance: at('balance'),
    reference: at('txno'),
    cpFrom: { account: at('fromaccountno'), name: at('fromaccountname'), bank: at('frombankcode') },
    cpTo: { account: at('toaccountno'), name: at('toaccountname'), bank: at('tobankcode') },
    evidence: compactCols({
      ip: at('ipaddress'), phone: at('telephone'), email: at('email'), atmId: at('machinecode'),
      atmBank: at('machineowner'), branch: at('branchcode'), teller: at('empcode'), cheque: at('chequeno'),
    }),
  };

  const first = rows.slice(r + 1).find((row) => row.some(Boolean));
  const bank = bankFromBotCode(cellAt(first ?? [], at('bankcode')));
  const acct = normalizeAccountForBank(cellAt(first ?? [], at('accountno')), bank);
  const owners = new Set<string>();
  const acctCol = at('accountno');
  for (let i = r + 1; i < rows.length; i++) {
    const v = cellAt(rows[i]!, acctCol);
    if (v) owners.add(v);
  }
  const meta: Record<string, string> = {};
  const letter = cellAt(first ?? [], at('letterid'));
  if (letter) meta['เลขที่หนังสือขอข้อมูล'] = letter;
  const notes: string[] = [];
  if (owners.size > 1) {
    notes.push(`ไฟล์นี้มีรายการของ ${owners.size} บัญชี (คอลัมน์ accountno) — นำเข้าเป็นบัญชีเดียวจะปะปนกัน แนะนำแยกไฟล์ต่อบัญชีก่อนนำเข้า`);
  }
  return {
    id: 'std-export',
    label: 'ไฟล์ส่งออกมาตรฐานจากธนาคาร (setid / letterid / fromaccountno …)',
    mapping,
    owner: {
      bank,
      number: acct?.number,
      name: cellAt(first ?? [], at('accountname')) || undefined,
      meta: Object.keys(meta).length ? meta : undefined,
      notes: notes.length ? notes : undefined,
    },
    score: 100 + h.filter(Boolean).length,
  };
}

// ---------------------------------------------------------------------------------------------
// ธ.ก.ส.

const BAAC_REQUIRED = ['วันที่มีผล', 'คำอธิบายรายการ', 'รายละเอียดธุรกรรม', 'คงเหลือ', 'จำนวนเงิน'].map(normalizeHeader);

function matchBaac(rows: string[][], r: number, h: string[]): FormatMatch | null {
  if (!BAAC_REQUIRED.every((k) => h.includes(k))) return null;
  const at = (k: string) => {
    const i = h.indexOf(normalizeHeader(k));
    return i < 0 ? undefined : i;
  };
  const mapping: ColumnMapping = {
    ...baseMapping(r, 'baac-detail'),
    amountMode: 'infer-balance',
    date: at('วันที่มีผล'),
    time: at('เวลา'),
    description: at('คำอธิบายรายการ'),
    extra: [at('รายละเอียดธุรกรรม')].filter(nonEmpty),
    channel: at('ช่องทาง'),
    amount: at('จำนวนเงิน'),
    balance: at('คงเหลือ'),
  };
  const meta = preambleMeta(rows, r);
  return {
    id: 'baac-detail',
    label: 'ธ.ก.ส. — รายการเคลื่อนไหวธุรกรรม (แบบมีรายละเอียด)',
    mapping,
    owner: { bank: 'BAAC', meta: Object.keys(meta).length ? meta : undefined },
    score: 100 + h.filter(Boolean).length,
  };
}

// ---------------------------------------------------------------------------------------------
// กรุงไทย

/** คอลัมน์คู่ "ธนาคาร | เลขบัญชี" ใต้หัวที่ merge — ดูจากเนื้อหาว่าคอลัมน์ไหนเป็นเลขบัญชี */
function bankAccountPair(rows: string[][], start: number, c: number): PartyCols {
  const digitsRatio = (col: number) => {
    let n = 0;
    let d = 0;
    for (let i = start; i < Math.min(rows.length, start + 400); i++) {
      const v = cellAt(rows[i]!, col);
      if (!v) continue;
      n++;
      if (/^[0-9Xx*\-]{6,}$/.test(v)) d++;
    }
    return n ? d / n : 0;
  };
  return digitsRatio(c) > 0.5 && digitsRatio(c + 1) <= 0.5 ? { account: c, bank: c + 1 } : { bank: c, account: c + 1 };
}

function matchKtb(rows: string[][], r: number, h: string[]): FormatMatch | null {
  const has = (needle: string) => h.findIndex((x) => x.includes(normalizeHeader(needle)));
  const exact = (needle: string) => {
    const i = h.indexOf(normalizeHeader(needle));
    return i < 0 ? undefined : i;
  };
  const from = has('บัญชีผู้โอน');
  const to = has('บัญชีผู้รับโอน');
  const machine = has('หมายเลขเครื่อง');
  if (from < 0 || to < 0 || machine < 0) return null;
  const note = has('หมายเหตุ');
  const bankCol = exact('ธนาคาร');
  const loc = has('สถานที่');
  const mapping: ColumnMapping = {
    ...baseMapping(r, 'ktb-statement'),
    amountMode: 'signed',
    directionFromParties: true,
    date: exact('วันที่'),
    time: exact('เวลา'),
    description: exact('รายการ'),
    extra: note >= 0 ? [note] : undefined,
    location: loc >= 0 ? loc : undefined,
    amount: has('จำนวนเงิน') >= 0 ? has('จำนวนเงิน') : undefined,
    cpFrom: bankAccountPair(rows, r + 1, from),
    cpTo: bankAccountPair(rows, r + 1, to),
    evidence: compactCols({ atmId: machine, atmBank: bankCol }),
  };
  // ธนาคารเจ้าของ = ธนาคารที่ปรากฏบ่อยสุดในคอลัมน์ "ธนาคาร" (ช่องทางของเจ้าของบัญชีเองคือส่วนใหญ่)
  const bank = normalizeBank(modeOf(rows, r + 1, bankCol));
  const meta: Record<string, string> = {};
  for (let i = 0; i < r; i++) {
    const line = (rows[i] ?? []).join(' ');
    const branch = line.match(/สาขา\s*(\S+(?:\s\S+)?)\s+ชื่อบัญชี/);
    if (branch) meta['สาขา'] = branch[1]!.trim();
    const pid = line.match(/เลขประจำตัวประชาชน\s*(\d{13})/);
    if (pid) meta['เลขประจำตัวประชาชน'] = pid[1]!;
  }
  return {
    id: 'ktb-statement',
    label: 'กรุงไทย — รายการ (ผู้โอน / ผู้รับโอน)',
    mapping,
    owner: { bank: bank ?? 'KTB', meta: Object.keys(meta).length ? meta : undefined },
    score: 100 + h.filter(Boolean).length,
  };
}

// ---------------------------------------------------------------------------------------------
// รายการเดินบัญชีแบบต้นทาง/ปลายทาง (กสิกรไทย)

const KBANK_CHANNEL_RE = /k\s*plus|k\s*shop|make\s*by\s*kbank|kbank/i;

function matchFromTo(rows: string[][], r: number, h: string[]): FormatMatch | null {
  // ลองคำค้นตามลำดับความสำคัญ (คำแรกที่เจอในคอลัมน์ใดก็ได้ชนะ) — "รายการ" เป็นส่วนหนึ่งของ "วันที่ทำรายการ" จึงต้องไม่เรียงตามคอลัมน์
  const has = (...needles: string[]) => {
    for (const n of needles.map(normalizeHeader)) {
      const i = h.findIndex((x) => x && x.includes(n));
      if (i >= 0) return i;
    }
    return undefined;
  };
  const fromAcc = has('หมายเลขบัญชีต้นทาง', 'เลขที่บัญชีต้นทาง', 'เลขบัญชีต้นทาง');
  const toAcc = has('หมายเลขบัญชีปลายทาง', 'เลขที่บัญชีปลายทาง', 'เลขบัญชีปลายทาง');
  const withdrawal = has('ถอนเงิน', 'ถอน');
  const deposit = has('ฝากเงิน', 'ฝาก');
  const date = has('วันที่ทำรายการ', 'วันที่');
  if ([fromAcc, toAcc, withdrawal, deposit, date].some((v) => v === undefined)) return null;
  const channel = has('ช่องทาง');
  const mapping: ColumnMapping = {
    ...baseMapping(r, 'from-to-statement'),
    date,
    time: has('เวลาที่ทำรายการ', 'เวลา'),
    description: has('ประเภทรายการ', 'รายการ'),
    channel,
    withdrawal,
    deposit,
    balance: has('ยอดเงินคงเหลือ', 'คงเหลือ'),
    location: has('atm/cdm location', 'location'),
    cpFrom: { bank: has('ชื่อธนาคารต้นทาง', 'ธนาคารต้นทาง'), account: fromAcc, name: has('ชื่อบัญชีต้นทาง') },
    cpTo: { bank: has('ชื่อธนาคารปลายทาง', 'ธนาคารปลายทาง'), account: toAcc, name: has('ชื่อบัญชีปลายทาง') },
    evidence: compactCols({
      card: has('หมายเลขบัตร'), atmId: has('หมายเลขตู้'), atmBank: has('ธนาคารเจ้าของตู้'), teller: has('tellerid'),
      branch: has('รหัสสาขา'), cheque: has('เลขที่เช็ค'), ip: has('ipaddress'), lat: has('latitude'), lng: has('longitude'),
    }),
  };
  // ธนาคารเจ้าของ: บอกได้เฉพาะเมื่อช่องทางเป็นของธนาคารนั้นชัดเจน (เช่น K PLUS) — ไม่เช่นนั้นให้ผู้ใช้เลือกเอง
  let kbankHits = 0;
  for (let i = r + 1; i < Math.min(rows.length, r + 400); i++) if (KBANK_CHANNEL_RE.test(cellAt(rows[i]!, channel))) kbankHits++;
  const bank = kbankHits >= 3 || h.some((x) => x.startsWith('tellerid')) ? 'KBANK' : undefined;
  const meta: Record<string, string> = {};
  for (let i = 0; i < r; i++) {
    const m = (rows[i] ?? []).join(' ').match(/รายการเดินบัญชี\s*(.+)$/);
    if (m && !/ของหมายเลข/.test(m[1]!)) meta['ประเภทบัญชี'] = m[1]!.trim();
  }
  return {
    id: 'from-to-statement',
    label: `${bank ? 'กสิกรไทย' : 'รายการเดินบัญชี'} — แยกต้นทาง/ปลายทาง + ถอน/ฝาก`,
    mapping,
    owner: { bank, meta: Object.keys(meta).length ? meta : undefined },
    score: 100 + h.filter(Boolean).length,
  };
}

// ---------------------------------------------------------------------------------------------

export function detectFormat(table: RawTable): FormatMatch | null {
  const rows = table.rows;
  for (let r = 0; r < Math.min(rows.length, SCAN_ROWS); r++) {
    const h = rows[r]!.map(normalizeHeader);
    if (h.filter(Boolean).length < 4) continue;
    const m = matchStdExport(rows, r, h) ?? matchBaac(rows, r, h) ?? matchKtb(rows, r, h) ?? matchFromTo(rows, r, h);
    if (m) return m;
  }
  return null;
}

/** ประเภทรายการที่ธนาคารระบุเป็นรหัสตายตัว ซึ่ง regex ทั่วไปจัดผิด */
export function formatKind(format: FormatId | undefined, description: string): TxnKind | undefined {
  // ไฟล์ส่งออกมาตรฐาน: "อื่นๆ" = ค่าธรรมเนียม/รายการระบบ ไม่ใช่การถอนเงินสด แม้ผ่านช่องทาง ATM
  if (format === 'std-export' && /^อื่น/.test(description.trim())) return 'other';
  return undefined;
}

/** กรุงไทย: ช่อง "รายการ" ระบุทิศทางของฝาก/ถอน/ชำระ ตรง ๆ (ไม่ใช่การเดาจากข้อความอิสระ) */
export function formatDirection(format: FormatId | undefined, description: string): 'in' | 'out' | null {
  if (format !== 'ktb-statement') return null;
  const d = description.trim();
  if (/^ฝาก/.test(d)) return 'in';
  if (/^(ถอน|ชำระ)/.test(d)) return 'out';
  return null;
}
