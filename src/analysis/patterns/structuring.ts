// Structuring/Splitting (แบ่งโอนเป็นก้อนยอดใกล้เคียงกันหลายบัญชีในเวลาสั้น) และยอดใต้วงเงินที่กำหนด
import type { Signal, Txn } from '../../core/types';
import { dayOf, isRealAccount, label, MIN, sum, type Ctx } from '../ctx';
import { baht, clampProminence, makeSignal, spanText, when } from './util';

function bestCluster(items: Txn[], tol: number): Txn[] {
  const s = [...items].sort((a, b) => a.amount - b.amount);
  let best: Txn[] = [];
  let r = 0;
  for (let l = 0; l < s.length; l++) {
    if (r < l) r = l;
    while (r + 1 < s.length && s[r + 1]!.amount - s[l]!.amount <= 2 * tol * s[r + 1]!.amount) r++;
    const cluster = s.slice(l, r + 1);
    if (cluster.length > best.length || (cluster.length === best.length && sum(cluster.map((t) => t.amount)) > sum(best.map((t) => t.amount)))) {
      best = cluster;
    }
  }
  return best;
}

export function detectStructuring(ctx: Ctx): Signal[] {
  const { settings: s } = ctx;
  const W = s.splitWindowMin * MIN;
  const out: Signal[] = [];

  for (const [acc, outs] of ctx.outBy) {
    if (!isRealAccount(ctx.accounts[acc])) continue;
    const cand = outs.filter(
      (t) => (t.kind === 'transfer' || t.kind === 'payment') && t.amount >= s.minSignalAmount && !ctx.accounts[t.to]?.id.startsWith('cash:'),
    );
    if (cand.length < s.splitMinCount) continue;
    const used = new Set<string>();
    for (let i = 0; i < cand.length; i++) {
      const t0 = cand[i]!;
      if (used.has(t0.id)) continue;
      const win: Txn[] = [];
      for (let j = i; j < cand.length; j++) {
        const t = cand[j]!;
        const inWin = t0.hasTime && t.hasTime ? t.ts - t0.ts <= W : dayOf(t.ts) === dayOf(t0.ts);
        if (!inWin) break;
        if (!used.has(t.id)) win.push(t);
      }
      if (win.length < s.splitMinCount) continue;
      const cluster = bestCluster(win, s.splitAmountTolerance);
      const receivers = new Set(cluster.map((t) => t.to));
      if (cluster.length < s.splitMinCount || receivers.size < 2) continue;
      cluster.forEach((t) => used.add(t.id));
      const total = sum(cluster.map((t) => t.amount));
      const sorted = [...cluster].sort((a, b) => a.ts - b.ts);
      const approx = sorted.some((t) => !t.hasTime);
      const prom = clampProminence(cluster.length >= 5 || receivers.size >= 5 ? 3 : receivers.size >= 3 || cluster.length >= 4 ? 2 : 1);
      out.push(
        makeSignal(
          'structuring', [acc, ...receivers], sorted, prom,
          {
            count: cluster.length, receivers: receivers.size, minAmount: Math.min(...cluster.map((t) => t.amount)),
            maxAmount: Math.max(...cluster.map((t) => t.amount)),
          },
          `${label(ctx, acc)} โอนเงินออก ${cluster.length} รายการ ยอดใกล้เคียงกัน ` +
            `(${baht(Math.min(...cluster.map((t) => t.amount)))} – ${baht(Math.max(...cluster.map((t) => t.amount)))}) ` +
            `ไปยัง ${receivers.size} บัญชี รวม ${baht(total)} ${spanText(sorted[0]!.ts, sorted[sorted.length - 1]!.ts, approx)} ` +
            `เริ่มเมื่อ ${when(sorted[0]!)}`,
          total,
        ),
      );
    }
  }
  return out;
}

/** รายการที่มียอด "ใต้" วงเงินที่ผู้ใช้กำหนดเล็กน้อย ตั้งแต่ 3 รายการขึ้นไปในบัญชีเดียวกัน/ทิศทางเดียวกัน */
export function detectNearThreshold(ctx: Ctx): Signal[] {
  const { settings: s } = ctx;
  if (!s.thresholds.length) return [];
  const out: Signal[] = [];
  for (const dir of ['out', 'in'] as const) {
    const map = dir === 'out' ? ctx.outBy : ctx.inBy;
    for (const [acc, list] of map) {
      if (!isRealAccount(ctx.accounts[acc])) continue;
      for (const T of s.thresholds) {
        const lo = T * (1 - s.thresholdBand);
        const hits = list.filter((t) => t.amount >= lo && t.amount < T);
        if (hits.length < 3) continue;
        const total = sum(hits.map((t) => t.amount));
        out.push(
          makeSignal(
            'near_threshold', [acc], hits, hits.length >= 6 ? 3 : hits.length >= 4 ? 2 : 1,
            { threshold: T, count: hits.length, direction: dir === 'out' ? 'เงินออก' : 'เงินเข้า' },
            `${label(ctx, acc)} มีรายการ${dir === 'out' ? 'เงินออก' : 'เงินเข้า'}ที่ยอดอยู่ใต้วงเงิน ${baht(T)} เล็กน้อย ` +
              `(${baht(lo)} – ${baht(T)}) จำนวน ${hits.length} รายการ รวม ${baht(total)}`,
            total,
          ),
        );
      }
    }
  }
  return out;
}
