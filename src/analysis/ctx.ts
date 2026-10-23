// บริบทกลางที่ใช้ร่วมกันในทุกขั้นวิเคราะห์: index ธุรกรรม, ตัวช่วยเรื่องเวลา, การตั้งชื่อบัญชี
import type { Account, AnalysisSettings, Txn } from '../core/types';
import { bankDisplay, formatAccountNumber } from '../core/normalize';

const DAY = 86_400_000;
export const MIN = 60_000;

export interface Ctx {
  settings: AnalysisSettings;
  accounts: Record<string, Account>;
  /** ธุรกรรมที่ใช้วิเคราะห์การไหลของเงิน (ตัดค่าธรรมเนียม/ดอกเบี้ย) เรียงตามเวลา */
  txns: Txn[];
  byId: Map<string, Txn>;
  outBy: Map<string, Txn[]>;
  inBy: Map<string, Txn[]>;
}

export const isRealAccount = (a: Account | undefined): boolean => !!a && a.kind === 'account';

export function buildCtx(txns: Txn[], accounts: Record<string, Account>, settings: AnalysisSettings): Ctx {
  const flow = txns
    .filter((t) => t.kind !== 'fee' && t.kind !== 'interest')
    .sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  const byId = new Map<string, Txn>();
  const outBy = new Map<string, Txn[]>();
  const inBy = new Map<string, Txn[]>();
  for (const t of flow) {
    byId.set(t.id, t);
    (outBy.get(t.from) ?? outBy.set(t.from, []).get(t.from)!).push(t);
    (inBy.get(t.to) ?? inBy.set(t.to, []).get(t.to)!).push(t);
  }
  return { settings, accounts, txns: flow, byId, outBy, inBy };
}

export const dayOf = (ts: number) => Math.floor(ts / DAY);

/** b เกิดหลัง (หรือพร้อม) a ได้หรือไม่ — ถ้าขาดเวลาจะเทียบระดับวัน */
export function canFollow(a: Txn, b: Txn): boolean {
  if (a.hasTime && b.hasTime) return b.ts >= a.ts;
  return dayOf(b.ts) >= dayOf(a.ts);
}

/** ระยะเวลา a → b (ms) — ถ้าเป็นวันเดียวกันและไม่มีเวลา ถือว่า 0 */
export function gapMs(a: Txn, b: Txn): number {
  if (a.hasTime && b.hasTime) return b.ts - a.ts;
  if (dayOf(a.ts) === dayOf(b.ts)) return 0;
  return b.ts - a.ts;
}

export const isApprox = (...ts: Txn[]) => ts.some((t) => !t.hasTime);

export function accountLabel(acc: Account | undefined, withBank = true): string {
  if (!acc) return '(ไม่ทราบ)';
  if (acc.kind === 'cash' || acc.kind === 'unknown') return acc.name ?? acc.id;
  const num = acc.number ? formatAccountNumber(acc.number) : '';
  const bank = withBank && acc.bank ? ` ${bankDisplay(acc.bank)}` : '';
  const label = acc.label || acc.name;
  if (label && num) return `${label} (${num}${bank})`;
  if (label) return label;
  return `${num}${bank}`.trim() || acc.id;
}

export function label(ctx: Ctx, id: string): string {
  return accountLabel(ctx.accounts[id]);
}

export function sum(a: number[]): number {
  let s = 0;
  for (const v of a) s += v;
  return s;
}

export function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** มัธยฐานถ่วงน้ำหนัก */
export function weightedMedian(values: { v: number; w: number }[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a.v - b.v);
  const total = sum(s.map((x) => x.w));
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= total / 2) return x.v;
  }
  return s[s.length - 1]!.v;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
