// Cash-out: ถอนเงินสดสูงหลังมีเงินโอนเข้าในเวลาไม่นาน
import type { Signal, Txn } from '../../core/types';
import type { Attribution } from '../attribution';
import { isRealAccount, label, MIN, sum, type Ctx } from '../ctx';
import { baht, clampProminence, makeSignal } from './util';

export function detectCashOut(ctx: Ctx, attr: Attribution): Signal[] {
  const { settings: s } = ctx;
  const W = s.cashOutWindowMin * MIN;
  const out: Signal[] = [];

  for (const [acc, outs] of ctx.outBy) {
    if (!isRealAccount(ctx.accounts[acc])) continue;
    const ws = outs.filter((t) => t.kind === 'cash_withdrawal' && t.amount >= s.minSignalAmount);
    if (!ws.length) continue;
    const funded: { w: Txn; share: number; inflows: Txn[]; moved: number }[] = [];
    for (const w of ws) {
      const links = (attr.byOut.get(w.id) ?? []).filter((l) => l.via === acc && l.inTxn !== null && l.holdingMs <= W);
      const moved = sum(links.map((l) => l.amount));
      const share = moved / w.amount;
      if (share >= 0.5) {
        funded.push({
          w, share, moved,
          inflows: [...new Set(links.map((l) => l.inTxn!))].map((id) => ctx.byId.get(id)!).filter(Boolean),
        });
      }
    }
    // รวมการถอนที่ห่างกันไม่เกิน 3 ชม. เป็นสัญญาณเดียว
    let cluster: typeof funded = [];
    const flush = () => {
      if (!cluster.length) return;
      const wTx = cluster.map((c) => c.w);
      const inTx = [...new Map(cluster.flatMap((c) => c.inflows).map((t) => [t.id, t])).values()];
      const total = sum(wTx.map((t) => t.amount));
      const moved = sum(cluster.map((c) => c.moved));
      const sources = new Set(inTx.map((t) => t.from));
      const locs = new Set(wTx.map((t) => t.location).filter(Boolean) as string[]);
      out.push(
        makeSignal(
          'cash_out', [acc, ...sources], [...wTx, ...inTx], clampProminence(wTx.length >= 3 || total >= 500_000 ? 3 : total >= 100_000 ? 2 : 1),
          { withdrawals: wTx.length, total: Math.round(total), fundedPct: Math.round((moved / total) * 100), locations: locs.size },
          `${label(ctx, acc)} ถอนเงินสด ${wTx.length} ครั้ง รวม ${baht(total)} โดย ${Math.round((moved / total) * 100)}% ของยอดถอน ` +
            `ตรงกับเงินที่โอนเข้ามาภายใน ${s.cashOutWindowMin} นาทีก่อนถอน (จาก ${sources.size} บัญชี)` +
            (locs.size ? ` · สถานที่/ตู้ที่ระบุ ${locs.size} แห่ง` : ''),
          total,
        ),
      );
      cluster = [];
    };
    for (const f of funded) {
      const last = cluster[cluster.length - 1];
      if (last && f.w.ts - last.w.ts > 180 * MIN) flush();
      cluster.push(f);
    }
    flush();
  }
  return out;
}
