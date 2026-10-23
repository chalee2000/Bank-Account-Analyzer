// ป้ายบทบาทเบื้องต้น "อาจมีบทบาท…" — ได้จากโครงสร้างข้อมูลเท่านั้น ห้ามยกระดับเป็นข้อเท็จจริง
import type { AccountProfile, NodeMetrics, RoleHint, Signal, Txn } from '../core/types';
import { fmtDuration, fmtPct } from '../core/thai';
import type { Ctx } from './ctx';

export const ROLE_LABEL: Record<RoleHint['role'], string> = {
  source: 'อาจเป็นจุดกระจายเงิน (Source/Distributor)',
  convergence: 'อาจเป็นจุดรวมเงิน (Convergence Point)',
  transit: 'อาจเป็นบัญชีทางผ่าน (Transit/Layering)',
  bridge: 'อาจเป็นจุดเชื่อมหลายกลุ่ม (Bridge/Broker)',
  cash_out: 'อาจเกี่ยวข้องกับจุดถอนเงินสด (Cash-out)',
  asset_conversion: 'อาจเกี่ยวข้องกับการเปลี่ยนเป็นทรัพย์สิน/สินทรัพย์ดิจิทัล (Asset Conversion)',
};

const ASSET_RE = /ทอง|gold|คริปโต|crypto|bitkub|binance|satang|bitazza|ประกัน|ซื้อรถ|ผ่อนรถ|หลักทรัพย์|หุ้น|ซื้อขายที่ดิน|อสังหา/i;

export function buildRoleHints(
  ctx: Ctx,
  profiles: Record<string, AccountProfile>,
  metrics: Record<string, NodeMetrics>,
  signals: Signal[],
): Record<string, RoleHint[]> {
  const hints: Record<string, RoleHint[]> = {};
  const add = (id: string, h: RoleHint) => {
    const arr = hints[id] ?? (hints[id] = []);
    if (!arr.some((x) => x.role === h.role)) arr.push(h);
  };

  // จากสัญญาณ
  for (const s of signals) {
    if (s.type === 'convergence' && s.focus[0]) {
      add(s.focus[0], { role: 'convergence', reason: `เป็นจุดรับเงินจาก ${s.metrics.senders} บัญชีในช่วงเวลาใกล้กัน` });
    }
    if (s.type === 'structuring' && s.focus[0]) {
      add(s.focus[0], { role: 'source', reason: `โอนออกเป็นก้อนใกล้เคียงกัน ${s.metrics.count} รายการไป ${s.metrics.receivers} บัญชี` });
    }
    if (s.type === 'cash_out' && s.focus[0]) {
      add(s.focus[0], { role: 'cash_out', reason: `ถอนเงินสด ${s.metrics.withdrawals} ครั้งหลังมีเงินโอนเข้า` });
    }
    if (s.type === 'layering') {
      const ids = new Set<string>();
      for (const id of s.txnIds) {
        const t = ctx.byId.get(id);
        if (t) { ids.add(t.from); ids.add(t.to); }
      }
      const first = s.focus[0];
      const last = s.focus[s.focus.length - 1];
      for (const a of s.focus) {
        if (a !== first && a !== last && ctx.accounts[a]?.kind === 'account') {
          add(a, { role: 'transit', reason: `อยู่ระหว่างทางของเส้นทางส่งต่อเงิน ${s.metrics.hops} ทอด` });
        }
      }
    }
  }

  // จากโปรไฟล์
  for (const [id, p] of Object.entries(profiles)) {
    const med = p.holding.medianMs;
    if (
      p.flowThrough !== null && p.flowThrough >= 80 && p.flowThrough <= 120 &&
      med !== null && med <= 60 * 60_000 && p.inCount >= 2 && p.outCount >= 2
    ) {
      add(id, { role: 'transit', reason: `Flow-through ${fmtPct(p.flowThrough, 0)} และระยะเวลาถือเงินมัธยฐาน ${fmtDuration(med)}` });
    }
    if (p.uniqueReceivers >= 4 && p.totalIn < p.totalOut * 0.2) {
      add(id, { role: 'source', reason: `โอนออก ${p.uniqueReceivers} บัญชี แต่มียอดเงินเข้าในข้อมูลน้อยกว่ายอดออกมาก` });
    }
  }

  // Bridge: จุดตัดและ betweenness อยู่ในกลุ่มสูงสุด
  const bets = Object.values(metrics).map((m) => m.betweenness).filter((b) => b > 0).sort((a, b) => a - b);
  const thr = bets.length ? bets[Math.floor(bets.length * 0.75)]! : Infinity;
  for (const m of Object.values(metrics)) {
    if (m.isBridge && m.betweenness > 0 && m.betweenness >= thr) {
      add(m.accountId, { role: 'bridge', reason: `เป็นจุดตัดของเครือข่าย (ถ้าตัดบัญชีนี้ออกเครือข่ายแยกจากกัน) และ Betweenness อยู่ในกลุ่มสูง` });
    }
  }

  // Asset conversion จากข้อความรายละเอียดของรายการที่เงินออก
  const seen = new Set<string>();
  for (const t of ctx.txns as Txn[]) {
    if (t.description && ASSET_RE.test(t.description) && !seen.has(t.from)) {
      seen.add(t.from);
      add(t.from, { role: 'asset_conversion', reason: `รายละเอียดรายการมีคำเกี่ยวกับทรัพย์สิน: "${t.description.slice(0, 60)}"` });
    }
  }
  return hints;
}
