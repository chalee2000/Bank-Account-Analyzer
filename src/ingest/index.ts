// ตัวประสานการอ่านไฟล์: ตรวจชนิดไฟล์ → อ่านเป็น RawTable (หนึ่งไฟล์อาจได้หลายตาราง เช่น หลายชีต)
import { sha256Hex } from './hash';
import { readCsv } from './csv';
import { tableFromItems, type TextItem } from './tableFromItems';
import type { RawTable } from './types';

export type SourceKind = 'csv' | 'xlsx' | 'pdf' | 'image' | 'xls' | 'unknown';

export interface ReadProgress {
  phase: string;
  current?: number;
  total?: number;
  /** 0–1 */
  fraction?: number;
}

export interface ReadOptions {
  password?: string;
  /** auto = ใช้ OCR เมื่อ PDF ไม่มีข้อความ, force = บังคับ OCR, off = ไม่ใช้ OCR */
  ocr?: 'auto' | 'force' | 'off';
  onProgress?: (p: ReadProgress) => void;
}

export interface ReadResult {
  name: string;
  size: number;
  sha256: string;
  kind: SourceKind;
  tables: RawTable[];
  notes: string[];
}

export { UnsupportedFileError, PdfPasswordError } from './errors';
import { UnsupportedFileError } from './errors';

export function sniffKind(name: string, b: Uint8Array): SourceKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const startsWith = (...bytes: number[]) => bytes.every((v, i) => b[i] === v);
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'pdf'; // %PDF
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) return 'xlsx'; // ZIP (xlsx/xlsm)
  if (startsWith(0xd0, 0xcf, 0x11, 0xe0)) return 'xls';
  if (startsWith(0x89, 0x50, 0x4e, 0x47) || startsWith(0xff, 0xd8, 0xff)) return 'image';
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'heic', 'heif'].includes(ext)) return 'image';
  if (['csv', 'txt', 'tsv'].includes(ext)) return 'csv';
  return 'csv'; // ลองอ่านเป็นข้อความ
}

export async function readStatementFile(file: File, opts: ReadOptions = {}): Promise<ReadResult> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const kind = sniffKind(file.name, bytes);
  const sha256 = await sha256Hex(bytes);
  const base = { name: file.name, size: file.size, sha256, kind };
  const notes: string[] = [];

  if (kind === 'xls') {
    throw new UnsupportedFileError('ไฟล์ .xls รุ่นเก่ายังไม่รองรับ — เปิดด้วย Excel แล้วบันทึกเป็น .xlsx หรือ .csv ก่อนนำเข้า');
  }
  if (kind === 'csv') {
    opts.onProgress?.({ phase: 'อ่านไฟล์ข้อความ' });
    const t = readCsv(bytes);
    return { ...base, tables: [t], notes: t.notes ?? [] };
  }
  if (kind === 'xlsx') {
    opts.onProgress?.({ phase: 'อ่านไฟล์ Excel' });
    const { readXlsx } = await import('./xlsx');
    const tables = await readXlsx(buf);
    if (!tables.length) throw new UnsupportedFileError('ไม่พบข้อมูลในไฟล์ Excel');
    return { ...base, tables, notes };
  }

  // PDF / รูปภาพ — โหลดโมดูลหนัก (pdf.js / tesseract) เมื่อจำเป็นเท่านั้น
  if (kind === 'pdf') {
    const { openPdf, extractPdfItems, renderPageToCanvas } = await import('./pdf');
    opts.onProgress?.({ phase: 'เปิด PDF' });
    const doc = await openPdf(bytes, opts.password);
    const ex = await extractPdfItems(doc, (p, total) =>
      opts.onProgress?.({ phase: 'อ่านข้อความ PDF', current: p, total, fraction: p / total }),
    );
    const avgChars = ex.charsPerPage.reduce((a, b) => a + b, 0) / Math.max(1, ex.pages);
    const scanned = avgChars < 40;
    const mode = opts.ocr ?? 'auto';
    if (!scanned && mode !== 'force') {
      const { table } = tableFromItems(ex.items, 'pdf-text');
      return { ...base, tables: [table], notes: [`PDF ${ex.pages} หน้า (ข้อความเลือกได้)`] };
    }
    if (mode === 'off') {
      throw new UnsupportedFileError('PDF นี้เป็นภาพสแกน (ไม่มีข้อความ) และปิดการใช้ OCR อยู่');
    }
    const { ocrToItems } = await import('./ocr');
    const all: TextItem[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const canvas = await renderPageToCanvas(page);
      const items = await ocrToItems(canvas, p, (frac, status) =>
        opts.onProgress?.({ phase: `OCR หน้า ${p}/${doc.numPages} (${status})`, current: p, total: doc.numPages, fraction: (p - 1 + frac) / doc.numPages }),
      );
      all.push(...items);
      canvas.width = canvas.height = 0; // คืนหน่วยความจำ (สำคัญบน iPhone)
      page.cleanup();
    }
    const { table } = tableFromItems(all, 'pdf-ocr');
    return { ...base, tables: [table], notes: [`OCR ${doc.numPages} หน้า — ตรวจแก้ค่าที่ความมั่นใจต่ำก่อนนำเข้า`] };
  }

  if (kind === 'image') {
    if ((opts.ocr ?? 'auto') === 'off') throw new UnsupportedFileError('ไฟล์รูปภาพต้องใช้ OCR แต่ปิดการใช้ OCR อยู่');
    const { imageFileToCanvas, ocrToItems } = await import('./ocr');
    opts.onProgress?.({ phase: 'โหลดรูปภาพ' });
    const canvas = await imageFileToCanvas(file);
    const items = await ocrToItems(canvas, 1, (frac, status) =>
      opts.onProgress?.({ phase: `OCR (${status})`, fraction: frac }),
    );
    const { table } = tableFromItems(items, 'image-ocr');
    return { ...base, tables: [table], notes: ['OCR จากรูปภาพ — ตรวจแก้ค่าที่ความมั่นใจต่ำก่อนนำเข้า'] };
  }

  throw new UnsupportedFileError('ไม่รู้จักชนิดไฟล์นี้');
}
