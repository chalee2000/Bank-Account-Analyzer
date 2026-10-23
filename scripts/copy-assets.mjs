// คัดลอกไฟล์ OCR (worker, wasm, traineddata) ไปไว้ใน public/ocr เพื่อให้แอปใช้งานออฟไลน์ได้
// โดยไม่ต้องโหลดจาก CDN ภายนอก (ข้อมูล statement ไม่ออกจากเครื่อง)
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/ocr');
mkdirSync(out, { recursive: true });

const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core.wasm.js', 'core/tesseract-core.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd.wasm.js', 'core/tesseract-core-simd.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/tha/4.0.0_best_int/tha.traineddata.gz', 'lang/tha.traineddata.gz'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
  ['node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
];
for (const [from, to] of files) {
  const src = resolve(root, from);
  if (!existsSync(src)) {
    console.error('ไม่พบไฟล์:', from);
    process.exitCode = 1;
    continue;
  }
  const dst = resolve(out, to);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
}
console.log('คัดลอกไฟล์ OCR/PDF worker ไปที่ public/ocr แล้ว');
