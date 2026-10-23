import type { Txn } from '../core/types';
import { formatThaiDate, formatTs } from '../core/thai';

const H = 3_600_000;
const D = 86_400_000;

export type Bucket = 'hour' | 'day' | 'week';

export function chooseBucket(first: number, last: number): Bucket {
  const span = last - first;
  if (span <= 2 * D) return 'hour';
  if (span <= 120 * D) return 'day';
  return 'week';
}

const size = (b: Bucket) => (b === 'hour' ? H : b === 'day' ? D : 7 * D);
const floor = (ts: number, b: Bucket) => {
  const s = size(b);
  if (b === 'week') {
    // เริ่มสัปดาห์วันจันทร์ (1970-01-05 เป็นวันจันทร์)
    const monday0 = 4 * D;
    return Math.floor((ts - monday0) / s) * s + monday0;
  }
  return Math.floor(ts / s) * s;
};

export interface Bucketed {
  bucket: Bucket;
  xs: number[];
  values: Map<string, number[]>;
}

/** รวมยอดเงินเป็นช่วงเวลา ตามกลุ่ม (key) ที่กำหนด */
export function bucketize(txns: Txn[], keyOf: (t: Txn) => string | null, first: number, last: number): Bucketed {
  const bucket = chooseBucket(first, last);
  const s = size(bucket);
  const start = floor(first, bucket);
  const end = floor(last, bucket);
  const n = Math.max(1, Math.round((end - start) / s) + 1);
  const xs = Array.from({ length: n }, (_, i) => start + i * s);
  const values = new Map<string, number[]>();
  for (const t of txns) {
    const k = keyOf(t);
    if (!k) continue;
    const idx = Math.round((floor(t.ts, bucket) - start) / s);
    if (idx < 0 || idx >= n) continue;
    let arr = values.get(k);
    if (!arr) values.set(k, (arr = new Array(n).fill(0)));
    arr[idx]! += t.amount;
  }
  return { bucket, xs, values };
}

export function bucketLabels(bucket: Bucket) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    xLabel: (x: number) => {
      const d = new Date(x);
      if (bucket === 'hour') return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${pad(d.getUTCHours())}:00`;
      return formatThaiDate(x).replace(/ \d{4}$/, '');
    },
    xTipLabel: (x: number) => (bucket === 'hour' ? formatTs(x, true) : bucket === 'week' ? 'สัปดาห์ที่เริ่ม ' + formatThaiDate(x) : formatThaiDate(x)),
  };
}

/** แผนที่ความร้อน วัน(อา=0) × ชั่วโมง ของยอดเงิน — เฉพาะรายการที่มีเวลา */
export function heatmapData(txns: Txn[]) {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const counts = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let used = 0;
  for (const t of txns) {
    if (!t.hasTime) continue;
    const d = new Date(t.ts);
    grid[d.getUTCDay()]![d.getUTCHours()]! += t.amount;
    counts[d.getUTCDay()]![d.getUTCHours()]!++;
    used++;
  }
  return { grid, counts, used };
}
