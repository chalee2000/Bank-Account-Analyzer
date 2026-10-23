// โปรไฟล์ต่อบัญชี, Flow-through, Holding Time, คู่บัญชี
import type { AccountProfile, HoldingStats, PairStat } from '../core/types';
import type { Attribution } from './attribution';
import { isRealAccount, median, round2, sum, weightedMedian, MIN, type Ctx } from './ctx';

export function buildProfiles(ctx: Ctx, attr: Attribution): Record<string, AccountProfile> {
  const out: Record<string, AccountProfile> = {};
  const ids = new Set<string>();
  for (const t of ctx.txns) {
    if (isRealAccount(ctx.accounts[t.from])) ids.add(t.from);
    if (isRealAccount(ctx.accounts[t.to])) ids.add(t.to);
  }
  // links ต่อบัญชี
  const linksBy = new Map<string, typeof attr.links>();
  for (const l of attr.links) {
    const arr = linksBy.get(l.via);
    if (arr) arr.push(l);
    else linksBy.set(l.via, [l]);
  }

  for (const id of ids) {
    const ins = ctx.inBy.get(id) ?? [];
    const outs = ctx.outBy.get(id) ?? [];
    const totalIn = sum(ins.map((t) => t.amount));
    const totalOut = sum(outs.map((t) => t.amount));
    const all = [...ins, ...outs];
    const amounts = all.map((t) => t.amount);
    const senders = new Set(ins.map((t) => t.from).filter((f) => isRealAccount(ctx.accounts[f])));
    const receivers = new Set(outs.map((t) => t.to).filter((f) => isRealAccount(ctx.accounts[f])));
    let firstTs: number | undefined;
    let lastTs: number | undefined;
    for (const t of all) {
      if (firstTs === undefined || t.ts < firstTs) firstTs = t.ts;
      if (lastTs === undefined || t.ts > lastTs) lastTs = t.ts;
    }
    out[id] = {
      accountId: id,
      totalIn: round2(totalIn),
      totalOut: round2(totalOut),
      net: round2(totalIn - totalOut),
      inCount: ins.length,
      outCount: outs.length,
      uniqueSenders: senders.size,
      uniqueReceivers: receivers.size,
      avgAmount: amounts.length ? round2(sum(amounts) / amounts.length) : 0,
      medianAmount: round2(median(amounts)),
      maxAmount: amounts.length ? Math.max(...amounts) : 0,
      firstTs,
      lastTs,
      flowThrough: totalIn > 0 ? (totalOut / totalIn) * 100 : null,
      holding: holdingStats(linksBy.get(id) ?? [], totalIn, attr.unmatchedOut.get(id) ?? 0),
    };
  }
  return out;
}

function holdingStats(links: Attribution['links'], totalIn: number, unmatchedOut: number): HoldingStats {
  const matched = links.filter((l) => l.inTxn !== null && Number.isFinite(l.holdingMs));
  const within = (min: number) =>
    totalIn > 0 ? Math.min(1, sum(matched.filter((l) => l.holdingMs <= min * MIN).map((l) => l.amount)) / totalIn) : 0;
  return {
    pairs: matched.length,
    medianMs: weightedMedian(matched.map((l) => ({ v: l.holdingMs, w: l.amount }))),
    minMs: matched.length ? Math.min(...matched.map((l) => l.holdingMs)) : null,
    shareWithin: { 5: within(5), 15: within(15), 30: within(30), 60: within(60) },
    unmatchedOut: round2(unmatchedOut),
  };
}

export function buildPairs(ctx: Ctx): PairStat[] {
  const m = new Map<string, PairStat>();
  for (const t of ctx.txns) {
    const k = `${t.from}\u0000${t.to}`;
    const p = m.get(k);
    if (p) {
      p.total += t.amount;
      p.count++;
      if (t.ts < p.firstTs) p.firstTs = t.ts;
      if (t.ts > p.lastTs) p.lastTs = t.ts;
    } else {
      m.set(k, { from: t.from, to: t.to, total: t.amount, count: 1, firstTs: t.ts, lastTs: t.ts });
    }
  }
  const arr = [...m.values()];
  for (const p of arr) p.total = round2(p.total);
  return arr.sort((a, b) => b.total - a.total);
}
