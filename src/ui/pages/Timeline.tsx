import { useMemo, useState } from 'preact/hooks';
import { analysis, cs, derived, labelOf, notify, openInspector, patchCase } from '../../state';
import { fmtBaht, fmtInt, formatThaiDate, isoDate, formatTime } from '../../core/thai';
import type { CaseEvent, Signal, Txn } from '../../core/types';
import { SIGNAL_LABEL } from '../../analysis';
import { Empty, Field, Modal, Prominence } from '../common';
import { Icon } from '../icons';
import { KIND_LABEL } from '../labels';
import { newId } from '../../store/model';

const CATS: { value: CaseEvent['category']; label: string }[] = [
  { value: 'atm_cctv', label: 'ATM / CCTV' }, { value: 'arrest', label: 'การจับกุม / ตรวจค้น' }, { value: 'field', label: 'ข้อมูลภาคสนาม' },
  { value: 'communication', label: 'การสื่อสาร (CDR ฯลฯ)' }, { value: 'other', label: 'อื่น ๆ' },
];

type Item =
  | { t: 'txn'; ts: number; txn: Txn }
  | { t: 'event'; ts: number; ev: CaseEvent }
  | { t: 'signal'; ts: number; sig: Signal };

const toLocalInput = (ts: number) => new Date(ts).toISOString().slice(0, 16);

export function TimelinePage() {
  const st = cs.value!;
  const d = derived.value;
  const res = analysis.value;
  const [minAmt, setMinAmt] = useState(st.settings.minSignalAmount);
  const [acc, setAcc] = useState('');
  const [showTx, setShowTx] = useState(true);
  const [showSig, setShowSig] = useState(true);
  const [limit, setLimit] = useState(400);
  const [edit, setEdit] = useState<CaseEvent | 'new' | null>(null);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (showTx) for (const t of d?.txns ?? []) {
      if (t.amount < minAmt || t.kind === 'fee' || t.kind === 'interest') continue;
      if (acc && t.from !== acc && t.to !== acc) continue;
      out.push({ t: 'txn', ts: t.ts, txn: t });
    }
    if (showSig) for (const s of res?.signals ?? []) {
      if (s.prominence < 2) continue;
      if (acc && !s.focus.includes(acc)) continue;
      out.push({ t: 'signal', ts: s.startTs, sig: s });
    }
    for (const ev of st.events) {
      if (acc && !ev.accountIds.includes(acc) && ev.accountIds.length) continue;
      out.push({ t: 'event', ts: ev.ts, ev });
    }
    return out.sort((a, b) => a.ts - b.ts);
  }, [d, res, st.events, minAmt, acc, showTx, showSig]);

  const shown = items.slice(0, limit);
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of shown) {
      const k = isoDate(it.ts);
      (m.get(k) ?? m.set(k, []).get(k)!).push(it);
    }
    return [...m.entries()];
  }, [shown]);

  if (!d?.txns.length && !st.events.length) return <Empty title="ยังไม่มีข้อมูล" icon="timeline">นำเข้า Statement หรือเพิ่มเหตุการณ์ก่อน</Empty>;

  const save = async (ev: CaseEvent) => {
    const exists = st.events.some((e) => e.id === ev.id);
    await patchCase({ events: exists ? st.events.map((e) => (e.id === ev.id ? ev : e)) : [...st.events, ev] });
    notify('บันทึกเหตุการณ์แล้ว');
    setEdit(null);
  };
  const del = async (id: string) => { await patchCase({ events: st.events.filter((e) => e.id !== id) }); setEdit(null); };

  return (
    <div class="stack" style="max-width:980px">
      <div class="row wrap">
        <select class="select" style="width:240px" value={acc} onChange={(e) => setAcc((e.target as HTMLSelectElement).value)} aria-label="กรองบัญชี">
          <option value="">ทุกบัญชี</option>
          {Object.values(d?.accounts ?? {}).filter((a) => a.kind === 'account').map((a) => <option value={a.id}>{labelOf(a.id)}</option>)}
        </select>
        <label class="row small">ยอดตั้งแต่ <input class="input sm" style="width:110px" type="number" min={0} step={1000} value={minAmt} onInput={(e) => setMinAmt(Number((e.target as HTMLInputElement).value) || 0)} /> บาท</label>
        <label class="row small"><input type="checkbox" checked={showTx} onChange={(e) => setShowTx((e.target as HTMLInputElement).checked)} />ธุรกรรม</label>
        <label class="row small"><input type="checkbox" checked={showSig} onChange={(e) => setShowSig((e.target as HTMLInputElement).checked)} />สัญญาณเด่น</label>
        <span class="grow" />
        <button class="btn primary sm" onClick={() => setEdit('new')}><Icon name="plus" size={15} />เพิ่มเหตุการณ์/หลักฐาน</button>
      </div>
      <div class="tiny muted">รวมธุรกรรมของทุกบัญชี สัญญาณ และเหตุการณ์ที่ผู้สืบสวนบันทึก (ATM/CCTV, การจับกุม, ข้อมูลภาคสนาม ฯลฯ) ไว้บนแกนเวลาเดียวเพื่อดูความเชื่อมโยงของเวลา สถานที่ และความขัดแย้งของข้อมูล</div>

      {groups.map(([day, list]) => (
        <div class="card" key={day}>
          <div class="card-head"><h3>{formatThaiDate(list[0]!.ts, true)}</h3><span class="small muted">{fmtInt(list.filter((x) => x.t === 'txn').length)} ธุรกรรม</span></div>
          <div class="card-body" style="padding-top:6px">
            {list.map((it, i) => <TimelineRow key={i} it={it} onEdit={(ev) => setEdit(ev)} />)}
          </div>
        </div>
      ))}
      {items.length > limit && <button class="btn" onClick={() => setLimit(limit + 400)}>แสดงเพิ่ม (เหลืออีก {fmtInt(items.length - limit)})</button>}
      {items.length === 0 && <div class="muted">ไม่มีรายการตามตัวกรอง</div>}
      {edit && <EventModal initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSave={save} onDelete={del} />}
    </div>
  );
}

function TimelineRow({ it, onEdit }: { it: Item; onEdit: (e: CaseEvent) => void }) {
  const time = it.t === 'txn' && !it.txn.hasTime ? '——' : formatTime(it.ts);
  if (it.t === 'txn') {
    const t = it.txn;
    return (
      <div class="row small" style="padding:5px 0;cursor:pointer;border-bottom:1px solid var(--border)" onClick={() => openInspector({ kind: 'txn', id: t.id })}>
        <span class="mono muted" style="width:44px">{time}</span>
        <span class="chip">{KIND_LABEL[t.kind]}</span>
        <span class="grow ellipsis">{labelOf(t.from, false)} → {labelOf(t.to, false)}</span>
        <span class="num">{fmtBaht(t.amount)}</span>
      </div>
    );
  }
  if (it.t === 'signal') {
    const s = it.sig;
    return (
      <div class="row small" style="padding:6px 0;cursor:pointer;border-bottom:1px solid var(--border);background:var(--accent-soft);margin:0 -16px;padding-left:16px;padding-right:16px" onClick={() => openInspector({ kind: 'signal', id: s.id })}>
        <span class="mono muted" style="width:44px">{formatTime(s.startTs)}</span>
        <Prominence n={s.prominence} />
        <span class="grow"><b>{SIGNAL_LABEL[s.type]}</b> <span class="secondary">{s.summary.slice(0, 120)}{s.summary.length > 120 ? '…' : ''}</span></span>
      </div>
    );
  }
  const ev = it.ev;
  return (
    <div class="row small" style="padding:6px 0;cursor:pointer;border-bottom:1px solid var(--border);border-left:3px solid var(--s4);padding-left:10px;margin-left:-4px" onClick={() => onEdit(ev)}>
      <span class="mono muted" style="width:44px">{formatTime(ev.ts)}</span>
      <span class="chip warn">{CATS.find((c) => c.value === ev.category)?.label}</span>
      <span class="grow"><b>{ev.title}</b>{ev.detail && <span class="secondary"> — {ev.detail}</span>}{ev.accountIds.length > 0 && <span class="muted"> · {ev.accountIds.map((a) => labelOf(a, false)).join(', ')}</span>}</span>
      <Icon name="edit" size={14} />
    </div>
  );
}

function EventModal(props: { initial: CaseEvent | null; onClose: () => void; onSave: (e: CaseEvent) => void; onDelete: (id: string) => void }) {
  const ini = props.initial;
  const [ts, setTs] = useState(toLocalInput(ini?.ts ?? Date.now()));
  const [title, setTitle] = useState(ini?.title ?? '');
  const [detail, setDetail] = useState(ini?.detail ?? '');
  const [cat, setCat] = useState<CaseEvent['category']>(ini?.category ?? 'other');
  const [source, setSource] = useState(ini?.source ?? '');
  const [accs, setAccs] = useState<string[]>(ini?.accountIds ?? []);
  const options = Object.values(derived.value?.accounts ?? {}).filter((a) => a.kind === 'account');
  return (
    <Modal title={ini ? 'แก้ไขเหตุการณ์' : 'เพิ่มเหตุการณ์/หลักฐาน'} onClose={props.onClose} footer={<>
      {ini && <button class="btn danger" style="margin-right:auto" onClick={() => props.onDelete(ini.id)}>ลบ</button>}
      <button class="btn" onClick={props.onClose}>ยกเลิก</button>
      <button class="btn primary" disabled={!title.trim() || !ts} onClick={() => props.onSave({ id: ini?.id ?? newId('ev_'), ts: Date.parse(ts + ':00Z'), title: title.trim(), detail: detail.trim() || undefined, category: cat, source: source.trim() || undefined, accountIds: accs })}>บันทึก</button>
    </>}>
      <div class="stack">
        <Field label="วันเวลา (ตามเวลาท้องถิ่นของเหตุการณ์)"><input class="input" type="datetime-local" value={ts} onInput={(e) => setTs((e.target as HTMLInputElement).value)} /></Field>
        <Field label="ประเภท"><select class="select" value={cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value as CaseEvent['category'])}>{CATS.map((c) => <option value={c.value}>{c.label}</option>)}</select></Field>
        <Field label="หัวข้อ *"><input class="input" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="เช่น พบบุคคลสวมหมวกถอนเงินที่ตู้ ATM" /></Field>
        <Field label="รายละเอียด"><textarea class="textarea" rows={3} value={detail} onInput={(e) => setDetail((e.target as HTMLTextAreaElement).value)} /></Field>
        <Field label="บัญชีที่เกี่ยวข้อง (กด Ctrl/⌘ เพื่อเลือกหลายรายการ)">
          <select class="select" multiple style="height:110px" onChange={(e) => setAccs([...(e.target as HTMLSelectElement).selectedOptions].map((o) => o.value))}>
            {options.map((a) => <option value={a.id} selected={accs.includes(a.id)}>{labelOf(a.id)}</option>)}
          </select>
        </Field>
        <Field label="แหล่งที่มา / เลขที่เอกสาร"><input class="input" value={source} onInput={(e) => setSource((e.target as HTMLInputElement).value)} /></Field>
      </div>
    </Modal>
  );
}
