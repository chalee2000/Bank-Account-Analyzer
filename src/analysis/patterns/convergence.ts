// Convergence: หลายบัญชีโอนเข้าบัญชีเดียวในเวลาใกล้กัน
import type { Signal, Txn } from '../../core/types';
import { fmtPct } from '../../core/thai';
import type { Attribution } from '../attribution';
import { dayOf, isRealAccount, label, MIN, sum, type Ctx } from '../ctx';
import { baht, clampProminence, makeSignal, spanText } from './util';

export function detectConvergence(ctx: Ctx, attr: Attribution): Signal[] {
  const { settings: s } = ctx;
  const W = s.convergeWindowMin * MIN;
  const CW = s.chainWindowMin * MIN;
  const out: Signal[] = [];

  for (const [acc, list] of ctx.inBy) {
    if (!isRealAccount(ctx.accounts[acc])) continue;
    const ins = list.filter((t) => isRealAccount(ctx.accounts[t.from]) && t.kind !== 'cash_deposit');
    let i = 0;
    while (i < ins.length) {
      const t0 = ins[i]!;
      const win: Txn[] = [];
      for (let j = i; j < ins.length; j++) {
        const t = ins[j]!;
        const inWin = t0.hasTime && t.hasTime ? t.ts - t0.ts <= W : dayOf(t.ts) === dayOf(t0.ts);
        if (!inWin) break;
        win.push(t);
      }
      const senders = new Set(win.map((t) => t.from));
      const total = sum(win.map((t) => t.amount));
      if (senders.size >= s.convergeMinSenders && total >= s.minSignalAmount) {
        const forwarded = sum(
          win.flatMap((t) => (attr.byIn.get(t.id) ?? []).filter((l) => l.via === acc && l.holdingMs <= CW).map((l) => l.amount)),
        );
        const share = total > 0 ? forwarded / total : 0;
        const approx = win.some((t) => !t.hasTime);
        const base = senders.size >= 6 ? 3 : senders.size >= 4 ? 2 : 1;
        const prom = clampProminence(base + (share >= 0.8 && base < 3 ? 1 : 0));
        out.push(
          makeSignal(
            'convergence', [acc, ...senders], win, prom,
            { senders: senders.size, total: Math.round(total), forwardedShare: Math.round(share * 100) },
            `${label(ctx, acc)} ได้รับเงินจาก ${senders.size} บัญชีที่ต่างกัน รวม ${baht(total)} ` +
              `${spanText(win[0]!.ts, win[win.length - 1]!.ts, approx)} ` +
              `และมีเงินออกต่อ ${baht(forwarded)} (${fmtPct(share * 100, 0)} ของยอดที่รวม) ภายใน ${s.chainWindowMin} นาที`,
            total,
          ),
        );
        i += win.length; // ข้ามกลุ่มที่นับแล้ว
      } else {
        i++;
      }
    }
  }
  return out;
}
