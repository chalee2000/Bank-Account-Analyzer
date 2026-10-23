// Layering / Transit chain, Circular และ Cross-bank — อาศัยการจับคู่เงินเข้า-ออกแบบ FIFO (attribution)
import type { Signal, Txn } from '../../core/types';
import { bankDisplay } from '../../core/normalize';
import { fmtDuration } from '../../core/thai';
import type { Attribution } from '../attribution';
import { isRealAccount, label, MIN, type Ctx } from '../ctx';
import { baht, cap, clampProminence, makeSignal } from './util';

type Succ = Map<string, Txn[]>;

/** เส้นเชื่อม "เงินเข้า → เงินออก" ที่เงินก้อนเล็กกว่าถูกอธิบายด้วยการจับคู่เกือบทั้งก้อน */
function buildSucc(ctx: Ctx, attr: Attribution, windowMs: number, minRetain: number): Succ {
  const succ: Succ = new Map();
  for (const l of attr.links) {
    if (l.inTxn === null || l.holdingMs > windowMs) continue;
    const a = ctx.byId.get(l.inTxn);
    const b = ctx.byId.get(l.outTxn);
    if (!a || !b) continue;
    if (!isRealAccount(ctx.accounts[a.to])) continue;
    if (l.amount < minRetain * Math.min(a.amount, b.amount)) continue;
    const arr = succ.get(a.id);
    if (arr) { if (!arr.includes(b)) arr.push(b); }
    else succ.set(a.id, [b]);
  }
  return succ;
}

function enumeratePaths(ctx: Ctx, succ: Succ, minAmount: number): Txn[][] {
  const hasPred = new Set<string>();
  for (const outs of succ.values()) for (const o of outs) hasPred.add(o.id);
  const starts = ctx.txns.filter((t) => succ.has(t.id) && !hasPred.has(t.id) && t.amount >= minAmount);
  const paths: Txn[][] = [];
  const MAX_TOTAL = 5000;
  for (const s0 of starts) {
    let perStart = 0;
    const visit = (path: Txn[], accs: Set<string>) => {
      if (paths.length >= MAX_TOTAL || perStart >= 30) return;
      const last = path[path.length - 1]!;
      const next = (succ.get(last.id) ?? []).filter((o) => !accs.has(o.to) && path.length < 15);
      if (!next.length) {
        if (path.length >= 2) { paths.push([...path]); perStart++; }
        return;
      }
      for (const o of next) {
        path.push(o);
        accs.add(o.to);
        visit(path, accs);
        accs.delete(o.to);
        path.pop();
      }
    };
    visit([s0], new Set([s0.from, s0.to]));
  }
  return paths;
}

export function detectLayering(ctx: Ctx, attr: Attribution): Signal[] {
  const { settings: s } = ctx;
  const succ = buildSucc(ctx, attr, s.chainWindowMin * MIN, s.chainMinRetain);
  const paths = enumeratePaths(ctx, succ, s.minSignalAmount).filter((p) => p.length >= s.chainMinHops);
  if (!paths.length) return [];

  // รวมเส้นทางที่ใช้รายการร่วมกันเป็นกลุ่มเดียว
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of paths) {
    p.forEach((t) => { if (!parent.has(t.id)) parent.set(t.id, t.id); });
    for (let i = 1; i < p.length; i++) union(p[0]!.id, p[i]!.id);
  }
  const groups = new Map<string, Txn[][]>();
  for (const p of paths) {
    const r = find(p[0]!.id);
    const arr = groups.get(r);
    if (arr) arr.push(p);
    else groups.set(r, [p]);
  }

  const out: Signal[] = [];
  for (const group of groups.values()) {
    const longest = [...group].sort((a, b) => b.length - a.length || b[b.length - 1]!.amount - a[a.length - 1]!.amount)[0]!;
    const txMap = new Map<string, Txn>();
    group.forEach((p) => p.forEach((t) => txMap.set(t.id, t)));
    const txns = [...txMap.values()];
    const first = longest[0]!;
    const last = longest[longest.length - 1]!;
    const span = Math.max(...txns.map((t) => t.ts)) - Math.min(...txns.map((t) => t.ts));
    const accIds = [first.from, ...longest.map((t) => t.to)];
    const allAcc = new Set<string>(txns.flatMap((t) => [t.from, t.to]));
    const banks = new Set([...allAcc].map((a) => ctx.accounts[a]?.bank).filter(Boolean) as string[]);
    const cashExit = ctx.accounts[last.to]?.kind === 'cash';
    const hops = longest.length;
    // ยอดเข้า/ออกของทั้งกลุ่ม: รวมรายการต้นทางและรายการปลายทางที่ไม่ซ้ำกัน (รองรับกรณีรวมเงิน/แยกเงิน)
    const entries = new Map(group.map((p) => [p[0]!.id, p[0]!]));
    const exits = new Map(group.map((p) => [p[p.length - 1]!.id, p[p.length - 1]!]));
    const entryAmt = [...entries.values()].reduce((a, t) => a + t.amount, 0);
    const exitAmt = [...exits.values()].reduce((a, t) => a + t.amount, 0);
    const retain = entryAmt > 0 ? exitAmt / entryAmt : 0;
    let prom: number = hops >= 5 ? 3 : hops >= 4 || cashExit ? 2 : 1;
    if (span <= s.chainWindowMin * MIN && prom < 3) prom += 1;
    const route = accIds.map((a) => label(ctx, a)).join(' → ');
    out.push(
      makeSignal(
        'layering', accIds, txns, clampProminence(prom),
        {
          hops, accounts: allAcc.size, spanMs: span, retainPct: Math.round(retain * 100),
          banks: banks.size, cashExit: cashExit ? 'ใช่' : 'ไม่',
        },
        `พบการส่งต่อเงินผ่านบัญชีต่อเนื่อง ${hops} ทอด: ${route} ` +
          `ภายใน ${fmtDuration(span)} ยอดเริ่มต้นรวม ${baht(entryAmt)} ยอดปลายทางรวม ${baht(exitAmt)} ` +
          `(${Math.round(retain * 100)}%)${cashExit ? ' และสิ้นสุดที่การถอนเงินสด' : ''}` +
          (group.length > 1 ? ` (มี ${group.length} เส้นทางที่ใช้รายการร่วมกัน)` : ''),
        entryAmt,
      ),
    );
  }
  return out;
}

export function detectCrossBank(ctx: Ctx, layering: Signal[]): Signal[] {
  const out: Signal[] = [];
  for (const sig of layering) {
    const accIds = new Set<string>();
    for (const id of sig.txnIds) {
      const t = ctx.byId.get(id);
      if (t) { accIds.add(t.from); accIds.add(t.to); }
    }
    const banks = new Set([...accIds].map((a) => ctx.accounts[a]?.bank).filter(Boolean) as string[]);
    if (banks.size < 3) continue;
    const txns = sig.txnIds.map((id) => ctx.byId.get(id)!).filter(Boolean);
    out.push(
      makeSignal(
        'cross_bank', sig.focus, txns, banks.size >= 4 ? 3 : 2,
        { banks: banks.size, hops: sig.metrics.hops ?? 0 },
        `เส้นทางเงินในกลุ่มเดียวกันข้ามธนาคาร ${banks.size} แห่ง (${[...banks].map(bankDisplay).join(', ')}) ภายใน ${fmtDuration(sig.endTs - sig.startTs)}`,
        sig.totalAmount,
      ),
    );
  }
  return out;
}

export function detectCircular(ctx: Ctx, attr: Attribution): Signal[] {
  const { settings: s } = ctx;
  const succ = buildSucc(ctx, attr, s.circularWindowHours * 3_600_000, 0.5);
  const seen = new Set<string>();
  const out: Signal[] = [];
  let expansions = 0;

  for (const t0 of ctx.txns) {
    if (out.length >= 200 || expansions > 300_000) break;
    if (t0.amount < s.minSignalAmount || !succ.has(t0.id)) continue;
    const start = t0.from;
    if (!isRealAccount(ctx.accounts[start]) || !isRealAccount(ctx.accounts[t0.to])) continue;
    const visit = (path: Txn[], accs: Set<string>) => {
      if (path.length >= 8) return;
      const last = path[path.length - 1]!;
      for (const o of succ.get(last.id) ?? []) {
        expansions++;
        if (o.to === start) {
          const cyc = [...path, o];
          const key = cyc.map((t) => t.id).sort().join('|');
          if (!seen.has(key)) {
            seen.add(key);
            const span = o.ts - cyc[0]!.ts;
            const hops = cyc.length;
            const route = [start, ...cyc.map((t) => t.to)].map((a) => label(ctx, a)).join(' → ');
            out.push(
              makeSignal(
                'circular', [start, ...cyc.map((t) => t.to)], cyc, hops >= 4 ? 3 : hops === 3 ? 2 : 1,
                { hops, spanMs: span, startAmount: cyc[0]!.amount, returnAmount: o.amount },
                `พบเงินวนกลับมายังบัญชีต้นทาง ${hops} ทอด: ${route} ภายใน ${fmtDuration(span)} ` +
                  `(ยอดออก ${baht(cyc[0]!.amount)} ยอดกลับ ${baht(o.amount)})`,
                cyc[0]!.amount,
              ),
            );
          }
        } else if (!accs.has(o.to)) {
          path.push(o);
          accs.add(o.to);
          visit(path, accs);
          accs.delete(o.to);
          path.pop();
        }
        if (expansions > 300_000) return;
      }
    };
    visit([t0], new Set([start, t0.to]));
  }
  return cap(out, 200);
}
