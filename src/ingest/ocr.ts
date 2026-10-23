// OCR ภาษาไทย+อังกฤษด้วย tesseract.js — ไฟล์ worker/wasm/traineddata ถูกเสิร์ฟจาก origin เดียวกัน (public/ocr)
// เพื่อให้ใช้งานออฟไลน์ได้และข้อมูลไม่ออกจากเครื่อง
import { createWorker, type Worker } from 'tesseract.js';
import type { TextItem } from './tableFromItems';

let workerPromise: Promise<Worker> | null = null;
let currentProgress: ((p: number, status: string) => void) | undefined;

const abs = (p: string) => new URL(p, document.baseURI).href.replace(/\/$/, '');

export async function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(['tha', 'eng'], 1, {
      workerPath: abs('ocr/worker.min.js'),
      corePath: abs('ocr/core'),
      langPath: abs('ocr/lang'),
      workerBlobURL: false,
      gzip: true,
      logger: (m: { status: string; progress: number }) => currentProgress?.(m.progress, m.status),
    }).then(async (w) => {
      await w.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
      return w;
    });
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  await w?.terminate();
}

/** OCR หนึ่งภาพ (canvas / Blob) → คำพร้อมพิกัดและความมั่นใจ */
export async function ocrToItems(
  image: HTMLCanvasElement | Blob,
  page: number,
  onProgress?: (p: number, status: string) => void,
): Promise<TextItem[]> {
  currentProgress = onProgress;
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(image, {}, { blocks: true });
  const items: TextItem[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          const text = (w.text ?? '').trim();
          if (!text) continue;
          const h = Math.max(1, w.bbox.y1 - w.bbox.y0);
          items.push({
            str: text,
            x: w.bbox.x0,
            y: (w.bbox.y0 + w.bbox.y1) / 2,
            w: Math.max(1, w.bbox.x1 - w.bbox.x0),
            h,
            page,
            conf: w.confidence,
          });
        }
      }
    }
  }
  currentProgress = undefined;
  return items;
}

/** โหลดไฟล์รูปเป็น canvas ที่ไม่ใหญ่เกินไป (จำกัดด้านยาว 4000px เพื่อประหยัดหน่วยความจำ) */
export async function imageFileToCanvas(file: Blob, maxSide = 4000): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas;
}
