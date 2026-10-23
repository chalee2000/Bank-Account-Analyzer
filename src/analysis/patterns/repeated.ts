// Repeated pattern: รูปแบบเดิมเกิดซ้ำในหลายวัน หรือคู่บัญชี/ยอดเดิมเกิดซ้ำเป็นรอบ
import type { Signal, SignalType, Txn } from '../../core/types';
import { isoDate } from '../../core/thai';
import { isRealAccount, label, sum, type Ctx } from '../ctx';
import { baht, clampProminence, makeSignal } from './util';

const TYPE_TH: Partial<Record<SignalType, string>> = {
  rapid_movement: 'เงินไหลผ่านเร็ว',
  structuring: 'การแบ่งโอนเป็นก้อนใกล้เคียงกัน',
  convergence: 'การรวมเงินเข้าบัญชีเดียว',
  cash_out: 'การถอนเงินสดหลังรับโอน',
  layering: 'การส่งต่อเงินผ่านบัญชีต่อเนื่อง',
};

export function detectRepeated(ctx: Ctx, signals: Signal[]): Signal[] {
  const { settings: s } = ctx;
  const out: Signal[] = [];

  // 1) สัญญาณชนิดเดียวกัน บัญชีกลางเดียวกัน เกิดซ้ำหลายวัน
  const groups = new Map<string, Signal[]>();
  for (const sg of signals) {
    if (!TYPE_TH[sg.type]) continue;
    const key = `${sg.type}|${sg.focus[0] ?? ''}`;
    const arr = groups.get(key);
    if (arr) arr.push(sg);
    else groups.set(key, [sg]);
  }
  for (const [key, arr] of groups) {
    const type = key.split('|')[0] as SignalType;
    const acc = key.split('|')[1]!;
    const days = new Set<string>();
    for (const sg of arr) {
      const extra = (sg as Signal & { _days?: string[] })._days;
      if (extra) extra.forEach((d) => days.add(d));
      else days.add(isoDate(sg.startTs));
    }
    if (days.size < s.repeatedMinDays) continue;
    const ids = [...new Set(arr.flatMap((sg) => sg.txnIds))];
    const txns = ids.map((id) => ctx.byId.get(id)).filter(Boolean) as Txn[];
    if (!txns.length) continue;
    out.push(
      makeSignal(
        'repeated', [acc], txns, clampProminence(days.size >= s.repeatedMinDays * 2 ? 3 : 2),
        { baseType: type, days: days.size, occurrences: arr.length },
        `รูปแบบ "${TYPE_TH[type]}" ที่เกี่ยวข้องกับ ${label(ctx, acc)} เกิดซ้ำ ${arr.length} ครั้งใน ${days.size} วันที่ต่างกัน`,
        sum(arr.map((x) => x.totalAmount)),
        txns.slice(0, 150),
      ),
    );
  }

  // 2) คู่บัญชีเดิม ยอดใกล้เคียงเดิม เกิดซ้ำหลายวัน (อาจเป็นรอบชำระปกติ เช่น ค่าเช่า/เงินเดือน — ต้องพิจารณาคำอธิบายทางเลือก)
  const pairs = new Map<string, Txn[]>();
  for (const t of ctx.txns) {
    if (t.amount < s.minSignalAmount) continue;
    if (!isRealAccount(ctx.accounts[t.from]) || !isRealAccount(ctx.accounts[t.to])) continue;
    const k = `${t.from}\u0000${t.to}`;
    const a = pairs.get(k);
    if (a) a.push(t);
    else pairs.set(k, [t]);
  }
  for (const list of pairs.values()) {
    // จัดกลุ่มตามยอดที่ใกล้กัน (±tolerance)
    const sorted = [...list].sort((a, b) => a.amount - b.amount);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1]!.amount - sorted[i]!.amount <= 2 * s.splitAmountTolerance * sorted[j + 1]!.amount) j++;
      const grp = sorted.slice(i, j + 1);
      const days = new Set(grp.map((t) => isoDate(t.ts)));
      if (grp.length >= 3 && days.size >= s.repeatedMinDays) {
        const g0 = grp[0]!;
        out.push(
          makeSignal(
            'repeated', [g0.from, g0.to], grp, clampProminence(days.size >= s.repeatedMinDays * 2 ? 3 : 1),
            { baseType: 'pair', days: days.size, occurrences: grp.length },
            `${label(ctx, g0.from)} โอนไป ${label(ctx, g0.to)} ยอดใกล้เคียงกัน (${baht(Math.min(...grp.map((t) => t.amount)))} – ${baht(Math.max(...grp.map((t) => t.amount)))}) ` +
              `${grp.length} ครั้งใน ${days.size} วันที่ต่างกัน`,
            sum(grp.map((t) => t.amount)),
          ),
        );
      }
      i = j + 1;
    }
  }
  return out;
}
