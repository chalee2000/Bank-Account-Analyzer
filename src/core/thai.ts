// ตัวช่วยอ่าน/แสดงผลข้อมูลแบบไทย: เลขไทย, พ.ศ., เดือนไทย, จำนวนเงิน
// เวลาทั้งหมดเก็บเป็น "wall-clock" แปลงด้วย Date.UTC เพื่อไม่ขึ้นกับ timezone ของเครื่อง

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

export function thaiDigitsToArabic(s: string): string {
  return s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

const MONTHS_TH_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const MONTHS_TH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];
const MONTHS_EN_FULL = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function stripMonthKey(s: string): string {
  return s.replace(/[.\s]/g, '').toLowerCase();
}

const MONTH_LOOKUP: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    m.set(stripMonthKey(MONTHS_TH_FULL[i]!), i);
    m.set(stripMonthKey(MONTHS_TH_SHORT[i]!), i);
    const en = MONTHS_EN_FULL[i]!;
    m.set(en, i);
    m.set(en.slice(0, 3), i);
  }
  m.set('sept', 8);
  return m;
})();

export function monthFromName(name: string): number | null {
  const v = MONTH_LOOKUP.get(stripMonthKey(name));
  return v === undefined ? null : v;
}

// ---------------- Thai glyph normalization (PDF text layer) ----------------

/** อักขระ PUA ของฟอนต์ไทยรุ่นเก่า/ตัวแปรของวรรณยุกต์และสระ ที่ PDF บางไฟล์ส่งออกมาแทนอักขระมาตรฐาน */
const THAI_PUA: Record<string, string> = {
  '\uF701': '\u0E34', '\uF702': '\u0E35', '\uF703': '\u0E36', '\uF704': '\u0E37',
  '\uF705': '\u0E48', '\uF706': '\u0E49', '\uF707': '\u0E4A', '\uF708': '\u0E4B', '\uF709': '\u0E4C',
  '\uF70A': '\u0E48', '\uF70B': '\u0E49', '\uF70C': '\u0E4A', '\uF70D': '\u0E4B', '\uF70E': '\u0E4C',
  '\uF70F': '\u0E0D', '\uF710': '\u0E31', '\uF711': '\u0E4D', '\uF712': '\u0E47',
  '\uF713': '\u0E48', '\uF714': '\u0E49', '\uF715': '\u0E4A', '\uF716': '\u0E4B', '\uF717': '\u0E4C',
};

/** แปลง PUA เป็นอักขระไทยมาตรฐาน ตัด PUA ที่ไม่รู้จักทิ้ง และรวม นิคหิต+สระอา → สระอำ */
export function normalizeThaiGlyphs(s: string): string {
  return s
    .replace(/[\uF700-\uF71F]/g, (c) => THAI_PUA[c] ?? '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/\u0E4D\u0E32/g, '\u0E33');
}

// ---------------- OCR spacing ----------------

/** ลบช่องว่างที่ "เป็นไปไม่ได้" ในภาษาไทย (OCR มักแทรกช่องว่างกลางคำ): ก่อนสระบน/ล่าง วรรณยุกต์ ะ า ำ และหลังสระนำ เ แ โ ไ ใ */
export function fixThaiSpacing(s: string): string {
  return s
    .replace(/[ \t]+([\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0E30\u0E32\u0E33\u0E45])/g, '$1')
    .replace(/([\u0E40-\u0E44])[ \t]+(?=[\u0E01-\u0E2E])/g, '$1');
}

/** ลบช่องว่างทั้งหมดระหว่างตัวอักษรไทย — ใช้เทียบคำสำคัญ/ป้ายกำกับเท่านั้น */
export function compactThai(s: string): string {
  return s.replace(/(?<=[\u0E00-\u0E7F])[ \t]+(?=[\u0E00-\u0E7F])/g, '');
}

// ---------------- Amount ----------------

export interface ParsedAmount {
  /** ค่าสัมบูรณ์ */
  value: number;
  /** -1 = ติดลบ (วงเล็บ/เครื่องหมายลบ/DR), 1 = บวก (+/CR), 0 = ไม่ระบุ */
  sign: -1 | 0 | 1;
  drcr?: 'DR' | 'CR';
}

/** แปลงข้อความจำนวนเงิน เช่น "1,234.50", "(1,234.50)", "-500", "500.00 DR", "฿ 12,000", "๑,๐๐๐" */
export function parseAmount(raw: unknown): ParsedAmount | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return { value: Math.abs(raw), sign: raw < 0 ? -1 : 0 };
  }
  let s = thaiDigitsToArabic(String(raw)).trim();
  if (!s || s === '-' || s === '—') return null;
  let sign: -1 | 0 | 1 = 0;
  let drcr: 'DR' | 'CR' | undefined;

  const drcrMatch = s.match(/(?<![A-Za-z])(DR|CR|DEBIT|CREDIT)(?![A-Za-z])\.?/i);
  if (drcrMatch) {
    const t = drcrMatch[1]!.toUpperCase();
    drcr = t.startsWith('D') ? 'DR' : 'CR';
    sign = drcr === 'DR' ? -1 : 1;
    s = s.replace(drcrMatch[0], '');
  }
  if (/^\(.*\)$/.test(s.trim())) {
    sign = -1;
    s = s.trim().slice(1, -1);
  }
  s = s.replace(/[฿$]|บาท|THB|baht/gi, '').trim();
  if (/-\s*$/.test(s)) {
    sign = -1;
    s = s.replace(/-\s*$/, '');
  }
  if (/^\s*-/.test(s)) {
    sign = -1;
    s = s.replace(/^\s*-\s*/, '');
  } else if (/^\s*\+/.test(s)) {
    sign = 1;
    s = s.replace(/^\s*\+\s*/, '');
  }
  s = s.replace(/[\s,]/g, '');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return { value, sign, drcr };
}

// ---------------- Date / time ----------------

export interface ParsedDateTime {
  ts: number;
  hasTime: boolean;
}

export type YearMode = 'auto' | 'be' | 'ce';

export interface DateParseOptions {
  yearMode?: YearMode;
  /** true = dd/mm/yyyy (ค่าเริ่มต้นสำหรับไทย) */
  dayFirst?: boolean;
}

function resolveYear(y: number, digits: number, mode: YearMode): number | null {
  let year = y;
  if (digits <= 2) {
    if (mode === 'be') year = 2500 + y;
    else if (mode === 'ce') year = 2000 + y;
    else year = y >= 50 ? 2500 + y : 2000 + y; // 67 → พ.ศ. 2567, 24 → ค.ศ. 2024
  }
  if (mode === 'be' && year < 2400) year += 543;
  if (year >= 2400) year -= 543;
  if (year < 1950 || year > 2100) return null;
  return year;
}

function validDate(y: number, m0: number, d: number): boolean {
  if (m0 < 0 || m0 > 11 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m0, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m0 && dt.getUTCDate() === d;
}

export interface ParsedTime {
  h: number;
  mi: number;
  s: number;
}

/** อ่านเวลา "09:55", "09:55:30", "9.55 น.", "09:55 PM" */
export function parseTime(raw: unknown): ParsedTime | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    // เศษส่วนของวันแบบ Excel
    if (raw >= 0 && raw < 1) {
      const total = Math.round(raw * 86400);
      return { h: Math.floor(total / 3600), mi: Math.floor((total % 3600) / 60), s: total % 60 };
    }
    return null;
  }
  const s = thaiDigitsToArabic(String(raw)).trim();
  const m = s.match(/^(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*[:.]\s*(\d{2}))?(?:[.,]\d+)?\s*(AM|PM|น\.?)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  const ap = m[4]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  if (h > 23 || mi > 59 || sec > 59) return null;
  return { h, mi, s: sec };
}

const TIME_TAIL = String.raw`(?:[ T]+(\d{1,2}\s*[:.]\s*\d{2}(?:\s*[:.]\s*\d{2})?(?:[.,]\d+)?\s*(?:AM|PM|น\.?)?))?`;

/** อ่านวันที่(+เวลา) จากข้อความรูปแบบที่พบในเอกสารธนาคารไทย */
export function parseDateTime(raw: unknown, opts: DateParseOptions = {}): ParsedDateTime | null {
  if (raw === null || raw === undefined) return null;
  const mode = opts.yearMode ?? 'auto';
  const dayFirst = opts.dayFirst ?? true;

  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    const hasTime =
      raw.getUTCHours() !== 0 || raw.getUTCMinutes() !== 0 || raw.getUTCSeconds() !== 0;
    return { ts: raw.getTime(), hasTime };
  }
  if (typeof raw === 'number') return excelSerialToDateTime(raw);

  const s = thaiDigitsToArabic(String(raw)).replace(/\s+/g, ' ').trim();
  if (!s) return null;

  const finish = (y: number, m0: number, d: number, timeStr?: string): ParsedDateTime | null => {
    if (!validDate(y, m0, d)) return null;
    const t = timeStr ? parseTime(timeStr.trim()) : null;
    if (timeStr && !t) return null;
    const ts = Date.UTC(y, m0, d, t?.h ?? 0, t?.mi ?? 0, t?.s ?? 0);
    return { ts, hasTime: !!t };
  };

  // ISO: 2024-03-05, 2024-03-05T10:20:30(Z), 2567-03-05
  let m = s.match(new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})` + TIME_TAIL + String.raw`(?:Z|[+-]\d{2}:?\d{2})?$`, 'i'));
  if (m) {
    const y = resolveYear(Number(m[1]), 4, mode);
    if (y === null) return null;
    return finish(y, Number(m[2]) - 1, Number(m[3]), m[4]);
  }

  // dd/mm/yyyy | dd-mm-yy | dd.mm.yyyy
  m = s.match(new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})` + TIME_TAIL + '$', 'i'));
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = resolveYear(Number(m[3]), m[3]!.length, mode);
    if (y === null) return null;
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    return finish(y, mo - 1, d, m[4]);
  }

  // 5 มี.ค. 67 | 5 มีนาคม 2567 | 05 Mar 2024 | 5-Mar-24
  m = s.match(
    new RegExp(
      String.raw`^(\d{1,2})[\s\-/]*([A-Za-zก-๙.]+)[\s\-/,]*(\d{2}|\d{4})` + TIME_TAIL + '$',
      'i',
    ),
  );
  if (m) {
    const mo = monthFromName(m[2]!);
    if (mo === null) return null;
    const y = resolveYear(Number(m[3]), m[3]!.length, mode);
    if (y === null) return null;
    return finish(y, mo, Number(m[1]), m[4]);
  }

  // yyyymmdd (+ hhmm[ss])
  m = s.match(/^(\d{4})(\d{2})(\d{2})(?:[ T]?(\d{2})(\d{2})(\d{2})?)?$/);
  if (m) {
    const y = resolveYear(Number(m[1]), 4, mode);
    if (y === null || !validDate(y, Number(m[2]) - 1, Number(m[3]))) return null;
    const hasTime = m[4] !== undefined;
    return {
      ts: Date.UTC(y, Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)),
      hasTime,
    };
  }
  return null;
}

/** หมายเลขลำดับวันแบบ Excel (1900 date system) */
export function excelSerialToDateTime(serial: number): ParsedDateTime | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const hasTime = Math.abs(serial - Math.floor(serial)) > 1e-9;
  return { ts: ms, hasTime };
}

/** รวมคอลัมน์วันที่และเวลาที่แยกกัน */
export function combineDateAndTime(
  dateRaw: unknown,
  timeRaw: unknown,
  opts: DateParseOptions = {},
): ParsedDateTime | null {
  const d = parseDateTime(dateRaw, opts);
  if (!d) return null;
  if (timeRaw === null || timeRaw === undefined || String(timeRaw).trim() === '') return d;
  if (timeRaw instanceof Date) {
    return {
      ts: Date.UTC(d0y(d.ts), d0m(d.ts), d0d(d.ts), timeRaw.getUTCHours(), timeRaw.getUTCMinutes(), timeRaw.getUTCSeconds()),
      hasTime: true,
    };
  }
  const t = parseTime(timeRaw);
  if (!t) return d;
  const base = Math.floor(d.ts / 86400000) * 86400000;
  return { ts: base + (t.h * 3600 + t.mi * 60 + t.s) * 1000, hasTime: true };
}

const d0y = (ts: number) => new Date(ts).getUTCFullYear();
const d0m = (ts: number) => new Date(ts).getUTCMonth();
const d0d = (ts: number) => new Date(ts).getUTCDate();

// ---------------- Formatting ----------------

const pad2 = (n: number) => String(n).padStart(2, '0');

/** dd/mm/yyyy [HH:mm[:ss]] — ค่าเริ่มต้นเป็น พ.ศ. ตามเอกสารราชการไทย (era = 'ce' สำหรับ ค.ศ.) */
export function formatTs(ts: number, withTime = true, withSeconds = false, era: 'be' | 'ce' = 'be'): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear() + (era === 'be' ? 543 : 0);
  const date = `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${y}`;
  if (!withTime) return date;
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` + (withSeconds ? `:${pad2(d.getUTCSeconds())}` : '');
  return `${date} ${time}`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** yyyy-mm-dd (ค.ศ.) สำหรับ key และชื่อไฟล์ */
export function isoDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** "5 มี.ค. 2567" (พ.ศ.) */
export function formatThaiDate(ts: number, full = false): string {
  const d = new Date(ts);
  const months = full ? MONTHS_TH_FULL : MONTHS_TH_SHORT;
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}

/** "5 มี.ค. 2567 เวลา 09:55 น." */
export function formatThaiDateTime(ts: number, hasTime = true, full = false): string {
  return hasTime
    ? `${formatThaiDate(ts, full)} เวลา ${formatTime(ts)} น.`
    : formatThaiDate(ts, full);
}

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtInt(n: number): string {
  return nf0.format(n);
}
export function fmtBaht(n: number): string {
  return nf2.format(n);
}
export function fmtPct(r: number | null, digits = 1): string {
  if (r === null || !Number.isFinite(r)) return '–';
  return `${r.toFixed(digits)}%`;
}

/** ระยะเวลา เช่น "2 นาที", "1 ชม. 5 นาที", "3 วัน 4 ชม." */
export function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '–';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} วินาที`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin} นาที`;
  const h = Math.floor(totalMin / 60);
  const mi = totalMin % 60;
  if (h < 24) return mi ? `${h} ชม. ${mi} นาที` : `${h} ชม.`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d} วัน ${hh} ชม.` : `${d} วัน`;
}
