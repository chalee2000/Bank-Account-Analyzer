import { describe, it, expect } from 'vitest';
import { analyze, runTrace, buildFindings, FORBIDDEN_TERMS, LIMITATIONS, CLOSING_STATEMENT } from '../../src/analysis';
import { DEFAULT_SETTINGS } from '../../src/core/types';
import { skillExample, tx, acct, D, resetSeq } from '../helpers/builders';

const run = () => {
  const { accounts, txns } = skillExample();
  return analyze({ txns, accounts, files: [], settings: DEFAULT_SETTINGS });
};

describe('ตัวอย่างสกิล §8: Structuring → Convergence → Layering → Cash-out', () => {
  const { ctx, attr, result } = run();
  const sig = (type: string) => result.signals.filter((s) => s.type === type);

  it('ตรวจพบ Structuring จาก A ไป B1–B3 รวม 285,000', () => {
    const s = sig('structuring');
    expect(s).toHaveLength(1);
    expect(s[0]!.focus[0]).toBe('A');
    expect(s[0]!.metrics).toMatchObject({ count: 3, receivers: 3 });
    expect(s[0]!.totalAmount).toBe(285_000);
    expect(s[0]!.summary).toContain('285,000.00');
  });

  it('ตรวจพบ Convergence ที่ C จาก 3 บัญชี และส่งต่อออก 100%', () => {
    const s = sig('convergence');
    expect(s).toHaveLength(1);
    expect(s[0]!.focus[0]).toBe('C');
    expect(s[0]!.metrics).toMatchObject({ senders: 3, forwardedShare: 100 });
    expect(s[0]!.totalAmount).toBe(285_000);
  });

  it('ตรวจพบ Layering เป็นกลุ่มเดียว สิ้นสุดที่ Cash-out ข้ามหลายธนาคาร', () => {
    const s = sig('layering');
    expect(s).toHaveLength(1);
    expect(s[0]!.metrics.cashExit).toBe('ใช่');
    expect(Number(s[0]!.metrics.hops)).toBeGreaterThanOrEqual(5);
    expect(s[0]!.txnIds).toEqual(expect.arrayContaining(['c-d', 'd-e', 'e-f', 'f-atm']));
    expect(sig('cross_bank')).toHaveLength(1);
  });

  it('ตรวจพบ Cash-out 270,000 ที่ F ซึ่งมาจากเงินโอนเข้าภายในเวลาสั้น', () => {
    const s = sig('cash_out');
    expect(s).toHaveLength(1);
    expect(s[0]!.focus[0]).toBe('F');
    expect(s[0]!.metrics).toMatchObject({ withdrawals: 1, total: 270_000, fundedPct: 100 });
  });

  it('ไม่พบ Circular', () => expect(sig('circular')).toHaveLength(0));

  it('โปรไฟล์ C: เข้า 285,000 ออก 285,000 Flow-through 100% และถือเงินสั้น', () => {
    const c = result.profiles['C']!;
    expect(c.totalIn).toBe(285_000);
    expect(c.totalOut).toBe(285_000);
    expect(c.flowThrough).toBeCloseTo(100, 5);
    expect(c.inCount).toBe(3);
    expect(c.uniqueSenders).toBe(3);
    expect(c.holding.medianMs).toBeLessThanOrEqual(10 * 60_000);
    expect(c.holding.minMs).toBe(8 * 60_000);
    expect(c.holding.shareWithin[15]).toBeCloseTo(1, 5);
    expect(c.holding.shareWithin[5]).toBe(0);
  });

  it('โปรไฟล์ A: ไม่มีเงินเข้า → Flow-through = null', () => {
    const a = result.profiles['A']!;
    expect(a.totalOut).toBe(285_000);
    expect(a.flowThrough).toBeNull();
  });

  it('โปรไฟล์ F: เข้า 275,000 ออก 270,000 (ถอนเงินสด) Flow-through ≈ 98.18%', () => {
    expect(result.profiles['F']!.flowThrough).toBeCloseTo((270 / 275) * 100, 5);
  });

  it('ยอดรวมเงินเข้า-ออกของทุกบัญชีสอดคล้องกัน (ไม่นับซ้ำ)', () => {
    const real = Object.values(result.profiles);
    const inSum = real.reduce((a, p) => a + p.totalIn, 0);
    const outSum = real.reduce((a, p) => a + p.totalOut, 0);
    // เงินสดไม่อยู่ใน profile → เงินออก (รวม ATM) มากกว่าเงินเข้า 270,000
    expect(outSum - inSum).toBe(270_000);
  });

  it('Forward trace จาก A ถึง ATM; เงินตกค้างระหว่างทางถูกแสดงเป็น terminal', () => {
    const tr = runTrace(ctx, attr, { direction: 'forward', accountId: 'A' });
    const ids = tr.edges.map((e) => e.txnId);
    expect(ids).toEqual(expect.arrayContaining(['a-b1', 'a-b2', 'a-b3', 'b1-c', 'c-d', 'd-e', 'e-f', 'f-atm']));
    expect(tr.edges.find((e) => e.txnId === 'f-atm')!.traced).toBeCloseTo(270_000, 2);
    expect(tr.edges.find((e) => e.txnId === 'c-d')!.traced).toBeCloseTo(285_000, 2);
    const cash = tr.terminals.find((t) => t.cash)!;
    expect(cash).toMatchObject({ accountId: 'cash:F', amount: 270_000 });
    // 5,000 ที่ D, E, F ไม่ถูกส่งต่อ
    expect(tr.terminals.filter((t) => !t.cash).map((t) => t.accountId).sort()).toEqual(['D', 'E', 'F']);
    // เส้นทางเรียงตามเวลา ลงท้ายที่ ATM
    expect(tr.paths[0]![tr.paths[0]!.length - 1]).toBe('f-atm');
    expect(tr.paths[0]!.length).toBe(6);
  });

  it('Backward trace จาก ATM กลับถึง A', () => {
    const tr = runTrace(ctx, attr, { direction: 'backward', txnId: 'f-atm' });
    const ids = tr.edges.map((e) => e.txnId);
    expect(ids).toEqual(expect.arrayContaining(['e-f', 'd-e', 'c-d', 'b1-c', 'b2-c', 'b3-c', 'a-b1', 'a-b2', 'a-b3']));
    const origin = tr.terminals.find((t) => t.accountId === 'A')!;
    expect(origin.amount).toBeCloseTo(270_000, 1);
    // ทุกเส้นทางเริ่มที่ A→B และจบที่ ATM
    expect(tr.paths.every((p) => p[p.length - 1] === 'f-atm' && p[0]!.startsWith('a-b'))).toBe(true);
  });

  it('ข้อความที่ระบบสร้างไม่มีคำต้องห้าม และมีคำระมัดระวัง', () => {
    const findings = buildFindings(ctx, result);
    expect(findings.length).toBeGreaterThan(8);
    const text = [...findings.map((f) => f.text), ...LIMITATIONS, CLOSING_STATEMENT].join('\n');
    for (const w of FORBIDDEN_TERMS) expect(text, `พบคำต้องห้าม "${w}"`).not.toContain(w);
    expect(text).toContain('อาจ');
    expect(text).toContain('ควรตรวจ');
    const levels = new Set(findings.map((f) => f.level));
    expect([...levels].sort()).toEqual(['fact', 'hypothesis', 'observation', 'recommendation']);
  });

  it('Network: C เป็นจุดเชื่อมที่มี degree สูง; ทุก node อยู่ใน component เดียว', () => {
    const m = result.metrics;
    expect(new Set(Object.values(m).map((x) => x.component)).size).toBe(1);
    expect(m['C']!.inDegree).toBe(3);
    expect(m['A']!.outDegree).toBe(3);
    expect(m['D']!.isBridge).toBe(true);
    expect(m['D']!.betweenness).toBeGreaterThan(m['A']!.betweenness);
    expect(result.roleHints['C']!.some((h) => h.role === 'convergence')).toBe(true);
    expect(result.roleHints['A']!.some((h) => h.role === 'source')).toBe(true);
    expect(result.roleHints['F']!.some((h) => h.role === 'cash_out')).toBe(true);
  });

  it('Priority: ค่าแยกองค์ประกอบอยู่ในช่วง 0–1', () => {
    for (const r of result.priority) {
      for (const v of Object.values(r.components)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('Circular และกรณีไม่ควรแจ้ง', () => {
  it('ตรวจพบเงินวนกลับ A→B→C→A', () => {
    resetSeq();
    const accounts = { A: acct('A', 'KBANK'), B: acct('B', 'SCB'), C: acct('C', 'BBL') };
    const t = (h: number, m: number) => D(2024, 4, 1, h, m);
    const txns = [
      tx('A', 'B', 100_000, t(10, 0)),
      tx('B', 'C', 99_000, t(10, 20)),
      tx('C', 'A', 98_000, t(11, 0)),
    ];
    const { result } = analyze({ txns, accounts, files: [], settings: DEFAULT_SETTINGS });
    const c = result.signals.filter((s) => s.type === 'circular');
    expect(c).toHaveLength(1);
    expect(c[0]!.metrics.hops).toBe(3);
  });

  it('เงินเข้าแล้วอยู่นานไม่ถูกแจ้งเป็น Rapid Movement', () => {
    resetSeq();
    const accounts = { A: acct('A', 'KBANK'), B: acct('B', 'SCB'), C: acct('C', 'BBL') };
    const txns = [
      tx('A', 'B', 50_000, D(2024, 4, 1, 9, 0)),
      tx('B', 'C', 50_000, D(2024, 4, 3, 9, 0)),
    ];
    const { result } = analyze({ txns, accounts, files: [], settings: DEFAULT_SETTINGS });
    expect(result.signals.filter((s) => s.type === 'rapid_movement')).toHaveLength(0);
    expect(result.profiles['B']!.holding.medianMs).toBe(2 * 86_400_000);
    expect(result.profiles['B']!.holding.shareWithin[60]).toBe(0);
  });

  it('เงินออกที่ไม่มีเงินเข้ารองรับถูกนับเป็นยอดที่จับคู่ไม่ได้ (ยอดยกมา)', () => {
    resetSeq();
    const accounts = { A: acct('A', 'KBANK'), B: acct('B', 'SCB') };
    const txns = [tx('A', 'B', 70_000, D(2024, 4, 1, 9, 0)), tx('A', 'B', 30_000, D(2024, 4, 1, 9, 5))];
    const { result } = analyze({ txns, accounts, files: [], settings: DEFAULT_SETTINGS });
    expect(result.profiles['A']!.holding.unmatchedOut).toBe(100_000);
  });

  it('รายการไม่มีเวลา: ลำดับระดับวัน ไม่แจ้งช่วงเวลาที่ละเอียดเกินจริง', () => {
    resetSeq();
    const accounts = { A: acct('A', 'KBANK'), B: acct('B', 'SCB'), C: acct('C', 'BBL') };
    const d = D(2024, 4, 1);
    const txns = [
      tx('A', 'B', 50_000, d, { hasTime: false }),
      tx('B', 'C', 50_000, d, { hasTime: false }),
    ];
    const { result } = analyze({ txns, accounts, files: [], settings: DEFAULT_SETTINGS });
    const rapid = result.signals.find((s) => s.type === 'rapid_movement');
    expect(rapid?.timeApprox).toBe(true);
  });
});
