import { useMemo, useState } from 'preact/hooks';
import { analysis, cs, inspector, openInspector, patchCase } from '../../state';
import { fmtBaht, fmtInt, formatThaiDateTime } from '../../core/thai';
import type { SignalType } from '../../core/types';
import { SIGNAL_LABEL } from '../../analysis';
import { Empty, Notice, Pill, Prominence } from '../common';
import { Icon } from '../icons';
import { labelOf } from '../../state';
import { DEFAULT_SETTINGS } from '../../core/types';

const ORDER: SignalType[] = ['structuring', 'convergence', 'layering', 'cash_out', 'rapid_movement', 'circular', 'cross_bank', 'repeated', 'near_threshold'];

export function PatternsPage() {
  const res = analysis.value;
  const st = cs.value!;
  const [type, setType] = useState<'all' | SignalType>('all');
  const [minProm, setMinProm] = useState<1 | 2 | 3>(1);
  const sel = inspector.value?.kind === 'signal' ? inspector.value.id : null;

  const counts = useMemo(() => {
    const m = new Map<SignalType, number>();
    for (const s of res?.signals ?? []) m.set(s.type, (m.get(s.type) ?? 0) + 1);
    return m;
  }, [res]);
  const list = useMemo(() => (res?.signals ?? []).filter((s) => (type === 'all' || s.type === type) && s.prominence >= minProm), [res, type, minProm]);

  if (!res) return <Empty title="ยังไม่มีข้อมูล" icon="alert">นำเข้า Statement ก่อน</Empty>;
  const shown = list.slice(0, 300);
  return (
    <div class="stack" style="max-width:1100px">
      <Notice kind="info">
        สัญญาณคือ <b>รูปแบบที่ควรตรวจสอบต่อ</b> ไม่ใช่ข้อพิสูจน์ความผิด ทุกรูปแบบมีคำอธิบายที่ไม่เกี่ยวข้องกับการกระทำผิดได้ (เช่น ธุรกิจปกติ ตัวแทนรับชำระ เงินเดือน การชำระหนี้)
        จุดแสดง “ความเด่น” ว่าเกินเกณฑ์มากเพียงใด ไม่ใช่ระดับความผิด
      </Notice>
      <div class="row wrap">
        <div class="chip-row row wrap">
          <button class={'chip' + (type === 'all' ? ' accent' : '')} onClick={() => setType('all')}>ทั้งหมด {fmtInt(res.signals.length)}</button>
          {ORDER.filter((t) => counts.get(t)).map((t) => (
            <button key={t} class={'chip' + (type === t ? ' accent' : '')} onClick={() => setType(t)}>{SIGNAL_LABEL[t].replace(/ \(.*\)/, '')} {counts.get(t)}</button>
          ))}
        </div>
        <span class="grow" />
        <label class="row small">ความเด่นขั้นต่ำ
          <select class="select sm" style="width:auto" value={minProm} onChange={(e) => setMinProm(Number((e.target as HTMLSelectElement).value) as 1 | 2 | 3)}>
            <option value={1}>● ขึ้นไป</option><option value={2}>●● ขึ้นไป</option><option value={3}>●●●</option>
          </select>
        </label>
      </div>
      <div class="card" style="overflow:hidden">
        {shown.length === 0 && <div class="muted" style="padding:24px;text-align:center">ไม่พบสัญญาณตามเงื่อนไข — ลองปรับเกณฑ์ในหน้า “ตั้งค่า”</div>}
        {shown.map((s) => (
          <div key={s.id} class={'signal-card' + (sel === s.id ? ' selected' : '')} onClick={() => openInspector({ kind: 'signal', id: s.id })}>
            <Prominence n={s.prominence} />
            <div>
              <div class="row wrap"><b class="small">{SIGNAL_LABEL[s.type]}</b><span class="tiny muted">{formatThaiDateTime(s.startTs, !s.timeApprox)}</span>{s.timeApprox && <Pill kind="warn">ไม่มีเวลา</Pill>}</div>
              <div class="small secondary">{s.summary}</div>
              <div class="tiny muted ellipsis" style="margin-top:2px">{s.focus.slice(0, 4).map((f) => labelOf(f, false)).join(' · ')}{s.focus.length > 4 ? ` +${s.focus.length - 4}` : ''}</div>
            </div>
            <div class="num small">{fmtBaht(s.totalAmount)}<div class="tiny muted">{fmtInt(s.txnIds.length)} รายการ</div></div>
          </div>
        ))}
      </div>
      {list.length > shown.length && <div class="small muted">แสดง {shown.length} จาก {fmtInt(list.length)} — ปรับตัวกรองหรือเพิ่มความเด่นขั้นต่ำเพื่อดูที่เหลือ</div>}
      <details class="card pad">
        <summary class="small"><b>เกณฑ์ที่ใช้ตรวจ (ปรับได้ในหน้าตั้งค่า)</b></summary>
        <div class="small secondary" style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:4px 20px">
          <div>เงินไหลผ่านเร็ว: ออก ≥ {Math.round(st.settings.rapidMinRatio * 100)}% ภายใน {st.settings.rapidWindowMin} นาที</div>
          <div>แบ่งโอน: ≥ {st.settings.splitMinCount} รายการ ยอดใกล้กัน ±{Math.round(st.settings.splitAmountTolerance * 100)}% ภายใน {st.settings.splitWindowMin} นาที</div>
          <div>รวมเงิน: ≥ {st.settings.convergeMinSenders} ผู้ส่ง ภายใน {st.settings.convergeWindowMin} นาที</div>
          <div>ส่งต่อต่อเนื่อง: ≥ {st.settings.chainMinHops} ทอด ภายใน {st.settings.chainWindowMin} นาทีต่อทอด</div>
          <div>เงินวนกลับ: ภายใน {st.settings.circularWindowHours} ชั่วโมง</div>
          <div>ถอนเงินสด: หลังรับโอนภายใน {st.settings.cashOutWindowMin} นาที</div>
          <div>ยอดขั้นต่ำที่นำมาพิจารณา: {fmtBaht(st.settings.minSignalAmount)} บาท</div>
          <div>ซ้ำหลายวัน: ≥ {st.settings.repeatedMinDays} วัน</div>
        </div>
        <button class="btn sm" style="margin-top:10px" onClick={() => { void patchCase({ settings: { ...DEFAULT_SETTINGS } }, { recompute: true }); }}><Icon name="refresh" size={15} />คืนค่าเกณฑ์เริ่มต้น</button>
      </details>
    </div>
  );
}
