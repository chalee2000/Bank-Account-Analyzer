// สร้างตารางจากข้อความที่มีพิกัด (ได้จาก pdf.js หรือ OCR) — ฟังก์ชัน pure ทดสอบได้ใน Node
//
// วิธี: จัดกลุ่มเป็นบรรทัดตามแกน y → หาแถวหัวตาราง → หา "แม่น้ำ" (ช่องว่างแนวตั้งที่ไม่มีข้อความคร่อม)
// ในส่วนเนื้อหาเพื่อแบ่งคอลัมน์ → ผูกหัวตารางกับคอลัมน์ที่ซ้อนทับกันมากที่สุด
// ส่วนก่อนหัวตาราง (หัวเอกสาร) แปลงเป็นแถวเซลล์เดียว เพื่อให้ตรวจหาเลขบัญชีเจ้าของได้

import { fixThaiSpacing } from '../core/thai';
import { classifyHeader } from './detectColumns';
import type { RawTable } from './types';

export interface TextItem {
  str: string;
  /** ซ้ายสุด */
  x: number;
  /** กึ่งกลางแนวตั้ง (ค่ามากอยู่ล่างหน้า) */
  y: number;
  w: number;
  h: number;
  page: number;
  conf?: number;
}

interface Line {
  page: number;
  y: number;
  items: TextItem[];
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function groupLines(items: TextItem[]): Line[] {
  const byPage = new Map<number, TextItem[]>();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const arr = byPage.get(it.page) ?? [];
    arr.push(it);
    byPage.set(it.page, arr);
  }
  const lines: Line[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const its = byPage.get(page)!.sort((a, b) => a.y - b.y || a.x - b.x);
    const medH = median(its.map((i) => i.h).filter((h) => h > 0)) || 10;
    const tol = Math.max(2, medH * 0.55);
    let cur: Line | null = null;
    for (const it of its) {
      if (cur && Math.abs(it.y - cur.y) <= tol) {
        cur.items.push(it);
        cur.y = cur.items.reduce((a, b) => a + b.y, 0) / cur.items.length;
      } else {
        cur = { page, y: it.y, items: [it] };
        lines.push(cur);
      }
    }
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** ต่อข้อความของ item ที่อยู่ติดกัน — ช่องว่างเล็กไม่ใส่เว้นวรรค (ภาษาไทยไม่เว้นวรรค) */
function joinItems(items: TextItem[], medH: number): string {
  let out = '';
  let prevEnd: number | null = null;
  for (const it of items) {
    if (prevEnd !== null) {
      const gap = it.x - prevEnd;
      if (gap > medH * 0.25) out += ' ';
    }
    out += it.str.trim();
    prevEnd = it.x + it.w;
  }
  out = out.replace(/\s+/g, ' ').trim();
  // ข้อความจาก OCR มักมีช่องว่างแทรกกลางคำไทย
  return items.some((i) => i.conf !== undefined) ? fixThaiSpacing(out) : out;
}

/** แบ่ง items ในบรรทัดเป็นเซลล์ตามช่องว่างกว้าง */
function splitCells(items: TextItem[], gapMin: number): TextItem[][] {
  const cells: TextItem[][] = [];
  let cur: TextItem[] = [];
  let prevEnd = -Infinity;
  for (const it of items) {
    if (cur.length && it.x - prevEnd > gapMin) {
      cells.push(cur);
      cur = [];
    }
    cur.push(it);
    prevEnd = Math.max(prevEnd, it.x + it.w);
  }
  if (cur.length) cells.push(cur);
  return cells;
}

interface Region {
  x0: number;
  x1: number;
}

function mergeIntervals(ints: Region[], gap: number): Region[] {
  const s = [...ints].sort((a, b) => a.x0 - b.x0);
  const out: Region[] = [];
  for (const i of s) {
    const last = out[out.length - 1];
    if (last && i.x0 - last.x1 <= gap) last.x1 = Math.max(last.x1, i.x1);
    else out.push({ ...i });
  }
  return out;
}

const overlap = (a: Region, b: Region) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));

function isHeaderLine(line: Line, medH: number): { fields: number; hasDate: boolean } {
  const cells = splitCells(line.items, medH * 0.9).map((c) => joinItems(c, medH));
  const classes = new Set<string>();
  for (const c of cells) {
    const k = classifyHeader(c);
    if (k) classes.add(k.field);
  }
  return { fields: classes.size, hasDate: classes.has('date') };
}

export interface TableFromItemsResult {
  table: RawTable;
  pages: number;
  headerFound: boolean;
}

export function tableFromItems(
  items: TextItem[],
  fileType: RawTable['fileType'],
): TableFromItemsResult {
  const lines = groupLines(items);
  const pages = new Set(items.map((i) => i.page)).size;
  const medH = median(items.map((i) => i.h).filter((h) => h > 0)) || 10;
  const riverGap = Math.max(medH * 0.9, 6);

  // ---- หาแถวหัวตาราง (บรรทัดแรกที่ตรงคำหัวตาราง ≥3 ฟิลด์ และมีวันที่) ----
  let headerIdx = -1;
  let bestFields = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = isHeaderLine(lines[i]!, medH);
    if (h.hasDate && h.fields >= 3 && h.fields > bestFields) {
      bestFields = h.fields;
      headerIdx = i;
      if (h.fields >= 5) break;
    }
  }

  const rows: string[][] = [];
  const conf: number[][] = [];
  const hasConf = items.some((i) => i.conf !== undefined);

  if (headerIdx < 0) {
    // ไม่มีหัวตาราง: แบ่งเซลล์ตามช่องว่างกว้างต่อบรรทัด (ผลหยาบ ให้ผู้ใช้จับคู่คอลัมน์เอง)
    for (const l of lines) {
      const cells = splitCells(l.items, riverGap);
      rows.push(cells.map((c) => joinItems(c, medH)));
      conf.push(cells.map((c) => Math.min(...c.map((i) => i.conf ?? 100))));
    }
    return {
      table: { fileType, rows, confidence: hasConf ? conf : undefined, pages, notes: ['ไม่พบหัวตาราง — แบ่งคอลัมน์ตามช่องว่าง'] },
      pages,
      headerFound: false,
    };
  }

  const headerLine = lines[headerIdx]!;
  const headerPage = headerLine.page;

  // ส่วนก่อนหัวตารางของหน้าเดียวกัน = หัวเอกสาร / หน้าอื่นก่อนหน้า = ข้ามเป็นหัวเอกสารด้วย
  for (let i = 0; i < headerIdx; i++) {
    const l = lines[i]!;
    const text = joinItems(l.items, medH);
    if (text) {
      rows.push([text]);
      conf.push([Math.min(...l.items.map((it) => it.conf ?? 100))]);
    }
  }

  // ---- เนื้อหา: ตัดหัวตารางซ้ำและส่วนหัวของหน้าถัดไป ----
  const body: Line[] = [];
  // หน้าที่มีหัวตารางซ้ำ → ตัดทุกบรรทัดตั้งแต่ต้นหน้าถึงหัวตารางซ้ำ
  const repeatedHeaderIdxByPage = new Map<number, number>();
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.page === headerPage) continue;
    if (repeatedHeaderIdxByPage.has(l.page)) continue;
    const h = isHeaderLine(l, medH);
    if (h.hasDate && h.fields >= Math.min(3, bestFields)) repeatedHeaderIdxByPage.set(l.page, i);
  }
  const FOOTER_RE = /^(หน้า|page)\s*\d+(\s*(\/|of|จาก)\s*\d+)?$/i;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i]!;
    const rep = repeatedHeaderIdxByPage.get(l.page);
    if (rep !== undefined && i <= rep) continue; // ส่วนหัวของหน้า + หัวตารางซ้ำ
    if (FOOTER_RE.test(joinItems(l.items, medH))) continue;
    body.push(l);
  }

  // ---- หาคอลัมน์จาก "แม่น้ำ" ในเนื้อหา ----
  const ints: Region[] = [];
  for (const l of body) for (const it of l.items) ints.push({ x0: it.x, x1: it.x + it.w });
  let regions = mergeIntervals(ints, riverGap);

  // เซลล์หัวตาราง
  const headerCells = splitCells(headerLine.items, riverGap).map((c) => ({
    text: joinItems(c, medH),
    x0: Math.min(...c.map((i) => i.x)),
    x1: Math.max(...c.map((i) => i.x + i.w)),
    conf: Math.min(...c.map((i) => i.conf ?? 100)),
  }));

  // ผูกหัวตาราง → region (ซ้อนทับมากสุด หรือกึ่งกลางใกล้สุด)
  const assign: number[] = headerCells.map((hc) => {
    let best = -1;
    let bestOv = 0;
    regions.forEach((r, idx) => {
      const ov = overlap(r, hc);
      if (ov > bestOv) { bestOv = ov; best = idx; }
    });
    if (best >= 0) return best;
    const c = (hc.x0 + hc.x1) / 2;
    let bd = Infinity;
    regions.forEach((r, idx) => {
      const d = Math.abs((r.x0 + r.x1) / 2 - c);
      if (d < bd) { bd = d; best = idx; }
    });
    return best;
  });

  // หัวตารางหลายเซลล์ตกใน region เดียวกัน → แบ่ง region ที่กึ่งกลางระหว่างหัวตาราง
  if (regions.length) {
    const oldAssign = [...assign];
    const newRegions: Region[] = [];
    regions.forEach((r, idx) => {
      const hs = oldAssign.map((a, hi) => (a === idx ? hi : -1)).filter((hi) => hi >= 0);
      if (hs.length <= 1) {
        const newIdx = newRegions.length;
        newRegions.push(r);
        for (const hi of hs) assign[hi] = newIdx;
        return;
      }
      const order = [...hs].sort((a, b) => headerCells[a]!.x0 - headerCells[b]!.x0);
      const cs = order.map((hi) => (headerCells[hi]!.x0 + headerCells[hi]!.x1) / 2);
      const bounds = [r.x0, ...cs.slice(0, -1).map((c, k) => (c + cs[k + 1]!) / 2), r.x1];
      order.forEach((hi, k) => {
        assign[hi] = newRegions.length;
        newRegions.push({ x0: bounds[k]!, x1: bounds[k + 1]! });
      });
    });
    regions = newRegions;
  }

  const regionOf = (it: TextItem): number => {
    const c = it.x + it.w / 2;
    for (let i = 0; i < regions.length; i++) if (c >= regions[i]!.x0 - 1 && c <= regions[i]!.x1 + 1) return i;
    let best = 0;
    let bd = Infinity;
    regions.forEach((r, i) => {
      const d = Math.abs((r.x0 + r.x1) / 2 - c);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  const ncol = regions.length;
  const headerRow = new Array<string>(ncol).fill('');
  const headerConf = new Array<number>(ncol).fill(100);
  headerCells.forEach((hc, i) => {
    const col = assign[i]!;
    if (col >= 0) {
      headerRow[col] = headerRow[col] ? `${headerRow[col]} ${hc.text}` : hc.text;
      headerConf[col] = hc.conf;
    }
  });
  const headerRowIndex = rows.length;
  rows.push(headerRow);
  conf.push(headerConf);

  for (const l of body) {
    const cells: TextItem[][] = Array.from({ length: ncol }, () => []);
    for (const it of l.items) cells[regionOf(it)]!.push(it);
    rows.push(cells.map((c) => joinItems(c.sort((a, b) => a.x - b.x), medH)));
    conf.push(cells.map((c) => (c.length ? Math.min(...c.map((i) => i.conf ?? 100)) : 100)));
  }

  return {
    table: {
      fileType,
      rows,
      confidence: hasConf ? conf : undefined,
      pages,
      notes: [`หัวตารางอยู่แถวที่ ${headerRowIndex + 1}`],
    },
    pages,
    headerFound: true,
  };
}
