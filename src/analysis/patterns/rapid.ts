// Rapid Movement: เงินที่เข้าบัญชีถูกโอนต่อ/ถอนออกอย่างรวดเร็ว
import type { Signal, Txn } from '../../core/types';
import { fmtDuration, isoDate } from '../../core/thai';
import type { Attribution } from '../attribution';
import { isRealAccount, label, median, MIN, sum, type Ctx } from '../ctx';
import { baht, cap, clampProminence, makeSignal } from './util';

export function detectRapid(ctx: Ctx, attr: Attribution): Signal[] {
  const { settings: s } = ctx;
  const W = s.rapidWindowMin * MIN;
  const out: Signal[] = [];

  for (const [acc, ins] of ctx.inBy) {
    if (!isRealAccount(ctx.accounts[acc])) continue;
    const hits: { t: Txn; moved: number; holds: number[]; outs: string[] }[] = [];
    for (const t of ins) {
      if (t.amount < s.minSignalAmount) continue;
      const links = (attr.byIn.get(t.id) ?? []).filter((l) => l.via === acc && l.holdingMs <= W);
      const moved = sum(links.map((l) => l.amount));
      if (moved / t.amount >= s.rapidMinRatio) {
        hits.push({ t, moved, holds: links.map((l) => l.holdingMs), outs: links.map((l) => l.outTxn) });
      }
    }
    if (!hits.length) continue;
    const inTxns = hits.map((h) => h.t);
    const outTxns = [...new Set(hits.flatMap((h) => h.outs))].map((id) => ctx.byId.get(id)!).filter(Boolean);
    const totalIn = sum(hits.map((h) => h.t.amount));
    const totalMoved = sum(hits.map((h) => h.moved));
    const medHold = median(hits.flatMap((h) => h.holds));
    const days = new Set(inTxns.map((t) => isoDate(t.ts)));
    const n = hits.length;
    const share = n / Math.max(1, ins.length);
    const prom = clampProminence(n >= 5 || (n >= 3 && share >= 0.5) ? 3 : n >= 3 ? 2 : 1);
    const sig = makeSignal(
      'rapid_movement', [acc], [...inTxns, ...outTxns], prom,
      {
        inflows: n, totalIn: Math.round(totalIn), totalMoved: Math.round(totalMoved),
        medianHoldingMs: Math.round(medHold), days: days.size, shareOfInflows: Math.round(share * 100),
      },
      `${label(ctx, acc)} รับเงิน ${n} รายการ รวม ${baht(totalIn)} และมีเงินออกต่อ ${baht(totalMoved)} ` +
        `(${Math.round((totalMoved / totalIn) * 100)}% ของยอดที่รับ) ภายใน ${s.rapidWindowMin} นาทีหลังรับ ` +
        `ระยะเวลาถือเงินมัธยฐาน ${fmtDuration(medHold)}`,
      totalIn,
      cap([...inTxns, ...outTxns], 120),
    );
    (sig as Signal & { _days?: string[] })._days = [...days];
    out.push(sig);
  }
  return out;
}
