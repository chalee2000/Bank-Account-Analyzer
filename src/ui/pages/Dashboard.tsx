import { useMemo, useState } from 'preact/hooks';
import { analysis, cs, derived, go, labelOf, openInspector } from '../../state';
import { fmtBaht, fmtInt, fmtPct, formatThaiDate } from '../../core/thai';
import { SIGNAL_LABEL } from '../../analysis';
import { bucketLabels, bucketize, heatmapData } from '../chartData';
import { BarList, ComponentBars, Columns, Heatmap, Legend, LineChart } from '../charts';
import { Empty, Kpi, Notice, Prominence, SimpleTable } from '../common';
import { Icon } from '../icons';

export function DashboardPage() {
  const st = cs.value!;
  const d = derived.value;
  const res = analysis.value;
  const [acc, setAcc] = useState('');
  const txns = d?.txns ?? [];

  const real = useMemo(() => Object.values(d?.accounts ?? {}).filter((a) => a.kind === 'account'), [d]);

  const series = useMemo(() => {
    if (!txns.length || !res?.quality.firstTs || !res.quality.lastTs) return null;
    const { firstTs, lastTs } = res.quality;
    const filtered = txns.filter((t) => t.kind !== 'fee' && t.kind !== 'interest');
    if (acc) {
      const b = bucketize(filtered, (t) => (t.to === acc ? 'in' : t.from === acc ? 'out' : null), firstTs, lastTs);
      return {
        b,
        series: [
          { name: 'เงินเข้า', color: 'var(--s1)', values: b.values.get('in') ?? new Array(b.xs.length).fill(0) },
          { name: 'เงินออก', color: 'var(--s2)', values: b.values.get('out') ?? new Array(b.xs.length).fill(0) },
        ],
      };
    }
    const b = bucketize(filtered, (t) => (t.kind === 'cash_withdrawal' || t.kind === 'cash_deposit' ? 'cash' : 'xfer'), firstTs, lastTs);
    return {
      b,
      series: [
        { name: 'โอน/ชำระระหว่างบัญชี', color: 'var(--s1)', values: b.values.get('xfer') ?? new Array(b.xs.length).fill(0) },
        { name: 'ฝาก/ถอนเงินสด', color: 'var(--s2)', values: b.values.get('cash') ?? new Array(b.xs.length).fill(0) },
      ],
    };
  }, [txns, res, acc]);

  const heat = useMemo(() => heatmapData(acc ? txns.filter((t) => t.from === acc || t.to === acc) : txns), [txns, acc]);

  if (!st.files.length) {
    return (
      <div class="card"><Empty title="ยังไม่มีข้อมูลในคดีนี้" icon="upload" action={<button class="btn primary" onClick={() => go('/import')}><Icon name="upload" />นำเข้า Statement</button>}>
        นำเข้าไฟล์ Statement ของแต่ละบัญชี (CSV, Excel, PDF หรือรูปภาพสแกน) แล้วระบบจะวิเคราะห์ความเชื่อมโยงให้โดยอัตโนมัติ
      </Empty></div>
    );
  }
  if (!res || !d) return <div class="card pad"><span class="spinner" /> กำลังวิเคราะห์…</div>;

  const q = res.quality;
  // สัญญาณเด่น: ไม่เกิน 2 รายการต่อชนิด เพื่อให้เห็นรูปแบบที่หลากหลาย
  const topSignals = (() => {
    const per = new Map<string, number>();
    const out: typeof res.signals = [];
    for (const s of res.signals) {
      if (s.prominence < 2) continue;
      const c = per.get(s.type) ?? 0;
      if (c >= 2) continue;
      per.set(s.type, c + 1);
      out.push(s);
      if (out.length >= 6) break;
    }
    return out;
  })();
  const topPairs = res.pairs.filter((p) => d.accounts[p.from]?.kind === 'account' && d.accounts[p.to]?.kind === 'account').slice(0, 8);
  const totalAmount = txns.filter((t) => t.kind !== 'fee' && t.kind !== 'interest').reduce((a, t) => a + t.amount, 0);
  const prio = res.priority.slice(0, 8);
  const holdingBuckets = (() => {
    const bins = [5, 15, 30, 60, 240, 1440, Infinity];
    const labels = ['≤5 นาที', '≤15', '≤30', '≤60', '≤4 ชม.', '≤1 วัน', '>1 วัน'];
    const vals = new Array(bins.length).fill(0);
    for (const l of res.links) {
      if (l.inTxn === null) continue;
      const mins = l.holdingMs / 60000;
      const i = bins.findIndex((b) => mins <= b);
      vals[i] += l.amount;
    }
    return { labels, vals };
  })();

  return (
    <div class="stack">
      <div class="grid cols-4 keep2">
        <Kpi icon="accounts" tone="violet" label="บัญชีที่เกี่ยวข้อง" value={fmtInt(real.length)} sub={`มี Statement ${real.filter((a) => a.hasStatement).length} บัญชี`} />
        <Kpi icon="list" tone="blue" label="ธุรกรรม" value={fmtInt(txns.length)} sub={q.mirrorsMerged ? `รวมรายการสองฝั่ง ${fmtInt(q.mirrorsMerged)} รายการ` : undefined} />
        <Kpi icon="timeline" tone="teal" label="ช่วงเวลาข้อมูล" value={q.firstTs ? formatThaiDate(q.firstTs) : '–'} sub={q.lastTs ? `ถึง ${formatThaiDate(q.lastTs)}` : undefined} />
        <Kpi icon="trace" tone="pink" label="มูลค่าธุรกรรมรวม" value={fmtBaht(totalAmount)} sub="บาท (ไม่นับค่าธรรมเนียม/ดอกเบี้ย)" />
      </div>

      {(q.balanceMismatch > 0 || q.skipped > 0 || q.noCounterparty > 0 || q.noTime > 0 || q.duplicatesRemoved > 0) && (
        <Notice kind="warn">
          <b>คุณภาพข้อมูลที่ควรตรวจก่อนสรุปผล:</b>{' '}
          {[
            q.duplicatesRemoved && `ตัดรายการซ้ำข้ามไฟล์ ${fmtInt(q.duplicatesRemoved)}`,
            q.skipped && `แถวที่อ่านไม่ได้/ถูกข้าม ${fmtInt(q.skipped)}`,
            q.balanceMismatch && `ยอดคงเหลือไม่ต่อเนื่อง ${fmtInt(q.balanceMismatch)}`,
            q.noCounterparty && `ไม่ระบุคู่บัญชี ${fmtInt(q.noCounterparty)}`,
            q.noTime && `ไม่มีเวลา ${fmtInt(q.noTime)}`,
          ].filter(Boolean).join(' · ')}
          {' '}<a href="#/import">ดูรายละเอียดต่อไฟล์</a>
        </Notice>
      )}

      <div class="grid split">
        <div class="card">
          <div class="card-head">
            <h2>การไหลของเงินตามช่วงเวลา</h2>
            <select class="select sm" style="width:auto;max-width:240px" value={acc} onChange={(e) => setAcc((e.target as HTMLSelectElement).value)} aria-label="เลือกบัญชี">
              <option value="">ทุกบัญชี</option>
              {real.map((a) => <option key={a.id} value={a.id}>{labelOf(a.id)}</option>)}
            </select>
          </div>
          <div class="card-body stack tight">
            {series && <LineChart xs={series.b.xs} series={series.series} area {...bucketLabels(series.b.bucket)} />}
            {series && <Legend items={series.series.map((s) => ({ color: s.color, label: s.name }))} />}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>เวลาที่เกิดธุรกรรม</h2><span class="small muted">ยอดเงินรวม วัน × ชั่วโมง</span></div>
          <div class="card-body">
            {heat.used > 0 ? <Heatmap grid={heat.grid} counts={heat.counts} unit="ยอดเงินรวม (บาท)" /> : <div class="muted">ไม่มีข้อมูลเวลาของรายการ</div>}
          </div>
        </div>
      </div>

      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h2>สัญญาณเด่นที่ควรตรวจสอบ</h2><a class="small" href="#/patterns">ดูทั้งหมด ({fmtInt(res.signals.length)})</a></div>
          <div class="card-body" style="padding:0">
            {topSignals.length === 0 && <div class="muted" style="padding:16px">ไม่พบสัญญาณที่เกินเกณฑ์ตามค่าตั้งต้นปัจจุบัน</div>}
            {topSignals.map((s) => (
              <div key={s.id} class="signal-card" onClick={() => openInspector({ kind: 'signal', id: s.id })}>
                <Prominence n={s.prominence} />
                <div>
                  <b class="small">{SIGNAL_LABEL[s.type]}</b>
                  <div class="small secondary" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">{s.summary}</div>
                </div>
                <div class="num small">{fmtBaht(s.totalAmount)}</div>
              </div>
            ))}
            <div class="disclaimer" style="margin:10px 14px">สัญญาณเป็นรูปแบบที่ควรตรวจสอบต่อ ไม่ใช่ข้อพิสูจน์ความผิด</div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>คู่บัญชีที่มียอดโอนสูงสุด</h2></div>
          <div class="card-body">
            <BarList
              data={topPairs.map((p) => ({ id: p.from + p.to, label: `${labelOf(p.from, false)} → ${labelOf(p.to, false)}`, value: p.total, sub: `×${p.count}` }))}
              onClick={(b) => { const p = topPairs.find((x) => x.from + x.to === b.id); if (p) go('/transactions', { acc: p.from, to: p.to }); }}
            />
          </div>
        </div>
      </div>

      <div class="grid split">
        <div class="card">
          <div class="card-head"><h2>บัญชีที่ควรเปิดดูก่อน</h2><span class="small muted">องค์ประกอบ 7 ด้าน (ไม่ใช่คะแนนความผิด)</span></div>
          <div class="card-body" style="padding:8px 0 0">
            <SimpleTable
              rows={prio}
              getId={(r) => r.accountId}
              onRowClick={(r) => openInspector({ kind: 'account', id: r.accountId })}
              cols={[
                { label: 'บัญชี', render: (r) => labelOf(r.accountId) },
                { label: 'องค์ประกอบ', render: (r) => <ComponentBars comps={r.components as unknown as Record<string, number>} /> },
                { label: 'Flow-through', num: true, render: (r) => fmtPct(res.profiles[r.accountId]?.flowThrough ?? null, 0) },
                { label: 'เงินเข้า', num: true, render: (r) => fmtBaht(res.profiles[r.accountId]?.totalIn ?? 0) },
              ]}
            />
            <div class="disclaimer" style="margin:10px 14px">คำนวณจากค่าสัมพัทธ์ภายในคดีนี้เท่านั้น ใช้ช่วยจัดลำดับการเปิดดูข้อมูล</div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>ระยะเวลาถือเงินก่อนส่งต่อ</h2></div>
          <div class="card-body stack tight">
            <Columns labels={holdingBuckets.labels} values={holdingBuckets.vals} format={(v) => fmtBaht(v) + ' บาท'} />
            <div class="tiny muted">ยอดเงินที่ออกจากบัญชีแยกตามระยะเวลาหลังรับเข้า (จับคู่แบบ FIFO — เป็นสมมติฐาน)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
