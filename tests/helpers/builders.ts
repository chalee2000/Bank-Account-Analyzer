import type { Account, Txn } from '../../src/core/types';

export const D = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, m - 1, d, h, mi, s);

export function acct(id: string, bank: string, name?: string, hasStatement = true): Account {
  const number = id.replace(/^[^:]+:/, '');
  return { id, number, bank, name, masked: false, kind: 'account', hasStatement };
}

let seq = 0;
export function tx(
  from: string, to: string, amount: number, ts: number,
  extra: Partial<Txn> = {},
): Txn {
  seq++;
  return {
    id: extra.id ?? `t${seq}`,
    ts,
    hasTime: true,
    seq,
    from,
    to,
    amount,
    kind: 'transfer',
    owners: [from],
    sources: [{ fileId: 'f', row: seq }],
    ...extra,
  };
}

export function resetSeq() {
  seq = 0;
}

/** ตัวอย่างจากสกิล §8: A → B1,B2,B3 → C → D → E → F → ATM */
export function skillExample() {
  resetSeq();
  const accounts: Record<string, Account> = {};
  const defs: [string, string, string][] = [
    ['A', 'KBANK', 'บัญชี A'], ['B1', 'SCB', 'บัญชี B1'], ['B2', 'BBL', 'บัญชี B2'], ['B3', 'KTB', 'บัญชี B3'],
    ['C', 'KBANK', 'บัญชี C'], ['D', 'SCB', 'บัญชี D'], ['E', 'BAY', 'บัญชี E'], ['F', 'TTB', 'บัญชี F'],
  ];
  for (const [k, bank, name] of defs) accounts[k] = acct(k, bank, name);
  accounts['cash:F'] = { id: 'cash:F', number: '', name: 'เงินสด (ATM) — F', masked: false, kind: 'cash', hasStatement: false };
  const t = (h: number, m: number) => D(2024, 3, 5, h, m);
  const txns: Txn[] = [
    tx('A', 'B1', 95_000, t(9, 0), { id: 'a-b1' }),
    tx('A', 'B2', 94_000, t(9, 1), { id: 'a-b2' }),
    tx('A', 'B3', 96_000, t(9, 2), { id: 'a-b3' }),
    tx('B1', 'C', 95_000, t(9, 10), { id: 'b1-c' }),
    tx('B2', 'C', 94_000, t(9, 11), { id: 'b2-c' }),
    tx('B3', 'C', 96_000, t(9, 12), { id: 'b3-c' }),
    tx('C', 'D', 285_000, t(9, 20), { id: 'c-d' }),
    tx('D', 'E', 280_000, t(9, 30), { id: 'd-e' }),
    tx('E', 'F', 275_000, t(9, 40), { id: 'e-f' }),
    tx('F', 'cash:F', 270_000, t(9, 55), { id: 'f-atm', kind: 'cash_withdrawal', location: 'ATM สาขาตัวอย่าง' }),
  ];
  return { accounts, txns };
}
