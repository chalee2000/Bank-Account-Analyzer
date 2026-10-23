// อ่านข้อความ/เรนเดอร์หน้า PDF ด้วย pdf.js (ฝั่งเบราว์เซอร์)
// ใช้ build "legacy" เพื่อรองรับ Safari/iOS รุ่นเก่ากว่า และ worker ถูกเสิร์ฟจาก origin เดียวกัน (ไม่ใช้ CDN)
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { normalizeThaiGlyphs } from '../core/thai';
import type { TextItem } from './tableFromItems';

let configured = false;
function configure() {
  if (configured) return;
  // ในเบราว์เซอร์ใช้ worker จาก origin เดียวกัน; ใน Node (ทดสอบ) ปล่อยให้ pdf.js ใช้ fake worker เอง
  if (typeof document !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = new URL('ocr/pdf.worker.min.mjs', document.baseURI).href;
  configured = true;
}

import { PdfPasswordError } from './errors';
export { PdfPasswordError };

export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  configure();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    useSystemFonts: false,
  });
  try {
    return await task.promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err?.name === 'PasswordException') {
      // code 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
      throw new PdfPasswordError(err.code === 2);
    }
    throw e;
  }
}

export interface PdfTextExtract {
  items: TextItem[];
  pages: number;
  /** จำนวนตัวอักษรข้อความต่อหน้า */
  charsPerPage: number[];
}

export async function extractPdfItems(
  doc: PDFDocumentProxy,
  onProgress?: (page: number, total: number) => void,
): Promise<PdfTextExtract> {
  const items: TextItem[] = [];
  const charsPerPage: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    let chars = 0;
    for (const it of tc.items) {
      if (!('str' in it) || !it.str) continue;
      const str = normalizeThaiGlyphs(it.str);
      if (!str.trim()) continue;
      const tr = it.transform as number[];
      const h = it.height || Math.abs(tr[3] ?? 0) || 10;
      const [vx, vy] = vp.convertToViewportPoint(tr[4] ?? 0, tr[5] ?? 0) as [number, number];
      items.push({ str, x: vx, y: vy - h * 0.35, w: it.width, h, page: p });
      chars += str.trim().length;
    }
    charsPerPage.push(chars);
    page.cleanup();
    onProgress?.(p, doc.numPages);
  }
  return { items, pages: doc.numPages, charsPerPage };
}

/** เรนเดอร์หน้าเป็น canvas กว้างประมาณ targetWidth px (ค่าเริ่มต้น ≈ 300dpi ของ A4) */
export async function renderPageToCanvas(page: PDFPageProxy, targetWidth = 2200): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  // iOS จำกัดขนาด canvas (~16.7M พิกเซล) → จำกัดสเกล
  const maxPixels = 12_000_000;
  let scale = targetWidth / base.width;
  if (base.width * base.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (base.width * base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}
