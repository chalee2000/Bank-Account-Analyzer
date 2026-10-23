import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  accounts, analysis, cs, derived, engineTrace, go, labelOf, notify, openInspector, patchCase, route, shortLabel, txnById,
} from '../../state';
import type { TraceResult } from '../../core/types';
import { fmtBaht, fmtInt, formatThaiDateTime, formatTime, formatTs } from '../../core/thai';
import { Empty, Field, Notice, Seg, SimpleTable, useElementWidth } from '../common';
import { Icon } from '../icons';
import { newId } from '../../store/model';

export function TracePage() {
  const res = analysis.value;
  const params = route.value.params;
  const [dir, setDir] = useState<'forward' | 'backward'>((params.get('dir') as 'forward' | 'backward') ?? 'forward');
  const [mode, setMode] = useState<'account' | 'txn'>(params.get('txn') ? 'txn' : 'account');
  const [acc, setAcc] = useState(params.get('acc') ?? '');
  const [txn, setTxn] = useState(params.get('txn') ?? '');
  const [minAmt, setMinAmt] = useState(0);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const realAccounts = useMemo(() => Object.values(accounts.value).filter((a) => a.kind !== 'unknown'), [derived.value]);

  // เมื่อมีพารามิเตอร์ใหม่จาก URL
  useEffect(() => {
    const p = route.value.params;
    if (p.get('dir')) setDir(p.get('dir') as 'forward' | 'backward');
    if (p.get('txn')) { setMode('txn'); setTxn(p.get('txn')!); }
    else if (p.get('acc')) { setMode('account'); setAcc(p.get('acc')!); }
  }, [route.value.params.toString()]);

  useEffect(() => {
    if (!res) return;
    const seedOk = mode === 'account' ? !!acc : !!txn;
    if (!seedOk) { setResult(null); return; }
    let cancelled = false;
    setBusy(true);
    setErr(null);
    engineTrace({ direction: dir, accountId: mode === 'account' ? acc : undefined, txnId: mode === 'txn' ? txn : undefined })
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => !cancelled && setBusy(false));
    return () => { cancelled = true; };
  }, [res, dir, mode, acc, txn]);

  if (!res) return <Empty title="ยังไม่มีข้อมูล" icon="trace">นำเข้า Statement ก่อน</Empty>;

  const edges = (result?.edges ?? []).filter((e) => e.traced >= minAmt);
  const seedTotal = edges.length ? Math.max(...edges.map((e) => e.traced)) : 0;
  const cashTotal = (result?.terminals ?? []).filter((t) => t.cash).reduce((a, t) => a + t.amount, 0);

  const pin = async () => {
    const st = cs.value!;
    const label = `${dir === 'forward' ? 'ไล่เงินออก' : 'ย้อนที่มา'}: ${mode === 'account' ? shortLabel(acc) : txn}`;
    await patchCase({ pinnedTraces: [...st.pinnedTraces, { id: newId('tr_'), label, direction: dir, seed: mode === 'account' ? { accountId: acc } : { txnId: txn } }] });
    notify('ปักหมุดเส้นทางนี้ไว้ในรายงานแล้ว');
  };

  return (
    <div class="stack" style="max-width:1200px">
      <div class="card pad stack">
        <div class="row wrap">
          <Seg value={dir} onChange={setDir} options={[{ value: 'forward', label: 'ไล่เงินออก (Forward)' }, { value: 'backward', label: 'ย้อนที่มา (Backward)' }]} />
          <Seg value={mode} onChange={setMode} options={[{ value: 'account', label: 'เริ่มจากบัญชี' }, { value: 'txn', label: 'เริ่มจากรายการ' }]} />
        </div>
        {mode === 'account' ? (
          <Field label={dir === 'forward' ? 'บัญชีต้นทาง — เงินที่โอนออกจากบัญชีนี้ไหลไปที่ใดบ้าง' : 'บัญชีปลายทาง — เงินที่เข้าบัญชีนี้มาจากที่ใด (เลือก “เงินสด” เพื่อย้อนจากจุดถอน)'}>
            <select class="select" value={acc} onChange={(e) => setAcc((e.target as HTMLSelectElement).value)}>
              <option value="">— เลือกบัญชี —</option>
              {realAccounts.map((a) => <option value={a.id}>{labelOf(a.id)}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="รหัสรายการ (เลือกจากหน้าธุรกรรมหรือหน้ารูปแบบ แล้วกด “ไล่เงินต่อ/ย้อนที่มา”)">
            <input class="input mono" value={txn} onInput={(e) => setTxn((e.target as HTMLInputElement).value.trim())} placeholder="เช่น f_ab12cd34ef:12" />
          </Field>
        )}
        <div class="row wrap">
          <label class="row small">แสดงเฉพาะรายการที่ไล่ได้ ≥
            <input class="input sm" style="width:120px" type="number" min={0} step={1000} value={minAmt} onInput={(e) => setMinAmt(Number((e.target as HTMLInputElement).value) || 0)} /> บาท
          </label>
          <span class="grow" />
          <button class="btn sm" disabled={!result || !edges.length} onClick={pin}><Icon name="pin" size={15} />ปักหมุดใส่รายงาน</button>
        </div>
      </div>

      <Notice kind="info">
        เส้นทางที่แสดงเป็น <b>สมมติฐานจากเวลาและยอดเงิน</b> (จับคู่เงินเข้า–ออกแบบเข้าก่อนออกก่อน ภายใน {cs.value!.settings.traceMaxGapHours} ชม.) —
        เงินเป็นสิ่งที่ทดแทนกันได้ จึงยังไม่ยืนยันว่าเป็นเงินก้อนเดียวกัน ควรยืนยันด้วยหลักฐานอื่น เช่น KYC อุปกรณ์ CDR และ CCTV
      </Notice>

      {busy && <div class="row secondary"><span class="spinner" /> กำลังไล่เส้นทาง…</div>}
      {err && <Notice kind="crit">{err}</Notice>}

      {result && !edges.length && !busy && (
        <div class="card"><Empty title="ไม่พบเส้นทางที่ไล่ต่อได้" icon="trace">
          {dir === 'forward' ? 'บัญชีนี้ไม่มีเงินออก หรือเงินที่ออกไม่ถูกส่งต่อภายในช่วงเวลาที่กำหนด' : 'ไม่พบเงินเข้าที่รองรับรายการนี้ในข้อมูลที่มี (อาจเป็นยอดยกมาหรือยังไม่มี Statement ของบัญชีต้นทาง)'}
        </Empty></div>
      )}

      {result && edges.length > 0 && (
        <>
          <div class="grid cols-4 keep2">
            <div class="card kpi"><div class="label">รายการที่ไล่ได้</div><div class="value">{fmtInt(edges.length)}</div><div class="sub">{fmtInt(new Set(edges.flatMap((e) => [e.from, e.to])).size)} บัญชี</div></div>
            <div class="card kpi"><div class="label">จำนวนทอดสูงสุด</div><div class="value">{Math.max(...edges.map((e) => e.depth)) + 1}</div></div>
            <div class="card kpi"><div class="label">ปลายทางเป็นเงินสด</div><div class="value">{fmtBaht(cashTotal)}</div><div class="sub">บาท (ถอน/ฝากเงินสด)</div></div>
            <div class="card kpi"><div class="label">ช่วงเวลา</div><div class="value" style="font-size:16px">{formatTs(edges[0]!.ts, true)}</div><div class="sub">ถึง {formatTs(edges[edges.length - 1]!.ts, true)}</div></div>
          </div>
          {result.truncated && <Notice kind="warn">เส้นทางมีจำนวนมากจึงแสดงเพียงบางส่วน — ตั้งยอดขั้นต่ำเพื่อลดจำนวน</Notice>}

          <div class="card">
            <div class="card-head"><h2>แผนภาพการเคลื่อนที่ของเงิน</h2><span class="small muted">เรียงจากบนลงล่างตามเวลา · เส้นหนาตามยอดที่ไล่ได้</span></div>
            <div class="card-body"><SequenceDiagram edges={edges} max={seedTotal} /></div>
          </div>

          <div class="grid cols-2">
            <div class="card">
              <div class="card-head"><h2>{dir === 'forward' ? 'ปลายทางของเงิน' : 'ต้นทางของเงิน (ที่ไล่ถึง)'}</h2></div>
              <div class="card-body" style="padding-top:8px">
                <SimpleTable
                  rows={result.terminals}
                  cols={[
                    { label: 'บัญชี', render: (t) => <span>{labelOf(t.accountId)}{t.cash && ' 💵'}</span> },
                    { label: 'ยอด', num: true, render: (t) => fmtBaht(t.amount) },
                  ]}
                  onRowClick={(t) => openInspector({ kind: 'account', id: t.accountId })}
                />
                <div class="tiny muted" style="margin-top:6px">
                  {dir === 'forward'
                    ? 'ยอดที่ไม่พบการส่งต่อในข้อมูล อาจยังอยู่ในบัญชีนั้น หรือถูกใช้ต่อที่ไม่มี Statement'
                    : 'ยอดที่ไล่ย้อนไม่ได้ต่อ อาจเป็นยอดยกมา เงินสดที่ฝาก หรือบัญชีต้นทางที่ยังไม่มี Statement'}
                </div>
              </div>
            </div>
            <div class="card">
              <div class="card-head"><h2>เส้นทางที่ยาวที่สุด</h2></div>
              <div class="card-body stack tight">
                {result.paths.slice(0, 6).map((p, i) => (
                  <div key={i} class="small">
                    <div class="muted tiny">เส้นทาง {i + 1} · {p.length} ทอด</div>
                    <div>{pathLabel(p)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h2>รายการทั้งหมดในเส้นทาง</h2></div>
            <div class="card-body" style="padding-top:8px">
              <SimpleTable
                maxHeight={420}
                rows={edges}
                getId={(e) => e.txnId}
                onRowClick={(e) => openInspector({ kind: 'txn', id: e.txnId })}
                cols={[
                  { label: 'ทอด', num: true, render: (e) => e.depth + 1 },
                  { label: 'วันเวลา', render: (e) => formatThaiDateTime(txnById.value.get(e.txnId)?.hasTime === false ? e.ts : e.ts, txnById.value.get(e.txnId)?.hasTime ?? true).replace(' เวลา', '') },
                  { label: 'จาก', render: (e) => labelOf(e.from, false) },
                  { label: 'ไป', render: (e) => labelOf(e.to, false) },
                  { label: 'ยอดรายการ', num: true, render: (e) => fmtBaht(e.amount) },
                  { label: 'ยอดที่ไล่ได้', num: true, render: (e) => fmtBaht(e.traced) },
                ]}
              />
            </div>
          </div>
        </>
      )}
      <button class="btn sm" style="align-self:flex-start" onClick={() => go('/network')}><Icon name="network" size={15} />ไปที่ผังเครือข่าย</button>
    </div>
  );
}

function pathLabel(p: string[]): string {
  const t = p.map((id) => txnById.value.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof txnById.value.get>>[];
  if (!t.length) return '';
  const accs = [t[0]!.from, ...t.map((x) => x.to)];
  return accs.map((a) => shortLabel(a)).join(' → ');
}

function SequenceDiagram({ edges, max }: { edges: TraceResult['edges']; max: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const LIMIT = 150;
  const shown = edges.slice(0, LIMIT);
  // คอลัมน์ = บัญชีตามลำดับที่ปรากฏครั้งแรก
  const cols: string[] = [];
  for (const e of shown) for (const a of [e.from, e.to]) if (!cols.includes(a)) cols.push(a);
  const colW = Math.max(120, Math.min(190, (width - 20) / Math.max(1, cols.length)));
  const W = Math.max(width, cols.length * colW + 20);
  const rowH = 38;
  const top = 64;
  const H = top + shown.length * rowH + 20;
  const x = (a: string) => 10 + cols.indexOf(a) * colW + colW / 2;
  return (
    <div class="chart" ref={ref} style="overflow:auto">
      <svg class="trace-svg" style={{ width: `${W}px`, maxWidth: 'none' }} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="แผนภาพลำดับการโอนเงินตามเวลา">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--s1)" /></marker>
          <marker id="arrow-cash" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--s2)" /></marker>
        </defs>
        {cols.map((a) => (
          <g key={a} class="trace-node" onClick={() => accounts.value[a]?.kind === 'account' && openInspector({ kind: 'account', id: a })}>
            <rect x={x(a) - colW / 2 + 6} y={6} width={colW - 12} height={40} rx="8" fill="var(--surface-2)" stroke="var(--border-strong)" />
            <text x={x(a)} y={22} text-anchor="middle" style="fill:var(--text-1);font-weight:600">{clip(shortLabel(a), Math.floor(colW / 7.5))}</text>
            <text x={x(a)} y={38} text-anchor="middle" style="font-size:10px">{accounts.value[a]?.bank ?? (accounts.value[a]?.kind === 'cash' ? 'เงินสด' : '')}</text>
            <line x1={x(a)} x2={x(a)} y1={46} y2={H - 10} stroke="var(--border)" stroke-dasharray="3 4" />
          </g>
        ))}
        {shown.map((e, i) => {
          const y = top + i * rowH + rowH / 2;
          const x1 = x(e.from);
          const x2 = x(e.to);
          const w = 1.5 + 4 * (max > 0 ? e.traced / max : 0);
          const cash = accounts.value[e.to]?.kind === 'cash' || accounts.value[e.from]?.kind === 'cash';
          const mid = (x1 + x2) / 2;
          const t = txnById.value.get(e.txnId);
          return (
            <g key={e.txnId} style="cursor:pointer" onClick={() => openInspector({ kind: 'txn', id: e.txnId })}>
              <title>{`${labelOf(e.from)} → ${labelOf(e.to)}\n${fmtBaht(e.amount)} บาท (ไล่ได้ ${fmtBaht(e.traced)})\n${formatTs(e.ts, t?.hasTime ?? true, true)}`}</title>
              <rect x={Math.min(x1, x2) - 4} y={y - rowH / 2 + 2} width={Math.abs(x2 - x1) + 8} height={rowH - 4} fill="transparent" />
              <line x1={x1} x2={x2 + (x2 > x1 ? -3 : 3)} y1={y} y2={y} stroke={cash ? 'var(--s2)' : 'var(--s1)'} stroke-width={w} marker-end={cash ? 'url(#arrow-cash)' : 'url(#arrow)'} />
              <text x={mid} y={y - 6} text-anchor="middle" style="fill:var(--text-1)">{fmtBaht(e.traced)}</text>
              <text x={10} y={y + 4} style="font-size:10px">{t?.hasTime === false ? formatTs(e.ts, false) : `${formatTs(e.ts, false).slice(0, 5)} ${formatTime(e.ts)}`}</text>
            </g>
          );
        })}
      </svg>
      {edges.length > LIMIT && <div class="tiny muted">แสดง {LIMIT} จาก {edges.length} รายการแรกตามเวลา — ตั้งยอดขั้นต่ำเพื่อดูเฉพาะรายการสำคัญ</div>}
    </div>
  );
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(3, n - 1)) + '…' : s);
