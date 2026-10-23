// ข้อมูลสมมติสำหรับทดลองใช้งานและสร้างไฟล์ทดสอบ — ชื่อ เลขบัญชี และเหตุการณ์ทั้งหมดเป็นการสมมติ ไม่เกี่ยวข้องกับบุคคลจริง
// โครงสร้างหลักอิงตัวอย่างในคู่มือการวิเคราะห์: A → B1,B2,B3 → C → D → E → F → ATM (ทำซ้ำ 3 วัน) พร้อมรายการพื้นหลัง
import type { TxnKind } from './core/types';
import { bankDisplay, formatAccountNumber } from './core/normalize';
import { createCaseState, type CaseState, type StoredFile } from './store/model';
import type { StatementRow } from './ingest/types';

export interface DemoRow {
  ts: number;
  dir: 'in' | 'out';
  amount: number;
  kind: TxnKind;
  description: string;
  channel: string;
  cpBank?: string;
  cpNumber?: string;
  cpName?: string;
  location?: string;
  balance: number;
}

export interface DemoOwner {
  key: string;
  bank: string;
  number: string;
  name: string;
  opening: number;
  rows: DemoRow[];
  /** แสดงเลขบัญชีคู่โอนแบบปิดบางส่วนใน Statement ของเจ้าของนี้ */
  maskCounterparties?: boolean;
}

interface Party { key: string; bank: string; number: string; name: string; statement: boolean }

const PARTIES: Party[] = [
  { key: 'A', bank: 'KBANK', number: '1111111111', name: 'นายเอก ตัวอย่างสมมติ', statement: true },
  { key: 'B1', bank: 'SCB', number: '2222222221', name: 'นางสาวบุษบา สมมติใจ', statement: true },
  { key: 'B2', bank: 'BBL', number: '3333333332', name: 'นายบุญชู ทดลองระบบ', statement: true },
  { key: 'B3', bank: 'KTB', number: '4444444443', name: 'นายบัณฑิต จำลองข้อมูล', statement: true },
  { key: 'C', bank: 'KBANK', number: '5555555554', name: 'นางจินตนา สมมุติฐาน', statement: true },
  { key: 'D', bank: 'SCB', number: '7777777776', name: 'นายดนัย ตัวอย่างระบบ', statement: true },
  { key: 'E', bank: 'BAY', number: '8888888887', name: 'นางสาวเอมิกา ทดสอบ', statement: true },
  { key: 'F', bank: 'TTB', number: '6666666665', name: 'นายฟ้า สมมติสาม', statement: true },
  { key: 'X1', bank: 'SCB', number: '9999999990', name: 'นายสมศักดิ์ ให้ยืมสมมติ', statement: false },
];

const P = Object.fromEntries(PARTIES.map((p) => [p.key, p])) as Record<string, Party>;
const T = (d: number, h: number, m: number) => Date.UTC(2024, 2, d, h, m, 0);

interface Ev {
  ts: number;
  from?: string;
  to?: string;
  /** ชื่อคู่โอนที่ไม่มีบัญชี (เช่น นายจ้าง/ร้านค้า) */
  extName?: string;
  amount: number;
  kind: TxnKind;
  owner?: string; // สำหรับรายการเงินสด/ชำระเงิน/ดอกเบี้ย: เจ้าของ
  desc?: string;
  channel?: string;
  location?: string;
}

function events(): Ev[] {
  const ev: Ev[] = [];
  const tr = (ts: number, from: string, to: string, amount: number, channel = 'แอปพลิเคชัน') => ev.push({ ts, from, to, amount, kind: 'transfer', channel });

  // --- ที่มาของเงิน ---
  tr(T(4, 16, 20), 'X1', 'A', 300_000);

  // --- เหตุการณ์หลัก 3 วัน: แบ่งโอน → รวมเงิน → ส่งต่อ → ถอนเงินสด ---
  const day = (d: number, h: number, amts: [number, number, number], cEnd: number) => {
    const [a1, a2, a3] = amts;
    tr(T(d, h, 0), 'A', 'B1', a1); tr(T(d, h, 1), 'A', 'B2', a2); tr(T(d, h, 2), 'A', 'B3', a3);
    tr(T(d, h, 10), 'B1', 'C', a1); tr(T(d, h, 11), 'B2', 'C', a2); tr(T(d, h, 12), 'B3', 'C', a3);
    const total = a1 + a2 + a3;
    tr(T(d, h, 20), 'C', 'D', total);
    tr(T(d, h, 30), 'D', 'E', total - cEnd);
    tr(T(d, h, 40), 'E', 'F', total - cEnd * 2);
    ev.push({ ts: T(d, h, 55), from: 'F', amount: total - cEnd * 3, kind: 'cash_withdrawal', owner: 'F', channel: 'ATM', location: `ตู้ ATM สาขาสมมติ ${d === 5 ? 'ก' : d === 8 ? 'ข' : 'ค'}` });
  };
  day(5, 9, [95_000, 94_000, 96_000], 5_000);
  tr(T(8, 9, 30), 'X1', 'A', 150_000);
  day(8, 10, [49_000, 50_000, 48_500], 2_000);
  tr(T(11, 9, 40), 'X1', 'A', 200_000);
  day(11, 11, [66_000, 67_500, 66_500], 3_000);

  // --- เงินวนกลับ (A → B1 → C → A) ---
  tr(T(7, 13, 0), 'C', 'A', 20_000);
  tr(T(7, 13, 25), 'A', 'B1', 19_800);
  tr(T(7, 14, 10), 'B1', 'C', 19_500);

  // --- รายการพื้นหลัง (พฤติกรรมปกติ: เงินเดือน ค่าใช้จ่าย ค่าเช่า) ---
  const salary = (owner: string, d: number, amount: number, name: string) => ev.push({ ts: T(d, 8, 5), to: owner, extName: name, amount, kind: 'transfer', channel: 'เงินเดือน' });
  salary('A', 1, 35_000, 'บริษัท ตัวอย่างระบบ จำกัด');
  salary('B1', 1, 25_000, 'บริษัท ตัวอย่างระบบ จำกัด');
  salary('B3', 1, 22_000, 'หจก. สมมติการค้า');
  ev.push({ ts: T(3, 18, 30), from: 'B1', extName: 'นางสาวเจ้าของหอพักสมมติ', amount: 8_000, kind: 'transfer', channel: 'แอปพลิเคชัน', desc: 'ค่าเช่าห้อง' });
  ev.push({ ts: T(2, 12, 30), kind: 'payment', owner: 'A', amount: 450, desc: 'ชำระเงิน QR ร้านอาหารสมมติ', channel: 'QR Payment' });
  ev.push({ ts: T(3, 10, 5), kind: 'payment', owner: 'B2', amount: 1_250, desc: 'ชำระเงิน QR ร้านสะดวกซื้อสมมติ', channel: 'QR Payment' });
  ev.push({ ts: T(3, 9, 15), kind: 'cash_withdrawal', owner: 'A', amount: 3_000, desc: 'ถอนเงินสด ATM', channel: 'ATM', location: 'ตู้ ATM สาขาสมมติ ง', from: 'A' });
  ev.push({ ts: T(6, 17, 40), kind: 'cash_withdrawal', owner: 'B3', amount: 5_000, desc: 'ถอนเงินสด ATM', channel: 'ATM', location: 'ตู้ ATM สาขาสมมติ จ', from: 'B3' });
  // ร้านค้า B2 รับชำระจากลูกค้าหลายราย (พฤติกรรมปกติของบัญชีรับชำระ)
  const cust = ['นายลูกค้า หนึ่ง', 'นางสาวลูกค้า สอง', 'นายลูกค้า สาม', 'นางลูกค้า สี่', 'นายลูกค้า ห้า'];
  cust.forEach((n, i) => ev.push({ ts: T(2 + (i % 3), 11 + i, 20), to: 'B2', extName: n, amount: 1_500 + i * 350, kind: 'transfer', channel: 'พร้อมเพย์' }));
  // ความสัมพันธ์เดิมระหว่าง B2 กับ C (ให้ยืม-คืน)
  tr(T(3, 15, 0), 'B2', 'C', 12_000);
  tr(T(9, 15, 10), 'C', 'B2', 12_500);
  ev.push({ ts: T(10, 0, 0), kind: 'interest', owner: 'B2', amount: 18.5, to: 'B2', desc: 'ดอกเบี้ยเงินฝาก', channel: 'ระบบ' });
  return ev.sort((a, b) => a.ts - b.ts);
}

const bankName = (b: string) => bankDisplay(b);
const acct = (n: string) => formatAccountNumber(n);
const mask = (n: string) => 'xxx-x-x' + n.slice(5, 9) + '-x';

export function buildDemoScenario(): DemoOwner[] {
  const owners: DemoOwner[] = PARTIES.filter((p) => p.statement).map((p) => ({
    key: p.key, bank: p.bank, number: p.number, name: p.name, opening: 0, rows: [] as DemoRow[],
    maskCounterparties: p.key === 'F' || p.key === 'D',
  }));
  const byKey = Object.fromEntries(owners.map((o) => [o.key, o]));

  const addRow = (o: DemoOwner, r: Omit<DemoRow, 'balance'>) => o.rows.push({ ...r, balance: 0 });
  const cpFields = (viewer: DemoOwner, p: Party | undefined, extName?: string) => {
    if (p) {
      const num = viewer.maskCounterparties ? mask(p.number) : acct(p.number);
      return { cpBank: p.bank, cpNumber: num, cpName: p.name, text: `${bankName(p.bank)} ${num} ${p.name}` };
    }
    return { cpName: extName, text: extName ?? '' };
  };

  for (const e of events()) {
    if (e.kind === 'payment' || e.kind === 'cash_withdrawal' || e.kind === 'interest') {
      const o = byKey[e.owner!];
      if (!o) continue;
      addRow(o, {
        ts: e.ts, dir: e.kind === 'interest' ? 'in' : 'out', amount: e.amount, kind: e.kind,
        description: e.desc ?? (e.kind === 'cash_withdrawal' ? 'ถอนเงินสด ATM' : 'ชำระเงิน'), channel: e.channel ?? '', location: e.location,
      });
      continue;
    }
    const from = e.from ? P[e.from] : undefined;
    const to = e.to ? P[e.to] : undefined;
    const fromO = e.from ? byKey[e.from] : undefined;
    const toO = e.to ? byKey[e.to] : undefined;
    if (fromO) {
      const cp = cpFields(fromO, to, e.extName);
      addRow(fromO, {
        ts: e.ts, dir: 'out', amount: e.amount, kind: 'transfer', channel: e.channel ?? '',
        description: `${e.desc ? e.desc + ' ' : 'โอนเงินไป '}${cp.text}`.trim(), cpBank: cp.cpBank, cpNumber: cp.cpNumber, cpName: cp.cpName,
      });
    }
    if (toO) {
      const cp = cpFields(toO, from, e.extName);
      addRow(toO, {
        ts: e.ts + (fromO ? 60_000 : 0), dir: 'in', amount: e.amount, kind: 'transfer', channel: e.channel ?? '',
        description: `${e.desc ? e.desc + ' ' : 'รับโอนจาก '}${cp.text}`.trim(), cpBank: cp.cpBank, cpNumber: cp.cpNumber, cpName: cp.cpName,
      });
    }
  }
  // ถอนเงินสดของ F ในกรณี from === 'F' และ kind cash (จัดการไว้ข้างบนแล้ว) — คำนวณยอดคงเหลือ
  for (const o of owners) {
    o.rows.sort((a, b) => a.ts - b.ts);
    let run = 0;
    let min = 0;
    for (const r of o.rows) {
      run += r.dir === 'in' ? r.amount : -r.amount;
      min = Math.min(min, run);
    }
    o.opening = Math.round((-min + 5_000 + (o.key.charCodeAt(0) % 7) * 1_000) * 100) / 100;
    let bal = o.opening;
    for (const r of o.rows) {
      bal += r.dir === 'in' ? r.amount : -r.amount;
      r.balance = Math.round(bal * 100) / 100;
    }
  }
  return owners;
}

/** แปลง DemoOwner เป็น StatementRow (ข้ามขั้นอ่านไฟล์) เพื่อสร้างคดีตัวอย่างทันที */
export function buildDemoCase(): CaseState {
  const st = createCaseState('คดีตัวอย่าง (ข้อมูลสมมติ)', { caseNumber: 'ตัวอย่าง 1/2567', investigator: 'ผู้ใช้ทดลอง', agency: 'หน่วยงานสมมติ' });
  const owners = buildDemoScenario();
  let n = 0;
  for (const o of owners) {
    const fileId = `demo_${o.key}`;
    const rows: StatementRow[] = o.rows.map((r, i) => ({
      fileId, row: i + 2, seq: i, ts: r.ts, hasTime: true, direction: r.dir, amount: r.amount, kind: r.kind,
      channel: r.channel || undefined, description: r.description, location: r.location, balanceAfter: r.balance,
      cp: { number: r.cpNumber?.replace(/[-\s]/g, '').replace(/x/g, 'X'), bank: r.cpBank, name: r.cpName, inferred: false },
      directionSource: 'column', flags: [],
    }));
    const first = rows[0]?.ts;
    const last = rows[rows.length - 1]?.ts;
    const stored: StoredFile = {
      record: {
        id: fileId, name: `statement_${o.key}_${o.bank.toLowerCase()}.demo`, size: 0, sha256: `demo-${o.key}`.padEnd(64, '0'), type: 'csv',
        importedAt: Date.now() + n++, ownerAccountId: `${o.bank}:${o.number}`, rowsTotal: rows.length, rowsImported: rows.length,
        rowsSkipped: 0, duplicatesRemoved: 0, firstTs: first, lastTs: last, warnings: [], balanceChecks: { checked: rows.length, mismatches: 0 },
        mappingSummary: 'ข้อมูลตัวอย่างที่สร้างในแอป',
      },
      owner: { bank: o.bank, number: o.number, name: o.name },
      rows,
      skipped: [],
    };
    st.files.push(stored);
  }
  return st;
}
