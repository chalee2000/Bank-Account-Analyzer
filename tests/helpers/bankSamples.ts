// ไฟล์ตัวอย่างสังเคราะห์ที่จำลอง "โครงสร้างและความแปลก" ของ statement จริงจากธนาคารต่าง ๆ
// (ชื่อ เลขบัญชี และตัวเลขทั้งหมดสมมติขึ้น ไม่ใช่ข้อมูลจริงของใคร)
import ExcelJS from 'exceljs';

export async function toFile(wb: ExcelJS.Workbook, name: string): Promise<File> {
  const buf = await wb.xlsx.writeBuffer();
  return new File([buf as ArrayBuffer], name);
}

/** วันที่แบบ Date ใน UTC (ตามหลัก wall-clock ของแอป) — ปีส่งเป็น พ.ศ. ได้ตามที่ธนาคารบางแห่งเก็บในเซลล์วันที่ */
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
/** เซลล์เวลาของ Excel = Date บนฐาน 1899-12-30 */
const clock = (h: number, mi: number, s = 0) => new Date(Date.UTC(1899, 11, 30, h, mi, s));

/** เติมแถวตามเลขคอลัมน์ (เริ่ม 1) */
function rowAt(ws: ExcelJS.Worksheet, width: number, cells: Record<number, ExcelJS.CellValue>) {
  const arr: ExcelJS.CellValue[] = Array.from({ length: width }, () => null);
  for (const [k, v] of Object.entries(cells)) arr[Number(k) - 1] = v;
  return ws.addRow(arr);
}

// ----------------------------------------------------------------------------------------------
// กสิกรไทย: หัวเอกสาร 3 บรรทัด, วันที่/เวลาเป็นข้อความ (พ.ศ.), คอลัมน์ต้นทาง/ปลายทาง + ถอน/ฝาก แยกกัน

export const KBANK_HEADERS = [
  'วันที่ทำรายการ', 'เวลาที่ทำรายการ', 'ประเภทรายการ', 'ช่องทาง', 'ชื่อธนาคารต้นทาง', 'หมายเลขบัญชีต้นทาง', 'ชื่อบัญชีต้นทาง',
  'ชื่อธนาคารปลายทาง', 'หมายเลขบัญชีปลายทาง', 'ชื่อบัญชีปลายทาง', 'หมายเลขบัตร', 'หมายเลขตู้ ATM/CDM', 'ธนาคารเจ้าของตู้ ATM/CDM',
  'ATM/CDM Location', 'ถอนเงิน', 'ฝากเงิน', 'ยอดเงินคงเหลือ', 'Teller ID (ผู้ทำรายการ)', 'รหัสสาขาที่ทำธุรกรรม', 'เลขที่เช็ค',
  'IP Address', 'Latitude', 'Longitude',
];

export async function kbankLikeFile(): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Statement');
  ws.addRow(['รายการเดินบัญชีเงินฝากออมทรัพย์']);
  ws.addRow(['ของหมายเลขบัญชี 111-2-33333-4 ชื่อบัญชี นาย ทดสอบ ระบบ']);
  ws.addRow(['ตั้งแต่วันที่ 01/01/2568 - 31/12/2568']);
  ws.addRow(KBANK_HEADERS);
  const W = KBANK_HEADERS.length;
  rowAt(ws, W, { 1: '10/02/2568', 2: '09:00:00', 3: 'เปิดบัญชี', 4: 'สาขาตัวอย่าง', 15: 0, 16: 0, 17: 0, 18: 'T0000001', 19: '0001' });
  rowAt(ws, W, { 1: '10/02/2568', 2: '09:05:30', 3: 'ฝากเงินสด', 4: 'สาขาตัวอย่าง', 15: 0, 16: 2000, 17: 2000, 18: 'T0000001', 19: '0001' });
  rowAt(ws, W, { 1: '10/02/2568', 2: '10:20:10', 3: 'รับโอนเงิน', 4: 'Internet/Mobile SCB', 5: 'SCB', 6: '5099988877', 7: 'นางสาว สมหญิง ตัวอย่าง', 12: 'TESTATM000000001', 15: 0, 16: 150, 17: 2150, 18: 'T0000002', 19: '0002' });
  rowAt(ws, W, { 1: '11/02/2568', 2: '12:30:00', 3: 'รับโอนเงินผ่าน QR', 4: 'EDC/K SHOP/MYQR', 15: 0, 16: 60, 17: 2210, 18: 'T0000003', 19: '0003' });
  rowAt(ws, W, { 1: '12/02/2568', 2: '08:15:00', 3: 'โอนเงิน', 4: 'K PLUS', 8: 'BBL', 9: '7011122233', 10: 'น.ส. ผู้รับ ทดสอบ', 15: 700, 16: 0, 17: 1510, 18: 'T0000004', 19: '0004', 21: '203.0.113.17', 22: '13.75000000', 23: '100.50000000' });
  rowAt(ws, W, { 1: '13/02/2568', 2: '09:00:00', 3: 'ถอนเงินสด', 4: 'ATM', 12: 'T0000042', 13: 'KBANK', 15: 300, 16: 0, 17: 1210, 18: 'T0000005', 19: '0004', 22: '0.00000000', 23: '0.00000000' });
  rowAt(ws, W, { 1: '30/06/2568', 2: '23:59:59', 3: 'รับดอกเบี้ยเงินฝาก', 4: 'โอนเข้า/หักบัญชีอัตโนมัติ', 15: 0, 16: 0.75, 17: 1210.75, 18: 'T0000006', 19: '0005' });
  return toFile(wb, 'kbank-like.xlsx');
}

// ----------------------------------------------------------------------------------------------
// ไฟล์ส่งออกมาตรฐาน (SCB): 32 คอลัมน์ภาษาอังกฤษ, เลขบัญชีเป็นตัวเลข (0 นำหน้าหาย), วันที่เป็น Date จริง,
// จำนวนเงินปัดเป็นบาทเต็มแต่ยอดคงเหลือมีสตางค์, ลำดับแถวไม่ตรงเวลา, มีชีตที่สองเป็นข้อความดิบ

export const STD_HEADERS = [
  'setid', 'letterid', 'letterdate', 'searchtype', 'accountno', 'accountname', 'bankcode', 'searchstatus', 'checkdate', 'txno',
  'txdate', 'txtime', 'txtype', 'fromaccountno', 'fromaccountname', 'frombankcode', 'toaccountno', 'toaccountname', 'tobankcode',
  'txchannel', 'deposit', 'withdrawal', 'balance', 'chequeno', 'branchcode', 'empcode', 'machinecode', 'machineowner', 'ipaddress',
  'telephone', 'email', 'note',
];
const OWNER_NO = 4012345678;
const OWNER_NAME = 'นางสาว ทดสอบ ตัวอย่าง';

interface StdOp {
  day: number; // วันที่ในเดือนพฤษภาคม 2023
  h: number;
  mi: number;
  kind: 'out' | 'in' | 'atm' | 'fee' | 'dep';
  amount: number; // จำนวนเงินที่แสดงในไฟล์ (บาทเต็ม)
  frac: number; // เศษสตางค์จริงที่ถูกปัดทิ้ง
}

export function stdOps(): StdOp[] {
  const ops: StdOp[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const kinds: StdOp['kind'][] = ['out', 'in', 'out', 'atm', 'in', 'out', 'dep', 'fee', 'out', 'in'];
  const used = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const kind = kinds[i % kinds.length]!;
    const d = 1 + Math.floor(i / 3);
    const h = Math.floor(rnd() * 24);
    let mi = Math.floor(rnd() * 60);
    while (used.has(`${d}-${h}-${mi}`)) mi = (mi + 1) % 60; // ไม่ให้เวลาซ้ำ เพื่อให้ลำดับของยอดคงเหลือชัดเจน
    used.add(`${d}-${h}-${mi}`);
    ops.push({
      day: d, h, mi, kind,
      amount: kind === 'fee' ? 10 : 100 + Math.floor(rnd() * 20) * 50,
      frac: kind === 'fee' ? 0 : Math.round((rnd() - 0.5) * 80) / 100, // −0.40 … +0.40
    });
  }
  return ops.sort((a, b) => a.day - b.day || a.h - b.h || a.mi - b.mi);
}

export async function stdExportLikeFile(opts: { shuffle?: boolean } = {}): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('4012345678 (2)');
  ws.addRow(STD_HEADERS);
  const C = (name: string) => STD_HEADERS.indexOf(name) + 1;
  const ops = stdOps();
  let bal = 10000.42;
  const rows: ExcelJS.CellValue[][] = [];
  ops.forEach((op, i) => {
    const trueAmt = op.amount + op.frac;
    const isIn = op.kind === 'in' || op.kind === 'dep';
    bal = Math.round((bal + (isIn ? trueAmt : -trueAmt)) * 100) / 100;
    const cells: Record<number, ExcelJS.CellValue> = {
      [C('setid')]: 10001, [C('letterid')]: 10001, [C('letterdate')]: day(2024, 2, 5), [C('searchtype')]: 'A',
      [C('accountno')]: OWNER_NO, [C('accountname')]: OWNER_NAME, [C('bankcode')]: 14, [C('searchstatus')]: 'F', [C('checkdate')]: day(2024, 2, 19),
      [C('txno')]: `${OWNER_NO}_2023-05-${String(op.day).padStart(2, '0')}_${String(op.h).padStart(2, '0')}:${String(op.mi).padStart(2, '0')}:00_${i + 1}`,
      [C('txdate')]: day(2023, 5, op.day), [C('txtime')]: clock(op.h, op.mi), [C('balance')]: bal,
      [C('chequeno')]: '                     ', [C('telephone')]: ' ', [C('note')]: '',
    };
    if (op.kind === 'out') {
      Object.assign(cells, {
        [C('txtype')]: 'โอน', [C('fromaccountno')]: OWNER_NO, [C('fromaccountname')]: OWNER_NAME, [C('frombankcode')]: 14,
        [C('toaccountno')]: 5111222333, [C('toaccountname')]: 'นาย ปลายทาง ตัวอย่าง', [C('tobankcode')]: 14, [C('txchannel')]: 'EBANK',
        [C('withdrawal')]: op.amount, [C('ipaddress')]: '203.0.113.45',
      });
    } else if (op.kind === 'in') {
      Object.assign(cells, {
        [C('txtype')]: 'โอน', [C('fromaccountno')]: 20123456789, [C('fromaccountname')]: '', [C('frombankcode')]: 30,
        [C('toaccountno')]: OWNER_NO, [C('toaccountname')]: OWNER_NAME, [C('tobankcode')]: 14, [C('txchannel')]: 'EBANK', [C('deposit')]: op.amount,
      });
    } else if (op.kind === 'atm') {
      Object.assign(cells, { [C('txtype')]: 'ถอน', [C('txchannel')]: 'ATM', [C('withdrawal')]: op.amount, [C('machinecode')]: 'M0001', [C('machineowner')]: 'KBNK' });
    } else if (op.kind === 'fee') {
      Object.assign(cells, { [C('txtype')]: 'อื่นๆ', [C('txchannel')]: 'ATM', [C('withdrawal')]: op.amount, [C('machineowner')]: 'KTBA' });
    } else {
      Object.assign(cells, { [C('txtype')]: 'ฝาก', [C('txchannel')]: 'BRANCH', [C('deposit')]: op.amount, [C('branchcode')]: '0007' });
    }
    const arr: ExcelJS.CellValue[] = Array.from({ length: STD_HEADERS.length }, () => null);
    for (const [k, v] of Object.entries(cells)) arr[Number(k) - 1] = v;
    rows.push(arr);
  });
  if (opts.shuffle) {
    // สลับลำดับแถวแบบกำหนดแน่นอน เพื่อจำลองไฟล์ที่เรียงไม่ตรงเวลา
    for (let i = rows.length - 1; i > 0; i--) {
      const j = (i * 7 + 3) % (i + 1);
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    }
  }
  rows.forEach((r) => ws.addRow(r));
  const raw = wb.addWorksheet('4012345678');
  raw.addRow([STD_HEADERS.slice(0, 8).join('|')]);
  for (let i = 0; i < ops.length; i++) raw.addRow(['demo|10001|10001|05/02/2567|A|4012345678|¹Ò§ÊÒÇ ·´Êͺ|']);
  return toFile(wb, 'std-export-like.xlsx');
}

// ----------------------------------------------------------------------------------------------
// ธ.ก.ส.: หัวเอกสารเป็นเซลล์ที่ merge, วันที่เป็น Date ปี พ.ศ., จำนวนเงินคอลัมน์เดียว (ทิศทางดูจากยอดคงเหลือ),
// มีรายการกลับรายการ (ติดลบ) และท้ายตารางบอกจำนวนรายการ

export async function baacLikeFile(): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  const put = (r: number, c: number, v: string, merge?: string) => {
    ws.getCell(r, c).value = v;
    if (merge) ws.mergeCells(merge);
  };
  put(1, 1, '- ลับ -', 'A1:F1');
  put(2, 1, 'รายการเคลื่อนไหวธุรกรรม (แบบมีรายละเอียดธุรกรรม)', 'A2:F2');
  put(3, 1, 'ระหว่างวันที่ 1 มีนาคม 2567 ถึง 31 มีนาคม 2567', 'A3:F3');
  put(4, 1, 'เลขที่บัญชี : 011122233344', 'A4:C4');
  put(4, 4, 'สาขาเจ้าของบัญชี  : 0000 - สาขาตัวอย่าง', 'D4:G4');
  put(5, 1, 'ชื่อบัญชี  : นายทดสอบ ตัวอย่าง', 'A5:C5');
  put(5, 4, 'ที่อยู่  : 99/9 หมู่ที่ 9 ต. ตัวอย่าง อ. ทดสอบ จ. สมมติ', 'D5:G5');
  put(6, 1, 'สถานะ : A - บัญชีใช้งานปกติ', 'A6:G6');
  put(7, 1, 'วันที่เปิด : 01/01/2550', 'A7:C7');
  put(7, 4, 'วันที่ปิด  : -', 'D7:E7');
  put(7, 6, 'ID : 1234567890123', 'F7:G7');
  ws.addRow([]);
  ws.addRow(['วันที่มีผล', 'เวลา', 'คำอธิบายรายการ', 'ช่องทาง', 'จำนวนเงิน', 'คงเหลือ', 'รายละเอียดธุรกรรม']);
  const add = (y: number, m: number, d: number, t: [number, number, number], desc: string, ch: string | null, amt: number, bal: number, detail: string) =>
    ws.addRow([day(y, m, d), clock(...t), desc, ch, amt, bal, detail]);
  add(2567, 3, 4, [9, 15, 30], 'ถอน-ATSWC ATM CASH WITHDRAWAL S/A ', 'ATM', 600, 9400.25, 'ถอน :  ผ่านตู้ ATM/ADM รหัส T0000043 ของธนาคาร KBNK');
  add(2567, 3, 11, [10, 5, 20], 'โอน-SPSC10 SPIN SAV Deposit', null, 1500, 10900.25, ' รหัสอ้างอิงธุรกรรม  00000000101SPSC10');
  add(2567, 3, 11, [14, 40, 55], 'โอน-SPSD21 SPIN SAV Withdrawal', null, 400, 10500.25, ' รหัสอ้างอิงธุรกรรม  00000000102SPSD21');
  add(2567, 3, 12, [11, 0, 0], 'โอน-PPACSDTR REAL ACCOUNT DEPOSIT S/A', null, 2500, 13000.25, 'รับเงินโอน : รับโอนจากธนาคารรหัส 006 เลขที่บัญชีผู้โอน 4855566677 ชื่อบัญชี TEST PERSON');
  add(2567, 3, 13, [16, 20, 10], 'ถอน-ATSWC ATM CASH WITHDRAWAL S/A ', 'ATM', 1000, 12000.25, 'ถอน :  ผ่านตู้ ATM/ADM รหัส T0000043 ของธนาคาร KBNK');
  add(2567, 3, 13, [16, 20, 10], 'ถอน-ATSWC ATM CASH WITHDRAWAL S/A ', 'ATM', -1000, 13000.25, 'ถอน :  ผ่านตู้ ATM/ADM รหัส T0000043 ของธนาคาร KBNK');
  add(2567, 3, 14, [8, 0, 0], 'โอน-ATSFE PC FEE WITHDRAWAL S/A', 'ATM', 10, 12990.25, 'ถามยอด : ผ่านตู้ ATM/ADM รหัส T0000043 ของธนาคาร KBNK');
  add(2567, 3, 15, [0, 59, 18], 'โอน-IIPS ปรับปรุงเพิ่มดอกเบี้ยจ่าย (ทบต้นแล้ว)', null, 4.25, 12994.5, ' รหัสอ้างอิงธุรกรรม  00000000103IIPS');
  const footer = ws.rowCount + 1;
  ws.getCell(footer, 1).value = ' รวมทั้งสิ้น  8 รายการ';
  ws.mergeCells(footer, 1, footer, 7);
  return toFile(wb, 'baac-like.xlsx');
}

// ----------------------------------------------------------------------------------------------
// กรุงไทย: หัวเอกสารบรรทัดเดียว, หัวตารางมี merge (ธนาคาร | เลขบัญชี ใต้หัวเดียว), จำนวนเงินคอลัมน์เดียว ไม่มียอดคงเหลือ,
// ทิศทางดูจากฝั่งผู้โอน/ผู้รับโอน

export async function ktbLikeFile(): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('1234567890');
  ws.addRow(['เลขที่บัญชี 1234567890 สาขาทดสอบ ชื่อบัญชี นางสาว ตัวอย่าง ทดสอบ เลขประจำตัวประชาชน 1234567890123']);
  ws.addRow(['วันที่', 'เวลา', 'ธนาคาร', 'หมายเลขเครื่อง', 'สถานที่', 'รายการ', 'ธนาคาร -บัญชีผู้โอน', '', 'ธนาคาร -  บัญชีผู้รับโอน', '', 'จำนวนเงิน', 'หมายเหตุ']);
  ws.mergeCells('G2:H2');
  ws.mergeCells('I2:J2');
  const add = (d: [number, number, number], t: [number, number, number], bank: string, machine: string | null, place: string, type: string, payer: [string, string] | null, payee: [string, string] | null, amount: number, note: string | null) =>
    ws.addRow([day(...d), clock(...t), bank, machine, place, type, payer?.[0] ?? null, payer?.[1] ?? null, payee?.[0] ?? null, payee?.[1] ?? null, amount, note]);
  add([2566, 8, 1], [10, 0, 0], 'กรุงไทย', null, 'สาขาทดสอบ', 'ฝากเงิน', null, null, 1000, null);
  add([2566, 8, 1], [10, 15, 30], 'กรุงไทย', null, 'M-Banking', 'โอนเงิน', null, ['กรุงไทย', '1234567899'], 400, null);
  add([2566, 8, 1], [11, 5, 45], 'กสิกรไทย', null, 'I-Banking', 'โอนเงิน', ['กสิกรไทย', '0911122233'], null, 600, null);
  add([2566, 8, 1], [11, 40, 20], 'กรุงไทย', 'T00042', 'สาขาห้างตัวอย่าง (ทดสอบ)', 'ถอนเงิน', null, null, 500, null);
  add([2566, 8, 8], [9, 30, 0], 'กรุงไทย', null, 'M-Banking', 'ชำระเงิน', null, null, 35, '12C-0000000001');
  add([2566, 8, 9], [14, 20, 10], 'ทีทีบี', null, 'I-Banking', 'โอนเงิน', ['ทีทีบี', '9222233344'], null, 80, null);
  return toFile(wb, 'ktb-like.xlsx');
}
