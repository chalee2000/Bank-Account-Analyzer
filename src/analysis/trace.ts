// Forward / Backward Tracing — ไล่เส้นทางเงินตามการจับคู่เงินเข้า-ออก (FIFO) แบบ taint ตามสัดส่วน
//  Forward: เงินที่ออกจากบัญชี/รายการต้นทางไหลไปที่ใดบ้าง
//  Backward: เงินที่ปลายทาง (เช่น จุดถอนเงินสด) มาจากที่ใด
// ผลเป็นสมมติฐานเส้นทางที่สอดคล้องกับเวลาและยอดเงิน ไม่ใช่การพิสูจน์ว่าเป็นเงินก้อนเดียวกัน
import type { FlowLink, TraceEdge, TraceResult, Txn } from '../core/types';
import type { Attribution } from './attribution';
import { round2, type Ctx } from './ctx';

export interface TraceInput {
  direction: 'forward' | 'backward';
  accountId?: string;
  txnId?: string;
  fromTs?: number;
  toTs?: number;
  maxDepth?: number;
}

const EPS = 0.005;
const MAX_EDGES = 3000;
const MAX_PATHS = 200;

export function runTrace(ctx: Ctx, attr: Attribution, input: TraceInput): TraceResult {
  const { direction } = input;
  const maxGap = ctx.settings.traceMaxGapHours * 3_600_000;
  const maxDepth = input.maxDepth ?? 12;

  // ---- ต้นทางของการไล่ ----
  let seeds: Txn[] = [];
  if (input.txnId) {
    const t = ctx.byId.get(input.txnId);
    if (t) seeds = [t];
  } else if (input.accountId) {
    const list = direction === 'forward' ? ctx.outBy.get(input.accountId) : ctx.inBy.get(input.accountId);
    seeds = (list ?? []).filter(
      (t) => (input.fromTs === undefined || t.ts >= input.fromTs) && (input.toTs === undefined || t.ts <= input.toTs),
    );
  }

  const traced = new Map<string, number>(); // txnId → ยอดที่อ้างถึง
  const depth = new Map<string, number>();
  const adj = new Map<string, Set<string>>(); // ลำดับตามเวลา: ก่อน → หลัง
  let truncated = false;

  for (const s of seeds) {
    traced.set(s.id, s.amount);
    depth.set(s.id, 0);
  }

  // ประมวลผลตามลำดับเวลา (forward: เก่า→ใหม่, backward: ใหม่→เก่า) เพื่อให้ยอดสะสมครบก่อนส่งต่อ
  const order = (a: Txn, b: Txn) => (direction === 'forward' ? a.ts - b.ts || a.seq - b.seq : b.ts - a.ts || b.seq - a.seq);
  const queue: Txn[] = [...seeds].sort(order);
  const queued = new Set(queue.map((t) => t.id));
  let head = 0;
  while (head < queue.length) {
    // เลือกตัวที่เร็ว/ช้าที่สุดตามทิศทาง (คิวเล็ก — ใช้การแทรกแบบเรียงเพื่อความเรียบง่าย)
    const cur = queue[head++]!;
    const amt = traced.get(cur.id) ?? 0;
    if (amt <= EPS) continue;
    const d = depth.get(cur.id) ?? 0;
    if (d >= maxDepth) continue;
    const share = cur.amount > 0 ? Math.min(1, amt / cur.amount) : 0;

    let links: FlowLink[];
    if (direction === 'forward') {
      links = (attr.byIn.get(cur.id) ?? []).filter((l) => l.via === cur.to && l.holdingMs <= maxGap);
    } else {
      links = (attr.byOut.get(cur.id) ?? []).filter((l) => l.via === cur.from && l.inTxn !== null && l.holdingMs <= maxGap);
    }
    for (const l of links) {
      const nextId = direction === 'forward' ? l.outTxn : l.inTxn!;
      const next = ctx.byId.get(nextId);
      if (!next) continue;
      if (traced.size >= MAX_EDGES && !traced.has(nextId)) { truncated = true; continue; }
      traced.set(nextId, (traced.get(nextId) ?? 0) + l.amount * share);
      if (!depth.has(nextId)) depth.set(nextId, d + 1);
      const key = direction === 'forward' ? cur.id : nextId;
      const val = direction === 'forward' ? nextId : cur.id;
      (adj.get(key) ?? adj.set(key, new Set()).get(key)!).add(val);
      if (!queued.has(nextId)) {
        queued.add(nextId);
        // แทรกตามลำดับเวลาในส่วนที่ยังไม่ประมวลผล
        let i = queue.length;
        while (i > head && order(next, queue[i - 1]!) < 0) i--;
        queue.splice(i, 0, next);
      }
    }
  }

  // ---- edges ----
  const edges: TraceEdge[] = [];
  for (const [id, amt] of traced) {
    const t = ctx.byId.get(id);
    if (!t || amt <= EPS) continue;
    edges.push({
      txnId: id, from: t.from, to: t.to, ts: t.ts, amount: t.amount,
      traced: round2(Math.min(t.amount, amt)), depth: depth.get(id) ?? 0,
    });
  }
  edges.sort((a, b) => a.ts - b.ts);

  // ---- terminals ----
  const termMap = new Map<string, number>();
  for (const e of edges) {
    const t = ctx.byId.get(e.txnId)!;
    const share = t.amount > 0 ? e.traced / t.amount : 0;
    let covered = 0;
    if (direction === 'forward') {
      for (const l of attr.byIn.get(t.id) ?? []) if (l.via === t.to && l.holdingMs <= maxGap) covered += l.amount * share;
      const rest = e.traced - covered;
      if (rest > 0.01) termMap.set(t.to, (termMap.get(t.to) ?? 0) + rest);
    } else {
      for (const l of attr.byOut.get(t.id) ?? []) if (l.via === t.from && l.inTxn !== null && l.holdingMs <= maxGap) covered += l.amount * share;
      const rest = e.traced - covered;
      if (rest > 0.01) termMap.set(t.from, (termMap.get(t.from) ?? 0) + rest);
    }
  }
  const terminals = [...termMap.entries()]
    .map(([accountId, amount]) => ({
      accountId, amount: round2(amount), cash: ctx.accounts[accountId]?.kind === 'cash',
    }))
    .sort((a, b) => b.amount - a.amount);

  // ---- paths (เรียงตามเวลาเสมอ: ก่อน → หลัง) ----
  // adj เก็บ "ก่อน → หลัง" ทั้งสองทิศทาง จึงเริ่มจากรายการที่ไม่มีรายการก่อนหน้าในกราฟ
  const paths: string[][] = [];
  const chronoAdj = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const [k, set] of adj) {
    chronoAdj.set(k, [...set]);
    for (const v of set) hasIncoming.add(v);
  }
  const roots = [...traced.keys()].filter((id) => !hasIncoming.has(id) && (traced.get(id) ?? 0) > EPS);
  const dfs = (id: string, path: string[]) => {
    if (paths.length >= MAX_PATHS) { truncated = true; return; }
    path.push(id);
    const next = chronoAdj.get(id);
    if (!next?.length || path.length > maxDepth + 1) paths.push([...path]);
    else for (const n of next) dfs(n, path);
    path.pop();
  };
  for (const r of roots) dfs(r, []);
  paths.sort((a, b) => b.length - a.length);

  return {
    direction,
    seed: { accountId: input.accountId, txnId: input.txnId },
    edges,
    paths,
    terminals,
    truncated,
  };
}
