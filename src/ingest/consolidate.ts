// รวมแถว statement จากทุกไฟล์/ทุกบัญชีให้เป็น Master Transaction Table
//  1) ผูกบัญชี (normalize id, รวม ?:เลข กับ ธนาคาร:เลข เฉพาะที่เลขตรงกันทุกหลักและไม่กำกวม)
//  2) ลบรายการซ้ำข้ามไฟล์ (statement ช่วงเวลาซ้อนทับกัน)
//  3) Mirror matching: รายการเดียวกันที่ปรากฏทั้งใน statement ของผู้โอนและผู้รับ → นับเป็นรายการเดียว
//  4) ทำเป็นเส้นทางเงินทิศเดียว from → to
// ฟังก์ชันนี้เป็น pure (ไม่มี DOM/IO) จึงรันซ้ำได้ทุกครั้งที่เพิ่ม/ลบไฟล์หรือยืนยันการรวมบัญชี

import type { Account, AliasGroup, AnalysisSettings, Txn, TxnExtra } from '../core/types';
import {
  accountsCompatible, buildAccountId, cashAccountId, formatAccountNumber, isPseudoAccount,
  normalizeName, unknownAccountId, bankDisplay,
} from '../core/normalize';
import type { OwnerInfo, StatementRow } from './types';

export interface FileRows {
  fileId: string;
  owner: OwnerInfo;
  rows: StatementRow[];
}

export interface AliasSuggestion {
  a: string;
  b: string;
  reason: string;
}

export interface ConsolidateResult {
  txns: Txn[];
  accounts: Record<string, Account>;
  duplicatesByFile: Record<string, number>;
  mirrorsMerged: number;
  ambiguousMirrors: number;
  aliasSuggestions: AliasSuggestion[];
}

interface Entry {
  fileIdx: number;
  fileId: string;
  ownerId: string;
  row: StatementRow;
  cpId: string;
  used: boolean;
}

function parseId(id: string): { bank?: string; number: string; isName: boolean } {
  if (id.startsWith('name:')) return { number: '', isName: true };
  const i = id.indexOf(':');
  const bank = id.slice(0, i);
  return { bank: bank === '?' ? undefined : bank, number: id.slice(i + 1), isName: false };
}

/** รายการ mirror มาจาก 2 statement — รวมหลักฐานเสริมของทั้งสองฝั่ง (ฝั่งผู้โอนมาก่อน) */
function mergeExtra(a?: TxnExtra, b?: TxnExtra): TxnExtra | undefined {
  if (!a) return b;
  if (!b) return a;
  return { ...b, ...a };
}

function bankCompat(a?: string, b?: string): boolean {
  return !a || !b || a === b;
}

export function consolidate(
  files: FileRows[],
  aliases: AliasGroup[],
  settings: Pick<AnalysisSettings, 'mirrorToleranceMin'>,
): ConsolidateResult {
  const idMap = new Map<string, string>();
  for (const g of aliases) {
    const canon = g.members[0];
    if (!canon) continue;
    for (const m of g.members) idMap.set(m, canon);
  }
  const canon = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 5; i++) {
      const nx = idMap.get(cur);
      if (!nx || nx === cur) break;
      cur = nx;
    }
    return cur;
  };

  // ---------- 1) รวบรวม id ----------
  const ownerInfoById = new Map<string, OwnerInfo>();
  const entries: Entry[] = [];
  const nameById = new Map<string, string>();
  const bankById = new Map<string, string | undefined>();

  files.forEach((f, fileIdx) => {
    const rawOwnerId = buildAccountId(f.owner.bank, f.owner.number);
    const ownerId = canon(rawOwnerId);
    if (!ownerInfoById.has(ownerId)) ownerInfoById.set(ownerId, f.owner);
    if (f.owner.name) nameById.set(ownerId, f.owner.name);
    bankById.set(ownerId, f.owner.bank);
    for (const row of f.rows) {
      let cpId: string;
      if (row.kind === 'cash_deposit' || row.kind === 'cash_withdrawal') cpId = cashAccountId(ownerId);
      else if (row.kind === 'fee' || row.kind === 'interest') cpId = unknownAccountId(ownerId);
      else if (row.cp.number) cpId = canon(buildAccountId(row.cp.bank, row.cp.number));
      else if (row.cp.name) cpId = canon(`name:${normalizeName(row.cp.name)}`);
      else cpId = unknownAccountId(ownerId);
      if (!isPseudoAccount(cpId)) {
        if (row.cp.name && !nameById.has(cpId) && !cpId.startsWith('name:')) nameById.set(cpId, row.cp.name);
        if (row.cp.name && cpId.startsWith('name:')) nameById.set(cpId, row.cp.name);
        if (!bankById.has(cpId)) bankById.set(cpId, row.cp.bank);
        else if (!bankById.get(cpId) && row.cp.bank) bankById.set(cpId, row.cp.bank);
      }
      entries.push({ fileIdx, fileId: f.fileId, ownerId, row, cpId, used: false });
    }
  });

  // ?:เลข ↔ ธนาคาร:เลข  (เฉพาะเลขเต็มที่ไม่ถูกปิดบัง และมีผู้ถูกจับคู่เพียงรายเดียว)
  const allIds = new Set<string>([...ownerInfoById.keys(), ...entries.map((e) => e.cpId)]);
  const byNumber = new Map<string, string[]>();
  for (const id of allIds) {
    if (isPseudoAccount(id) || id.startsWith('name:')) continue;
    const p = parseId(id);
    if (p.number.includes('X')) continue;
    const arr = byNumber.get(p.number) ?? [];
    arr.push(id);
    byNumber.set(p.number, arr);
  }
  const autoUnify = new Map<string, string>();
  for (const [, ids] of byNumber) {
    const unknownBank = ids.filter((i) => i.startsWith('?:'));
    const withBank = ids.filter((i) => !i.startsWith('?:'));
    if (unknownBank.length === 1 && withBank.length === 1) autoUnify.set(unknownBank[0]!, withBank[0]!);
  }
  const fullCanon = (id: string) => {
    const c = canon(id);
    return autoUnify.get(c) ?? c;
  };
  for (const e of entries) {
    e.ownerId = fullCanon(e.ownerId);
    e.cpId = fullCanon(e.cpId);
  }
  const owners = new Map<string, OwnerInfo>();
  for (const [id, info] of ownerInfoById) {
    const c = fullCanon(id);
    if (!owners.has(c)) owners.set(c, info);
  }
  for (const [id, n] of [...nameById]) {
    const c = fullCanon(id);
    if (!nameById.has(c)) nameById.set(c, n);
  }
  for (const [id, b] of [...bankById]) {
    const c = fullCanon(id);
    if (!bankById.get(c) && b) bankById.set(c, b);
  }
  const ownerIds = new Set(owners.keys());

  // ---------- 2) ลบรายการซ้ำข้ามไฟล์ ----------
  const duplicatesByFile: Record<string, number> = {};
  const seenKey = new Map<string, number>(); // key → fileIdx แรกที่พบ
  const dedupKeyOf = (e: Entry) =>
    [e.ownerId, e.row.ts, e.row.direction, e.row.amount.toFixed(2), e.row.balanceAfter?.toFixed(2) ?? '',
      (e.row.description ?? '').replace(/\s+/g, ' ').toLowerCase(), e.cpId].join('|');
  const kept: Entry[] = [];
  const occurrenceInFile = new Map<string, number>();
  for (const e of entries) {
    const base = dedupKeyOf(e);
    // รายการเหมือนกันทุกประการ "ในไฟล์เดียวกัน" เป็นไปได้ในความจริง จึงนับลำดับที่ n ในไฟล์ แล้วลบเฉพาะที่เกินจากไฟล์แรกที่พบ
    const nth = (occurrenceInFile.get(`${e.fileIdx}|${base}`) ?? 0) + 1;
    occurrenceInFile.set(`${e.fileIdx}|${base}`, nth);
    const k = `${base}#${nth}`;
    const first = seenKey.get(k);
    if (first === undefined) {
      seenKey.set(k, e.fileIdx);
      kept.push(e);
    } else if (first !== e.fileIdx) {
      duplicatesByFile[e.fileId] = (duplicatesByFile[e.fileId] ?? 0) + 1;
    } else {
      kept.push(e);
    }
  }

  // ---------- 3) Mirror matching ----------
  const compatTo = (cpId: string, ownerId: string): boolean => {
    if (cpId === ownerId) return true;
    if (isPseudoAccount(cpId)) return false;
    const a = parseId(cpId);
    const b = parseId(ownerId);
    if (a.isName) {
      const nm = owners.get(ownerId)?.name ?? nameById.get(ownerId);
      return !!nm && normalizeName(nm) === cpId.slice(5);
    }
    if (b.isName) return false;
    return bankCompat(a.bank, b.bank) && accountsCompatible(a.number, b.number);
  };
  const tolMs = settings.mirrorToleranceMin * 60_000;
  const sameDay = (a: number, b: number) => Math.floor(a / 86_400_000) === Math.floor(b / 86_400_000);
  const timeOk = (a: StatementRow, b: StatementRow) =>
    a.hasTime && b.hasTime ? Math.abs(a.ts - b.ts) <= tolMs : sameDay(a.ts, b.ts);

  const inboundIndex = new Map<string, Entry[]>(); // `${ownerId}|${cents}`
  for (const e of kept) {
    if (e.row.direction !== 'in' || e.row.kind === 'cash_deposit') continue;
    const k = `${e.ownerId}|${Math.round(e.row.amount * 100)}`;
    const arr = inboundIndex.get(k) ?? [];
    arr.push(e);
    inboundIndex.set(k, arr);
  }

  const txns: Txn[] = [];
  let mirrorsMerged = 0;
  let ambiguousMirrors = 0;
  const mk = (e: Entry): Txn => {
    const r = e.row;
    const out = r.direction === 'out';
    const flags = r.flags.filter((f) => f !== 'direction_from_keyword');
    if (r.flags.includes('direction_from_keyword')) flags.push('direction_from_keyword');
    return {
      id: `${e.fileId}:${r.row}`,
      ts: r.ts,
      hasTime: r.hasTime,
      seq: r.seq,
      from: out ? e.ownerId : e.cpId,
      to: out ? e.cpId : e.ownerId,
      amount: r.amount,
      kind: r.kind,
      channel: r.channel,
      description: r.description,
      reference: r.reference,
      location: r.location,
      balanceAfter: r.balanceAfter,
      extra: r.extra,
      owners: [e.ownerId],
      sources: [{ fileId: e.fileId, row: r.row }],
      inferred: r.cp.inferred || undefined,
      flags: flags.length ? flags : undefined,
    };
  };

  for (const e of kept) {
    if (e.used || e.row.direction !== 'out' || e.row.kind === 'cash_withdrawal') continue;
    if (isPseudoAccount(e.cpId)) continue;
    const cents = Math.round(e.row.amount * 100);
    // ผู้รับที่เป็นเจ้าของ statement และเข้ากันได้กับ cpId
    const candidates: Entry[] = [];
    for (const b of ownerIds) {
      if (b === e.ownerId || !compatTo(e.cpId, b)) continue;
      for (const m of inboundIndex.get(`${b}|${cents}`) ?? []) {
        if (m.used || m.fileIdx === e.fileIdx && m.row.row === e.row.row) continue;
        if (!compatTo(m.cpId, e.ownerId)) continue;
        if (!timeOk(e.row, m.row)) continue;
        candidates.push(m);
      }
    }
    if (!candidates.length) continue;
    candidates.sort((x, y) => Math.abs(x.row.ts - e.row.ts) - Math.abs(y.row.ts - e.row.ts));
    const m = candidates[0]!;
    const ambiguous = candidates.length > 1 && Math.abs(candidates[1]!.row.ts - e.row.ts) === Math.abs(m.row.ts - e.row.ts);
    e.used = true;
    m.used = true;
    mirrorsMerged++;
    if (ambiguous) ambiguousMirrors++;
    const base = mk(e);
    const inferred = e.cpId !== m.ownerId || m.cpId !== e.ownerId || undefined;
    const flags = [...(base.flags ?? [])];
    if (ambiguous) flags.push('ambiguous_mirror');
    txns.push({
      ...base,
      to: m.ownerId,
      from: e.ownerId,
      ts: e.row.hasTime || !m.row.hasTime ? e.row.ts : m.row.ts,
      hasTime: e.row.hasTime || m.row.hasTime,
      balanceAfter: undefined,
      description: e.row.description ?? m.row.description,
      channel: e.row.channel ?? m.row.channel,
      reference: e.row.reference ?? m.row.reference,
      location: e.row.location ?? m.row.location,
      extra: mergeExtra(e.row.extra, m.row.extra),
      owners: [e.ownerId, m.ownerId],
      sources: [...base.sources, { fileId: m.fileId, row: m.row.row }],
      mirrored: true,
      inferred: (base.inferred || inferred) ? true : undefined,
      flags: flags.length ? flags : undefined,
    });
  }
  // ---- รอบที่ 2: จับคู่สองฝั่งจาก "ยอด + เวลา" เมื่อฝั่งใดฝั่งหนึ่งระบุคู่บัญชีไม่ได้ (เช่น OCR อ่านเลขบัญชีเพี้ยน) ----
  // เงื่อนไขเข้ม: ยอดตรงทุกสตางค์ เวลาใกล้กัน อีกฝั่งต้องเข้ากันได้ และต้องเป็นคู่เดียวที่เป็นไปได้ทั้งสองทาง — ติดธงให้ตรวจสอบ
  const isWeak = (e: Entry) =>
    e.row.kind === 'transfer' &&
    (e.cpId.startsWith('unknown:') || (e.cpId.startsWith('name:') && ![...ownerIds].some((o) => compatTo(e.cpId, o))));
  const pool = kept.filter((e) => !e.used && e.row.kind === 'transfer');
  const outs2 = pool.filter((e) => e.row.direction === 'out');
  const ins2 = pool.filter((e) => e.row.direction === 'in');
  const candOf = new Map<Entry, Entry[]>();
  const rev = new Map<Entry, Entry[]>();
  for (const e of outs2) {
    for (const m of ins2) {
      if (e.ownerId === m.ownerId) continue;
      if (Math.round(e.row.amount * 100) !== Math.round(m.row.amount * 100)) continue;
      if (!timeOk(e.row, m.row)) continue;
      const weakE = isWeak(e);
      const weakM = isWeak(m);
      if (!weakE && !weakM) continue; // กรณีนี้ถ้าเข้ากันได้ รอบแรกจับคู่ไปแล้ว
      if (!(weakE || compatTo(e.cpId, m.ownerId))) continue;
      if (!(weakM || compatTo(m.cpId, e.ownerId))) continue;
      (candOf.get(e) ?? candOf.set(e, []).get(e)!).push(m);
      (rev.get(m) ?? rev.set(m, []).get(m)!).push(e);
    }
  }
  for (const [e, ms] of candOf) {
    const m = ms[0]!;
    if (e.used || m.used || ms.length !== 1 || (rev.get(m)?.length ?? 0) !== 1) continue;
    e.used = true;
    m.used = true;
    mirrorsMerged++;
    const base = mk(e);
    txns.push({
      ...base,
      to: m.ownerId,
      from: e.ownerId,
      ts: e.row.hasTime || !m.row.hasTime ? e.row.ts : m.row.ts,
      hasTime: e.row.hasTime || m.row.hasTime,
      balanceAfter: undefined,
      description: e.row.description ?? m.row.description,
      channel: e.row.channel ?? m.row.channel,
      reference: e.row.reference ?? m.row.reference,
      location: e.row.location ?? m.row.location,
      extra: mergeExtra(e.row.extra, m.row.extra),
      owners: [e.ownerId, m.ownerId],
      sources: [...base.sources, { fileId: m.fileId, row: m.row.row }],
      mirrored: true,
      inferred: true,
      flags: [...(base.flags ?? []), 'mirror_inferred'],
    });
  }
  for (const e of kept) if (!e.used) txns.push(mk(e));
  txns.sort((a, b) => a.ts - b.ts || a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // ---------- 4) Accounts ----------
  const accounts: Record<string, Account> = {};
  const ensure = (id: string): Account => {
    const have = accounts[id];
    if (have) return have;
    let acc: Account;
    if (id.startsWith('cash:')) {
      const owner = id.slice(5);
      acc = { id, number: '', name: `เงินสด (ATM/สาขา) — ${shortLabel(owner)}`, masked: false, kind: 'cash', hasStatement: false };
    } else if (id.startsWith('unknown:')) {
      const owner = id.slice(8);
      acc = { id, number: '', name: `ไม่ระบุคู่บัญชี — ${shortLabel(owner)}`, masked: false, kind: 'unknown', hasStatement: false };
    } else if (id.startsWith('name:')) {
      acc = { id, number: '', name: nameById.get(id) ?? id.slice(5), masked: true, kind: 'account', hasStatement: false };
    } else {
      const p = parseId(id);
      acc = {
        id, number: p.number, bank: p.bank ?? bankById.get(id), name: nameById.get(id),
        masked: p.number.includes('X'), kind: 'account', hasStatement: false,
      };
    }
    accounts[id] = acc;
    return acc;
  };
  const shortLabel = (ownerId: string): string => {
    const nm = nameById.get(ownerId);
    const p = parseId(ownerId);
    const num = p.number ? formatAccountNumber(p.number) : ownerId;
    return nm ? `${nm} (${num})` : num;
  };
  for (const [id, info] of owners) {
    const a = ensure(id);
    a.hasStatement = true;
    if (info.name) a.name = info.name;
    if (info.bank) a.bank = info.bank;
    if (info.meta) a.meta = info.meta;
  }
  for (const t of txns) {
    ensure(t.from);
    ensure(t.to);
  }

  // ---------- 5) ข้อเสนอรวมบัญชี (ไม่รวมอัตโนมัติ) ----------
  const aliasSuggestions: AliasSuggestion[] = [];
  const real = Object.values(accounts).filter((a) => a.kind === 'account' && !a.id.startsWith('name:'));
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      const a = real[i]!;
      const b = real[j]!;
      if (!a.masked && !b.masked) continue;
      if (!bankCompat(a.bank, b.bank)) continue;
      if (accountsCompatible(a.number, b.number)) {
        aliasSuggestions.push({
          a: a.id, b: b.id,
          reason: `เลขบัญชีเข้ากันได้ (${formatAccountNumber(a.number)} ~ ${formatAccountNumber(b.number)})${a.bank || b.bank ? ` · ${bankDisplay(a.bank ?? b.bank)}` : ''}`,
        });
      }
    }
  }

  return { txns, accounts, duplicatesByFile, mirrorsMerged, ambiguousMirrors, aliasSuggestions };
}
