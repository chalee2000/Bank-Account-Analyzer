import type { Signal } from '../../core/types';
import type { Attribution } from '../attribution';
import type { Ctx } from '../ctx';
import { detectCashOut } from './cashout';
import { detectCircular, detectCrossBank, detectLayering } from './chains';
import { detectConvergence } from './convergence';
import { detectRapid } from './rapid';
import { detectRepeated } from './repeated';
import { detectNearThreshold, detectStructuring } from './structuring';

export function detectAllSignals(ctx: Ctx, attr: Attribution): Signal[] {
  const rapid = detectRapid(ctx, attr);
  const structuring = detectStructuring(ctx);
  const nearThreshold = detectNearThreshold(ctx);
  const convergence = detectConvergence(ctx, attr);
  const layering = detectLayering(ctx, attr);
  const crossBank = detectCrossBank(ctx, layering);
  const circular = detectCircular(ctx, attr);
  const cashOut = detectCashOut(ctx, attr);
  const base = [...rapid, ...structuring, ...nearThreshold, ...convergence, ...layering, ...crossBank, ...circular, ...cashOut];
  const repeated = detectRepeated(ctx, base);
  const all = [...base, ...repeated];
  // ลบ _days ชั่วคราว
  for (const s of all) delete (s as Signal & { _days?: string[] })._days;
  // id ต้องไม่ซ้ำ (ใช้เป็น key และอ้างอิงจากผลวิเคราะห์)
  const seen = new Map<string, number>();
  for (const s of all) {
    const n = seen.get(s.id) ?? 0;
    seen.set(s.id, n + 1);
    if (n > 0) s.id = `${s.id}#${n + 1}`;
  }
  return all.sort((a, b) => b.prominence - a.prominence || b.totalAmount - a.totalAmount);
}

export { detectRapid, detectStructuring, detectNearThreshold, detectConvergence, detectLayering, detectCrossBank, detectCircular, detectCashOut, detectRepeated };
