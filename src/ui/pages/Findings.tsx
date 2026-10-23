import { useState } from 'preact/hooks';
import { analysis, cs, findingsStale, notify, patchCase, regenerateFindings } from '../../state';
import type { AltHypothesis, Finding, FindingLevel } from '../../core/types';
import { CLOSING_STATEMENT, LIMITATIONS } from '../../analysis';
import { Empty, Notice } from '../common';
import { Icon } from '../icons';
import { newId } from '../../store/model';

export const LEVEL_LABEL: Record<FindingLevel, string> = { fact: 'ข้อเท็จจริง', observation: 'ข้อสังเกต', hypothesis: 'สมมติฐาน', recommendation: 'ข้อเสนอแนะ' };
const LEVEL_HELP: Record<FindingLevel, string> = {
  fact: 'สิ่งที่ข้อมูลยืนยันโดยตรง', observation: 'รูปแบบหรือความสัมพันธ์ที่เห็นจากข้อมูล',
  hypothesis: 'คำอธิบายที่เป็นไปได้และต้องทดสอบต่อ', recommendation: 'สิ่งที่ควรตรวจเพิ่มเพื่อยืนยันหรือหักล้างสมมติฐาน',
};
const LEVELS: FindingLevel[] = ['fact', 'observation', 'hypothesis', 'recommendation'];

export function FindingsPage() {
  const st = cs.value!;
  const res = analysis.value;
  const [busy, setBusy] = useState(false);
  const groups = new Map<string, Finding[]>();
  for (const f of st.findings) {
    const g = f.group ?? f.id;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(f);
  }
  const order = [...groups.entries()].sort((a, b) => {
    const rank = (k: string) => (k === 'overview' ? 0 : k === 'quality' ? 98 : k === 'priority' ? 99 : k.startsWith('manual-') || k.startsWith('f_') ? 50 : 10);
    return rank(a[0]) - rank(b[0]);
  });

  const update = (id: string, patch: Partial<Finding>) =>
    patchCase({ findings: st.findings.map((f) => (f.id === id ? { ...f, ...patch, source: patch.text !== undefined ? 'manual' : f.source } : f)) });
  const remove = (id: string) => patchCase({ findings: st.findings.filter((f) => f.id !== id) });
  const add = (level: FindingLevel, group?: string) =>
    patchCase({ findings: [...st.findings, { id: newId('f_'), level, text: '', include: true, source: 'manual', group: group ?? 'manual-free' }] });

  if (!res) return <Empty title="ยังไม่มีข้อมูล" icon="findings">นำเข้า Statement ก่อน แล้วระบบจะร่างผลวิเคราะห์ให้</Empty>;
  return (
    <div class="stack" style="max-width:1000px">
      <Notice kind="info">
        ระบบร่างผลวิเคราะห์ 4 ระดับจากข้อมูลจริงให้เป็นจุดเริ่มต้น — <b>โปรดตรวจและแก้ข้อความ</b> เลือกรายการที่จะใส่ในรายงานด้วยช่องติ๊ก
        ข้อความที่คุณแก้ไขจะไม่ถูกเขียนทับเมื่อสร้างร่างอัตโนมัติใหม่
      </Notice>
      {findingsStale.value && (
        <Notice kind="warn">
          ข้อมูลหรือเกณฑ์วิเคราะห์เปลี่ยนไปหลังสร้างร่างอัตโนมัติ ·{' '}
          <button class="btn sm" disabled={busy} onClick={async () => { setBusy(true); await regenerateFindings(); setBusy(false); notify('สร้างร่างอัตโนมัติใหม่แล้ว'); }}>สร้างร่างอัตโนมัติใหม่</button>
        </Notice>
      )}
      <div class="row wrap">
        {LEVELS.map((l) => <span key={l} class={'lvl ' + l} title={LEVEL_HELP[l]}>{LEVEL_LABEL[l]}</span>)}
        <span class="grow" />
        <button class="btn sm" disabled={busy} onClick={async () => { setBusy(true); await regenerateFindings(); setBusy(false); notify('สร้างร่างอัตโนมัติใหม่แล้ว (รายการที่คุณแก้ไข/เพิ่มเองยังอยู่)'); }}><Icon name="refresh" size={15} />สร้างร่างอัตโนมัติใหม่</button>
        <button class="btn sm primary" onClick={() => add('fact')}><Icon name="plus" size={15} />เพิ่มข้อความเอง</button>
      </div>

      {order.map(([g, list]) => (
        <div class="card" key={g}>
          {list.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level)).map((f) => (
            <div class="finding" key={f.id}>
              <div>
                <span class={'lvl ' + f.level}>{LEVEL_LABEL[f.level]}</span>
                {f.source === 'manual' && <div class="tiny muted" style="text-align:center;margin-top:4px">แก้โดยผู้ใช้</div>}
              </div>
              <textarea
                class="textarea" rows={Math.min(8, Math.max(2, Math.ceil(f.text.length / 90)))} value={f.text} aria-label={LEVEL_LABEL[f.level]}
                onBlur={(e) => { const v = (e.target as HTMLTextAreaElement).value; if (v !== f.text) void update(f.id, { text: v }); }}
              />
              <div class="stack tight" style="align-items:flex-end">
                <label class="row small"><input type="checkbox" checked={f.include} onChange={(e) => update(f.id, { include: (e.target as HTMLInputElement).checked })} />ใส่ในรายงาน</label>
                <select class="select sm" style="width:auto" value={f.level} onChange={(e) => update(f.id, { level: (e.target as HTMLSelectElement).value as FindingLevel })} aria-label="ระดับ">
                  {LEVELS.map((l) => <option value={l}>{LEVEL_LABEL[l]}</option>)}
                </select>
                <button class="btn ghost sm icon" aria-label="ลบ" onClick={() => remove(f.id)}><Icon name="trash" size={15} /></button>
              </div>
            </div>
          ))}
          <div class="row" style="padding:6px 14px">
            {LEVELS.filter((l) => !list.some((f) => f.level === l)).map((l) => <button key={l} class="btn ghost sm" onClick={() => add(l, g)}>+ {LEVEL_LABEL[l]}</button>)}
          </div>
        </div>
      ))}

      <AltHypotheses />

      <div class="card">
        <div class="card-head"><h2>ข้อจำกัดของการวิเคราะห์</h2></div>
        <div class="card-body">
          <ul class="small secondary" style="margin:0;padding-left:20px;display:grid;gap:4px">{LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
          <div class="disclaimer" style="margin-top:12px"><b>{CLOSING_STATEMENT}</b></div>
          <div class="tiny muted" style="margin-top:6px">ข้อความข้างต้นถูกแนบในรายงานทุกฉบับและแก้ไขไม่ได้</div>
        </div>
      </div>
    </div>
  );
}

const STATUS: { value: AltHypothesis['status']; label: string }[] = [
  { value: 'open', label: 'ยังไม่ได้พิจารณา' }, { value: 'considered', label: 'พิจารณาแล้ว' },
  { value: 'ruled_out', label: 'ตัดออกด้วยหลักฐาน' }, { value: 'supported', label: 'มีหลักฐานสนับสนุน' },
];

function AltHypotheses() {
  const st = cs.value!;
  const set = (id: string, patch: Partial<AltHypothesis>) => patchCase({ altHypotheses: st.altHypotheses.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  return (
    <div class="card">
      <div class="card-head"><h2>คำอธิบายทางเลือกที่ต้องพิจารณา</h2></div>
      <div class="card-body stack tight">
        <div class="small secondary">รูปแบบธุรกรรมเดียวกันอาจอธิบายได้หลายแบบ — บันทึกสถานะการพิจารณาและหลักฐานที่ใช้ตัดออกหรือสนับสนุน (จะแสดงในรายงาน)</div>
        {st.altHypotheses.map((a) => (
          <div key={a.id} class="row wrap" style="align-items:flex-start;padding:6px 0;border-top:1px solid var(--border)">
            <div class="grow" style="min-width:220px">{a.label}</div>
            <select class="select sm" style="width:190px" value={a.status} onChange={(e) => set(a.id, { status: (e.target as HTMLSelectElement).value as AltHypothesis['status'] })}>
              {STATUS.map((s) => <option value={s.value}>{s.label}</option>)}
            </select>
            <input class="input sm" style="flex:1 1 220px" placeholder="หลักฐาน / หมายเหตุ" value={a.note ?? ''} onBlur={(e) => set(a.id, { note: (e.target as HTMLInputElement).value })} />
          </div>
        ))}
      </div>
    </div>
  );
}
