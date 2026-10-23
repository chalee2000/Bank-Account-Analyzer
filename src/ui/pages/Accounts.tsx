import { useMemo, useState } from 'preact/hooks';
import { analysis, derived, inspector, labelOf, openInspector } from '../../state';
import { bankDisplay, formatAccountNumber } from '../../core/normalize';
import { fmtBaht, fmtDuration, fmtInt, fmtPct } from '../../core/thai';
import { Empty, Pill, VTable, useDebounced, useSorted, type Col } from '../common';

interface Row {
  id: string;
  label: string;
  number: string;
  bank: string;
  hasStatement: boolean;
  totalIn: number;
  totalOut: number;
  net: number;
  flow: number | null;
  inCount: number;
  outCount: number;
  senders: number;
  receivers: number;
  holding: number | null;
  signals: number;
  score: number;
}

export function AccountsPage() {
  const res = analysis.value;
  const d = derived.value;
  const [q, setQ] = useState('');
  const [onlyStmt, setOnlyStmt] = useState(false);
  const [onlySig, setOnlySig] = useState(false);
  const dq = useDebounced(q);

  const rows = useMemo<Row[]>(() => {
    if (!res || !d) return [];
    const sigCount = new Map<string, number>();
    for (const s of res.signals) {
      if (s.type === 'near_threshold' || s.type === 'repeated') continue;
      for (const f of new Set(s.focus)) sigCount.set(f, (sigCount.get(f) ?? 0) + 1);
    }
    const score = new Map(res.priority.map((p) => [p.accountId, p.orderingScore]));
    return Object.values(d.accounts)
      .filter((a) => a.kind === 'account')
      .map((a) => {
        const p = res.profiles[a.id];
        return {
          id: a.id, label: labelOf(a.id, false), number: a.number ? formatAccountNumber(a.number) : '', bank: a.bank ? bankDisplay(a.bank) : '',
          hasStatement: a.hasStatement, totalIn: p?.totalIn ?? 0, totalOut: p?.totalOut ?? 0, net: p?.net ?? 0, flow: p?.flowThrough ?? null,
          inCount: p?.inCount ?? 0, outCount: p?.outCount ?? 0, senders: p?.uniqueSenders ?? 0, receivers: p?.uniqueReceivers ?? 0,
          holding: p?.holding.medianMs ?? null, signals: sigCount.get(a.id) ?? 0, score: score.get(a.id) ?? 0,
        };
      });
  }, [res, d]);

  const filtered = useMemo(() => {
    const t = dq.trim().toLowerCase();
    return rows.filter((r) => (!onlyStmt || r.hasStatement) && (!onlySig || r.signals > 0) && (!t || `${r.label} ${r.number} ${r.bank}`.toLowerCase().includes(t)));
  }, [rows, dq, onlyStmt, onlySig]);

  const cols: Col<Row>[] = [
    { key: 'label', label: 'บัญชี', width: 230, sortable: true, value: (r) => r.label, render: (r) => <span title={r.label}>{r.label}</span> },
    { key: 'number', label: 'เลขที่บัญชี', width: 130, sortable: true, value: (r) => r.number },
    { key: 'bank', label: 'ธนาคาร', width: 110, sortable: true, value: (r) => r.bank },
    { key: 'stmt', label: 'Statement', width: 90, sortable: true, value: (r) => (r.hasStatement ? 1 : 0), render: (r) => (r.hasStatement ? <Pill kind="accent">มี</Pill> : <span class="muted">ไม่มี</span>) },
    { key: 'in', label: 'เงินเข้า', width: 120, num: true, sortable: true, value: (r) => r.totalIn, render: (r) => fmtBaht(r.totalIn) },
    { key: 'out', label: 'เงินออก', width: 120, num: true, sortable: true, value: (r) => r.totalOut, render: (r) => fmtBaht(r.totalOut) },
    { key: 'net', label: 'สุทธิ', width: 120, num: true, sortable: true, value: (r) => r.net, render: (r) => fmtBaht(r.net) },
    { key: 'flow', label: 'Flow-through', width: 105, num: true, sortable: true, value: (r) => r.flow, render: (r) => fmtPct(r.flow, 0) },
    { key: 'hold', label: 'ถือเงินมัธยฐาน', width: 120, num: true, sortable: true, value: (r) => r.holding, render: (r) => fmtDuration(r.holding) },
    { key: 'cnt', label: 'รายการ เข้า/ออก', width: 110, num: true, sortable: true, value: (r) => r.inCount + r.outCount, render: (r) => `${fmtInt(r.inCount)}/${fmtInt(r.outCount)}` },
    { key: 'cp', label: 'ผู้ส่ง/ผู้รับ', width: 90, num: true, sortable: true, value: (r) => r.senders + r.receivers, render: (r) => `${r.senders}/${r.receivers}` },
    { key: 'sig', label: 'สัญญาณ', width: 80, num: true, sortable: true, value: (r) => r.signals },
    { key: 'score', label: 'ลำดับเปิดดู', width: 100, num: true, sortable: true, value: (r) => r.score, render: (r) => (r.score * 100).toFixed(0) },
  ];
  const { sorted, sortKey, sortDir, onSort } = useSorted(filtered, cols, 'score', -1);
  const sel = inspector.value?.kind === 'account' ? inspector.value.id : null;

  if (!res) return <Empty title="ยังไม่มีข้อมูล" icon="accounts">นำเข้า Statement ก่อน แล้วรายชื่อบัญชีและโปรไฟล์จะแสดงที่นี่</Empty>;
  return (
    <div class="stack" style="height:100%">
      <div class="row wrap">
        <input class="input" style="max-width:320px" placeholder="ค้นหาชื่อ / เลขบัญชี / ธนาคาร" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="ค้นหาบัญชี" />
        <label class="row small"><input type="checkbox" checked={onlyStmt} onChange={(e) => setOnlyStmt((e.target as HTMLInputElement).checked)} />เฉพาะที่มี Statement</label>
        <label class="row small"><input type="checkbox" checked={onlySig} onChange={(e) => setOnlySig((e.target as HTMLInputElement).checked)} />เฉพาะที่เกี่ยวข้องกับสัญญาณ</label>
        <span class="grow" />
        <span class="small muted">{fmtInt(sorted.length)} จาก {fmtInt(rows.length)} บัญชี</span>
      </div>
      <div style="flex:1 1 auto;min-height:320px">
        <VTable rows={sorted} cols={cols} getId={(r) => r.id} onRowClick={(r) => openInspector({ kind: 'account', id: r.id })} selectedId={sel} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      </div>
      <div class="disclaimer">“ลำดับเปิดดู” คือค่าสัมพัทธ์ภายในคดีนี้เพื่อจัดลำดับการเปิดดูข้อมูลเท่านั้น ไม่ใช่คะแนนความผิด · Flow-through = เงินออก ÷ เงินเข้า (ตัวชี้วัดการไหลผ่าน ไม่ใช่หลักฐานว่าเป็นบัญชีทางผ่าน)</div>
    </div>
  );
}
