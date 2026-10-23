// จับคู่เงินเข้า → เงินออกของแต่ละบัญชีแบบ FIFO (เงินที่เข้ามาก่อนถูกใช้ก่อน)
//
// เป็น "สมมติฐานการจับคู่" ไม่ใช่ข้อเท็จจริงว่าเงินก้อนใดถูกโอนต่อ — เงินเป็นของที่ทดแทนกันได้
// ผลลัพธ์ใช้คำนวณ Holding Time และเป็นฐานของ Forward/Backward Tracing
// เงื่อนไข: ใช้ลำดับเวลา + ยอดเงิน + บัญชีที่รับ/ส่งต่อ (ไม่จับคู่จากยอดเงินอย่างเดียวข้ามบัญชี)

import type { FlowLink, Txn } from '../core/types';
import { gapMs, isRealAccount, type Ctx } from './ctx';

const EPS = 0.005;

interface Ev {
  t: Txn;
  inflow: boolean;
}

export interface Attribution {
  links: FlowLink[];
  /** ยอดเงินออกที่ไม่มีเงินเข้าที่ปรากฏในข้อมูลรองรับ (ยอดยกมา/บัญชีที่ไม่มี statement) */
  unmatchedOut: Map<string, number>;
  byIn: Map<string, FlowLink[]>;
  byOut: Map<string, FlowLink[]>;
}

export function computeAttribution(ctx: Ctx): Attribution {
  const links: FlowLink[] = [];
  const unmatchedOut = new Map<string, number>();
  const byIn = new Map<string, FlowLink[]>();
  const byOut = new Map<string, FlowLink[]>();

  const accountIds = new Set<string>();
  for (const t of ctx.txns) {
    if (isRealAccount(ctx.accounts[t.from])) accountIds.add(t.from);
    if (isRealAccount(ctx.accounts[t.to])) accountIds.add(t.to);
  }

  for (const acc of accountIds) {
    const evs: Ev[] = [];
    for (const t of ctx.inBy.get(acc) ?? []) evs.push({ t, inflow: true });
    for (const t of ctx.outBy.get(acc) ?? []) evs.push({ t, inflow: false });
    // เวลาเท่ากัน: เงินเข้าก่อนเงินออก (เงินต้องมาถึงก่อนจึงโอนต่อได้)
    evs.sort((a, b) => a.t.ts - b.t.ts || (a.inflow === b.inflow ? 0 : a.inflow ? -1 : 1) || a.t.seq - b.t.seq);

    const queue: { t: Txn; remaining: number }[] = [];
    let head = 0;
    for (const ev of evs) {
      if (ev.inflow) {
        queue.push({ t: ev.t, remaining: ev.t.amount });
        continue;
      }
      let need = ev.t.amount;
      while (need > EPS && head < queue.length) {
        const lot = queue[head]!;
        if (lot.remaining <= EPS) { head++; continue; }
        const take = Math.min(lot.remaining, need);
        const link: FlowLink = {
          inTxn: lot.t.id,
          outTxn: ev.t.id,
          via: acc,
          amount: take,
          holdingMs: Math.max(0, gapMs(lot.t, ev.t)),
        };
        links.push(link);
        pushTo(byIn, link.inTxn!, link);
        pushTo(byOut, link.outTxn, link);
        lot.remaining -= take;
        need -= take;
        if (lot.remaining <= EPS) head++;
      }
      if (need > EPS) {
        const link: FlowLink = { inTxn: null, outTxn: ev.t.id, via: acc, amount: need, holdingMs: Infinity };
        links.push(link);
        pushTo(byOut, link.outTxn, link);
        unmatchedOut.set(acc, (unmatchedOut.get(acc) ?? 0) + need);
      }
    }
  }
  return { links, unmatchedOut, byIn, byOut };
}

function pushTo(m: Map<string, FlowLink[]>, k: string, v: FlowLink) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}
