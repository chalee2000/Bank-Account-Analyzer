import type { Signal, SignalType, Txn } from '../../core/types';
import { fmtBaht, formatThaiDateTime, fmtDuration } from '../../core/thai';

export function makeSignal(
  type: SignalType,
  focus: string[],
  txns: Txn[],
  prominence: 1 | 2 | 3,
  metrics: Signal['metrics'],
  summary: string,
  totalAmount: number,
  evidence?: Txn[],
): Signal {
  const ev = evidence ?? txns;
  const sorted = [...ev].sort((a, b) => a.ts - b.ts);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const ids = [...new Set(sorted.map((t) => t.id))];
  return {
    id: `${type}:${first.id}:${ids.length}`,
    type,
    focus: [...new Set(focus)],
    txnIds: ids,
    startTs: first.ts,
    endTs: last.ts,
    totalAmount,
    prominence,
    metrics,
    summary,
    timeApprox: ev.some((t) => !t.hasTime) || undefined,
  };
}

export const baht = (n: number) => `${fmtBaht(n)} บาท`;
export const when = (t: { ts: number; hasTime: boolean }) => formatThaiDateTime(t.ts, t.hasTime);
export const spanText = (startTs: number, endTs: number, approx: boolean) =>
  approx && endTs - startTs < 86_400_000 ? 'ภายในวันเดียวกัน (ข้อมูลไม่มีเวลา)' : `ภายใน ${fmtDuration(endTs - startTs)}`;

export function clampProminence(n: number): 1 | 2 | 3 {
  return (n <= 1 ? 1 : n >= 3 ? 3 : 2) as 1 | 2 | 3;
}

/** จำกัดจำนวน id หลักฐานต่อสัญญาณเพื่อไม่ให้ข้อมูลบวม */
export function cap<T>(arr: T[], n = 80): T[] {
  return arr.length > n ? arr.slice(0, n) : arr;
}
