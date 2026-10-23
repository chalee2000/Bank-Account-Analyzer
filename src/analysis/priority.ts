// ลำดับความสำคัญในการตรวจสอบ — แสดงเป็นองค์ประกอบแยก ไม่ใช่คะแนนความผิด
// ค่าแต่ละองค์ประกอบ normalize เป็น 0–1 เทียบกับค่าสูงสุดในคดีนี้ (สัมพัทธ์ ไม่ใช่ค่าสัมบูรณ์)
import type { AccountProfile, NodeMetrics, PriorityRow, Signal } from '../core/types';

export const PRIORITY_DISCLAIMER =
  'คะแนนลำดับการตรวจสอบเป็นเพียงตัวช่วยจัดลำดับว่าควรเปิดดูบัญชีใดก่อน คำนวณจากค่าสัมพัทธ์ภายในคดีนี้เท่านั้น ไม่ใช่คะแนนความผิด และไม่ใช่การประเมินความน่าจะเป็นที่บุคคลใดเกี่ยวข้องกับการกระทำความผิด';

export function buildPriority(
  profiles: Record<string, AccountProfile>,
  metrics: Record<string, NodeMetrics>,
  signals: Signal[],
): PriorityRow[] {
  const ids = Object.keys(profiles);
  if (!ids.length) return [];
  const sigCount = new Map<string, number>();
  for (const s of signals) {
    if (s.type === 'repeated' || s.type === 'near_threshold') continue;
    for (const f of new Set(s.focus)) sigCount.set(f, (sigCount.get(f) ?? 0) + 1);
  }
  const maxOf = (f: (id: string) => number) => Math.max(0, ...ids.map(f));
  const maxVol = maxOf((i) => profiles[i]!.totalIn + profiles[i]!.totalOut);
  const maxFreq = maxOf((i) => profiles[i]!.inCount + profiles[i]!.outCount);
  const maxDeg = maxOf((i) => metrics[i]?.degree ?? 0);
  const maxBet = maxOf((i) => metrics[i]?.betweenness ?? 0);
  const norm = (v: number, m: number) => (m > 0 ? Math.min(1, v / m) : 0);

  const rows: PriorityRow[] = ids.map((id) => {
    const p = profiles[id]!;
    const m = metrics[id];
    const components = {
      volume: norm(p.totalIn + p.totalOut, maxVol),
      frequency: norm(p.inCount + p.outCount, maxFreq),
      flowThrough: p.flowThrough === null || p.totalIn <= 0 ? 0 : Math.min(1, p.flowThrough / 100),
      quickHolding: p.holding.shareWithin[60],
      degree: norm(m?.degree ?? 0, maxDeg),
      betweenness: norm(m?.betweenness ?? 0, maxBet),
      signals: Math.min(1, (sigCount.get(id) ?? 0) / 5),
    };
    const orderingScore = Object.values(components).reduce((a, b) => a + b, 0) / 7;
    return { accountId: id, components, orderingScore };
  });
  return rows.sort((a, b) => b.orderingScore - a.orderingScore);
}
