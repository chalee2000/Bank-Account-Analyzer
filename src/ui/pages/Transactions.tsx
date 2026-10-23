import { useMemo, useState } from 'preact/hooks';
import { analysis, derived, go, inspector, labelOf, notify, openInspector, route } from '../../state';
import { fmtBaht, fmtInt, formatTs, isoDate, parseAmount } from '../../core/thai';
import type { Txn, TxnKind } from '../../core/types';
import { Empty, Pill, VTable, useDebounced, useSorted, type Col } from '../common';
import { Icon } from '../icons';
import { KIND_LABEL } from '../labels';

export function TransactionsPage() {
  const d = derived.value;
  const res = analysis.value;
  const params = route.value.params;
  const [q, setQ] = useState(params.get('q') ?? '');
  const [kind, setKind] = useState<'' | TxnKind>('');
  const [acc, setAcc] = useState(params.get('acc') ?? '');
  const [minAmt, setMinAmt] = useState('');
  const [maxAmt, setMaxAmt] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [flagged, setFlagged] = useState(false);
  const sigId = params.get('sig');
  const toAcc = params.get('to');
  const dq = useDebounced(q, 250);

  const sigIds = useMemo(() => {
    if (!sigId || !res) return null;
    const s = res.signals.find((x) => x.id === sigId);
    return s ? new Set(s.txnIds) : null;
  }, [sigId, res]);

  const accounts = useMemo(() => Object.values(d?.accounts ?? {}).filter((a) => a.kind === 'account'), [d]);

  const rows = useMemo(() => {
    if (!d) return [];
    const t = dq.trim().toLowerCase();
    const min = minAmt ? parseAmount(minAmt)?.value : undefined;
    const max = maxAmt ? parseAmount(maxAmt)?.value : undefined;
    const f = from ? Date.parse(from + 'T00:00:00Z') : undefined;
    const tt = to ? Date.parse(to + 'T23:59:59Z') : undefined;
    return d.txns.filter((x) => {
      if (kind && x.kind !== kind) return false;
      if (acc && x.from !== acc && x.to !== acc) return false;
      if (toAcc && acc && !(x.from === acc && x.to === toAcc)) return false;
      if (min !== undefined && x.amount < min) return false;
      if (max !== undefined && x.amount > max) return false;
      if (f !== undefined && x.ts < f) return false;
      if (tt !== undefined && x.ts > tt) return false;
      if (sigIds && !sigIds.has(x.id)) return false;
      if (flagged && !(x.flags?.length || x.inferred)) return false;
      if (t) {
        const hay = `${labelOf(x.from)} ${labelOf(x.to)} ${x.description ?? ''} ${x.reference ?? ''} ${x.channel ?? ''} ${x.location ?? ''} ${x.extra ? Object.values(x.extra).join(' ') : ''}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [d, dq, kind, acc, minAmt, maxAmt, from, to, flagged, sigIds, toAcc]);

  const cols: Col<Txn>[] = [
    { key: 'ts', label: 'วันเวลา', width: 150, sortable: true, value: (r) => r.ts, render: (r) => formatTs(r.ts, r.hasTime) + (r.hasTime ? '' : ' ·ไม่มีเวลา') },
    { key: 'from', label: 'จาก', width: 220, sortable: true, value: (r) => labelOf(r.from, false), render: (r) => labelOf(r.from, false) },
    { key: 'to', label: 'ไป', width: 220, sortable: true, value: (r) => labelOf(r.to, false), render: (r) => labelOf(r.to, false) },
    { key: 'amount', label: 'จำนวนเงิน', width: 120, num: true, sortable: true, value: (r) => r.amount, render: (r) => fmtBaht(r.amount) },
    { key: 'kind', label: 'ชนิด', width: 100, sortable: true, value: (r) => KIND_LABEL[r.kind], render: (r) => KIND_LABEL[r.kind] },
    { key: 'channel', label: 'ช่องทาง', width: 110, sortable: true, value: (r) => r.channel ?? '' },
    { key: 'ip', label: 'IP', width: 130, sortable: true, value: (r) => r.extra?.ip ?? '' },
    { key: 'desc', label: 'รายละเอียด', width: 320, value: (r) => r.description ?? '', title: (r) => r.description },
    {
      key: 'flags', label: 'หมายเหตุ', width: 150,
      render: (r) => (
        <span class="row" style="gap:4px">
          {r.mirrored && <Pill kind="accent">2 ฝั่ง</Pill>}
          {r.inferred && <Pill kind="warn">อนุมาน</Pill>}
          {r.flags?.includes('balance_mismatch') && <Pill kind="warn">ยอดไม่ต่อเนื่อง</Pill>}
          {r.flags?.includes('low_ocr_confidence') && <Pill kind="warn">OCR</Pill>}
          {r.flags?.includes('reversal') && <Pill kind="warn">กลับรายการ</Pill>}
        </span>
      ),
    },
  ];
  const { sorted, sortKey, sortDir, onSort } = useSorted(rows, cols, 'ts', 1);
  const sel = inspector.value?.kind === 'txn' ? inspector.value.id : null;

  const copy = async () => {
    const lines = [['วันเวลา', 'จาก', 'ไป', 'จำนวนเงิน', 'ชนิด', 'ช่องทาง', 'IP', 'รายละเอียด'].join('\t')];
    for (const r of sorted.slice(0, 50_000)) {
      lines.push([formatTs(r.ts, r.hasTime, true), labelOf(r.from), labelOf(r.to), r.amount.toFixed(2), KIND_LABEL[r.kind], r.channel ?? '', r.extra?.ip ?? '', (r.description ?? '').replace(/\s+/g, ' ')].join('\t'));
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      notify(`คัดลอก ${fmtInt(lines.length - 1)} รายการ (แท็บคั่น) แล้ว — วางใน Excel ได้ทันที`);
    } catch {
      notify('คัดลอกไม่สำเร็จ (เบราว์เซอร์ไม่อนุญาต)', 'err');
    }
  };

  if (!d || !d.txns.length) return <div class="page"><Empty title="ยังไม่มีธุรกรรม" icon="list">นำเข้า Statement ก่อน</Empty></div>;
  return (
    <>
      <div class="row wrap" style="padding:12px 20px;border-bottom:1px solid var(--border);background:var(--surface-1)">
        <input class="input" style="width:230px" placeholder="ค้นหา (ชื่อ เลขบัญชี IP รายละเอียด)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="ค้นหาธุรกรรม" />
        <select class="select" style="width:210px" value={acc} onChange={(e) => setAcc((e.target as HTMLSelectElement).value)} aria-label="กรองบัญชี">
          <option value="">ทุกบัญชี</option>
          {accounts.map((a) => <option value={a.id}>{labelOf(a.id)}</option>)}
        </select>
        <select class="select" style="width:130px" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as TxnKind | '')} aria-label="กรองชนิด">
          <option value="">ทุกชนิด</option>
          {(Object.keys(KIND_LABEL) as TxnKind[]).map((k) => <option value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <input class="input" style="width:120px" placeholder="ยอดตั้งแต่" inputMode="decimal" value={minAmt} onInput={(e) => setMinAmt((e.target as HTMLInputElement).value)} />
        <input class="input" style="width:120px" placeholder="ถึง" inputMode="decimal" value={maxAmt} onInput={(e) => setMaxAmt((e.target as HTMLInputElement).value)} />
        <input class="input" style="width:150px" type="date" value={from} onChange={(e) => setFrom((e.target as HTMLInputElement).value)} aria-label="ตั้งแต่วันที่" />
        <input class="input" style="width:150px" type="date" value={to} onChange={(e) => setTo((e.target as HTMLInputElement).value)} aria-label="ถึงวันที่" />
        <label class="row small"><input type="checkbox" checked={flagged} onChange={(e) => setFlagged((e.target as HTMLInputElement).checked)} />เฉพาะที่มีหมายเหตุ</label>
        {(sigId || toAcc) && <Pill kind="accent">กรองจาก{sigId ? 'สัญญาณ' : 'คู่บัญชี'} <button aria-label="ล้างตัวกรอง" onClick={() => go('/transactions')}>✕</button></Pill>}
        <span class="grow" />
        <span class="small muted">{fmtInt(sorted.length)} จาก {fmtInt(d.txns.length)} รายการ · {fmtBaht(sorted.reduce((a, t) => a + t.amount, 0))} บาท</span>
        <button class="btn sm" onClick={copy}><Icon name="copy" size={15} />คัดลอก</button>
      </div>
      <div style="flex:1 1 auto;min-height:0;padding:12px 20px 16px;display:flex;flex-direction:column">
        <VTable rows={sorted} cols={cols} getId={(r) => r.id} onRowClick={(r) => openInspector({ kind: 'txn', id: r.id })} selectedId={sel} sortKey={sortKey} sortDir={sortDir} onSort={onSort} empty="ไม่พบรายการที่ตรงกับตัวกรอง" />
      </div>
    </>
  );
}
void isoDate;
