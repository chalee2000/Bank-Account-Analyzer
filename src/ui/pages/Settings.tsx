import { useEffect, useState } from 'preact/hooks';
import { cs, labelOf, notify, patchCase, removeAlias, setTheme, theme, wipeEverything } from '../../state';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '../../core/types';
import { exportCase } from '../../store/caseFile';
import { deleteTemplate, listTemplates } from '../../store/db';
import { Field, Modal, saveBlob } from '../common';
import { Icon } from '../icons';

interface NumField { key: keyof AnalysisSettings; label: string; unit: string; step?: number; pct?: boolean; hint?: string }

const GROUPS: { title: string; fields: NumField[] }[] = [
  { title: 'ทั่วไป', fields: [
    { key: 'minSignalAmount', label: 'ยอดขั้นต่ำของรายการที่นำมาพิจารณาเป็นสัญญาณ', unit: 'บาท', step: 1000 },
    { key: 'amountTolerance', label: 'ความคลาดเคลื่อนของยอด (เช่น ค่าธรรมเนียม)', unit: '%', pct: true, step: 0.5 },
    { key: 'mirrorToleranceMin', label: 'ความต่างของเวลาที่ยอมรับได้เมื่อจับคู่รายการสองฝั่ง', unit: 'นาที' },
  ] },
  { title: 'เงินไหลผ่านเร็ว (Rapid Movement)', fields: [
    { key: 'rapidWindowMin', label: 'หน้าต่างเวลา', unit: 'นาที' },
    { key: 'rapidMinRatio', label: 'สัดส่วนเงินออก/เงินเข้าขั้นต่ำ', unit: '%', pct: true, step: 5 },
  ] },
  { title: 'แบ่งโอน (Structuring/Splitting)', fields: [
    { key: 'splitWindowMin', label: 'หน้าต่างเวลา', unit: 'นาที' },
    { key: 'splitMinCount', label: 'จำนวนรายการขั้นต่ำ', unit: 'รายการ' },
    { key: 'splitAmountTolerance', label: 'ความต่างของยอดที่ถือว่าใกล้เคียง (±)', unit: '%', pct: true, step: 1 },
    { key: 'thresholdBand', label: 'ช่วงใต้วงเงินที่ตรวจ', unit: '%', pct: true, step: 1, hint: 'วงเงินกำหนดด้านล่าง' },
  ] },
  { title: 'รวมเงิน / ส่งต่อ / วนกลับ / ถอนเงินสด', fields: [
    { key: 'convergeWindowMin', label: 'รวมเงิน: หน้าต่างเวลา', unit: 'นาที' },
    { key: 'convergeMinSenders', label: 'รวมเงิน: จำนวนผู้ส่งขั้นต่ำ', unit: 'บัญชี' },
    { key: 'chainWindowMin', label: 'ส่งต่อ: เวลาสูงสุดต่อทอด', unit: 'นาที' },
    { key: 'chainMinHops', label: 'ส่งต่อ: จำนวนทอดขั้นต่ำ', unit: 'ทอด' },
    { key: 'chainMinRetain', label: 'ส่งต่อ: สัดส่วนยอดที่ต้องคงเหลือต่อทอด', unit: '%', pct: true, step: 5 },
    { key: 'circularWindowHours', label: 'วนกลับ: เวลาสูงสุด', unit: 'ชั่วโมง' },
    { key: 'cashOutWindowMin', label: 'ถอนเงินสด: หลังรับโอนภายใน', unit: 'นาที' },
    { key: 'repeatedMinDays', label: 'รูปแบบซ้ำ: จำนวนวันขั้นต่ำ', unit: 'วัน' },
    { key: 'traceMaxGapHours', label: 'ไล่เส้นทางเงิน: ช่องว่างเวลาสูงสุดต่อทอด', unit: 'ชั่วโมง' },
  ] },
];

export function SettingsPage() {
  const st = cs.value;
  const [s, setS] = useState<AnalysisSettings | null>(st ? { ...st.settings } : null);
  const [thr, setThr] = useState(st ? st.settings.thresholds.join(', ') : '');
  const [dirty, setDirty] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof listTemplates>>>([]);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});

  useEffect(() => { void listTemplates().then(setTemplates); }, []);
  useEffect(() => {
    void (async () => {
      const est = await navigator.storage?.estimate?.().catch(() => undefined);
      const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
      setStorage({ usage: est?.usage, quota: est?.quota, persisted });
    })();
  }, []);
  useEffect(() => { if (st) { setS({ ...st.settings }); setThr(st.settings.thresholds.join(', ')); setDirty(false); } }, [st?.meta.id]);

  const setField = (f: NumField, raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || !s) return;
    setS({ ...s, [f.key]: f.pct ? v / 100 : v });
    setDirty(true);
  };
  const apply = async () => {
    if (!s) return;
    const thresholds = thr.split(/[,\s]+/).map((x) => Number(x.replace(/,/g, ''))).filter((x) => Number.isFinite(x) && x > 0);
    await patchCase({ settings: { ...s, thresholds } }, { recompute: true });
    setDirty(false);
    notify('บันทึกเกณฑ์และวิเคราะห์ใหม่แล้ว');
  };

  return (
    <div class="stack" style="max-width:900px">
      {st && (
        <div class="card">
          <div class="card-head"><h2>ข้อมูลคดี (ใช้ในหน้าปกรายงาน)</h2></div>
          <div class="card-body grid cols-2">
            <Field label="ชื่อคดี"><input class="input" value={st.meta.name} onBlur={(e) => patchCase({ meta: { ...st.meta, name: (e.target as HTMLInputElement).value } })} /></Field>
            <Field label="เลขคดี / เลขที่เอกสาร"><input class="input" value={st.meta.caseNumber ?? ''} onBlur={(e) => patchCase({ meta: { ...st.meta, caseNumber: (e.target as HTMLInputElement).value || undefined } })} /></Field>
            <Field label="ผู้จัดทำ"><input class="input" value={st.meta.investigator ?? ''} onBlur={(e) => patchCase({ meta: { ...st.meta, investigator: (e.target as HTMLInputElement).value || undefined } })} /></Field>
            <Field label="หน่วยงาน"><input class="input" value={st.meta.agency ?? ''} onBlur={(e) => patchCase({ meta: { ...st.meta, agency: (e.target as HTMLInputElement).value || undefined } })} /></Field>
          </div>
        </div>
      )}

      {st && s && (
        <div class="card">
          <div class="card-head"><h2>เกณฑ์การตรวจรูปแบบ</h2>
            <button class="btn sm" onClick={() => { setS({ ...DEFAULT_SETTINGS }); setThr(DEFAULT_SETTINGS.thresholds.join(', ')); setDirty(true); }}>คืนค่าเริ่มต้น</button>
          </div>
          <div class="card-body stack">
            <div class="small secondary">เกณฑ์เหล่านี้กำหนดว่าอะไรจะถูกแจ้งเป็น “สัญญาณที่ควรตรวจสอบ” — ไม่มีค่าที่ถูกต้องตายตัว ควรปรับให้เหมาะกับลักษณะข้อมูลและเก็บค่าที่ใช้ไว้ในรายงาน (ระบบแนบพารามิเตอร์ในภาคผนวกให้อัตโนมัติ)</div>
            {GROUPS.map((g) => (
              <section key={g.title} class="stack tight">
                <h3>{g.title}</h3>
                <div class="grid cols-2">
                  {g.fields.map((f) => (
                    <Field key={f.key} label={`${f.label} (${f.unit})`}>
                      <input class="input" type="number" step={f.step ?? 1} min={0} value={f.pct ? Math.round((s[f.key] as number) * 1000) / 10 : (s[f.key] as number)} onInput={(e) => setField(f, (e.target as HTMLInputElement).value)} />
                    </Field>
                  ))}
                </div>
              </section>
            ))}
            <Field label="วงเงินที่ต้องการตรวจรายการ “ใต้วงเงินเล็กน้อย” (บาท คั่นด้วยจุลภาค เว้นว่าง = ไม่ตรวจ)">
              <input class="input" value={thr} onInput={(e) => { setThr((e.target as HTMLInputElement).value); setDirty(true); }} />
            </Field>
            <div class="row"><button class="btn primary" disabled={!dirty} onClick={apply}><Icon name="check" />บันทึกและวิเคราะห์ใหม่</button>{dirty && <span class="small" style="color:var(--warning)">มีการแก้ไขที่ยังไม่ได้บันทึก</span>}</div>
          </div>
        </div>
      )}

      {st && st.aliases.length > 0 && (
        <div class="card">
          <div class="card-head"><h2>บัญชีที่ผู้ใช้ยืนยันให้รวมกัน</h2></div>
          <div class="card-body stack tight">
            {st.aliases.map((g) => (
              <div key={g.id} class="row small" style="border-top:1px solid var(--border);padding-top:6px">
                <div class="grow">{g.members.map((m) => labelOf(m)).join('  =  ')}</div>
                <button class="btn sm danger" onClick={() => removeAlias(g.id)}>แยกออก</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div class="card">
        <div class="card-head"><h2>ข้อมูลและการสำรอง</h2></div>
        <div class="card-body stack">
          {st && (
            <div class="row wrap">
              <button class="btn" onClick={() => setExportOpen(true)}><Icon name="download" />ส่งออกไฟล์คดี (เข้ารหัส)</button>
              <span class="small muted">ใช้สำรองข้อมูลและย้ายคดีระหว่างคอมพิวเตอร์ ↔ iPhone (นำเข้าได้ที่หน้า “คดีทั้งหมด”)</span>
            </div>
          )}
          <dl class="kv-list" style="max-width:520px">
            <dt>พื้นที่ที่แอปใช้ในเบราว์เซอร์</dt><dd>{storage.usage !== undefined ? `${(storage.usage / 1048576).toFixed(1)} MB` : '–'}{storage.quota ? ` / ${(storage.quota / 1048576 / 1024).toFixed(1)} GB` : ''}</dd>
            <dt>ขอเก็บข้อมูลถาวร (persist)</dt><dd>{storage.persisted === undefined ? 'ไม่ทราบ' : storage.persisted ? 'ได้รับอนุญาต' : 'ยังไม่ได้รับ — แนะนำสำรองไฟล์คดี'}</dd>
          </dl>
          <div class="notice warn small"><Icon name="warn" /><div>บน iPhone/iPad เบราว์เซอร์อาจล้างข้อมูลเว็บที่ไม่ได้เปิดใช้นาน ๆ — ติดตั้งแอปลง “หน้าจอโฮม” (แชร์ → เพิ่มลงในหน้าจอโฮม) และส่งออกไฟล์คดีสำรองเป็นประจำ</div></div>
        </div>
      </div>

      {templates.length > 0 && (
        <div class="card">
          <div class="card-head"><h2>รูปแบบการจับคู่คอลัมน์ที่จำไว้</h2></div>
          <div class="card-body stack tight">
            {templates.map((t) => (
              <div key={t.key} class="row small" style="border-top:1px solid var(--border);padding-top:6px">
                <span class="grow ellipsis">{t.label}</span>
                <button class="btn sm ghost" onClick={async () => { await deleteTemplate(t.key); setTemplates(await listTemplates()); }}><Icon name="trash" size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div class="card">
        <div class="card-head"><h2>การแสดงผล</h2></div>
        <div class="card-body row wrap">
          {(['auto', 'light', 'dark'] as const).map((m) => (
            <button key={m} class={'btn' + (theme.value === m ? ' primary' : '')} onClick={() => setTheme(m)}>{m === 'auto' ? 'ตามระบบ' : m === 'light' ? 'สว่าง' : 'มืด'}</button>
          ))}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>ความเป็นส่วนตัวและความปลอดภัย</h2></div>
        <div class="card-body stack tight small secondary">
          <div>• ประมวลผลและเก็บข้อมูลในเบราว์เซอร์ของเครื่องนี้ทั้งหมด ไม่มีการอัปโหลดไฟล์หรือส่งข้อมูลไปยังเซิร์ฟเวอร์ใด (แอปไม่เรียกบริการภายนอก ฟอนต์ OCR และ PDF ถูกรวมไว้ในแอป)</div>
          <div>• SHA-256 ของไฟล์ต้นฉบับถูกบันทึกเพื่อยืนยันความครบถ้วนของไฟล์ในรายงาน</div>
          <div>• ไฟล์คดีที่ส่งออกเข้ารหัสด้วย AES-256-GCM (คีย์จากรหัสผ่านด้วย PBKDF2) — ถ้าลืมรหัสผ่านจะกู้คืนไม่ได้</div>
          <div>• เครื่องที่ใช้ร่วมกับผู้อื่นควรลบข้อมูลหลังใช้งาน หรือใช้โปรไฟล์เบราว์เซอร์แยกต่างหาก</div>
          <div><button class="btn danger" onClick={() => setWipeOpen(true)}><Icon name="trash" />ลบข้อมูลทั้งหมดในเครื่องนี้</button></div>
        </div>
      </div>

      {exportOpen && st && <ExportModal onClose={() => setExportOpen(false)} />}
      {wipeOpen && <WipeModal onClose={() => setWipeOpen(false)} />}
    </div>
  );
}

function ExportModal({ onClose }: { onClose: () => void }) {
  const st = cs.value!;
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [plain, setPlain] = useState(false);
  const [busy, setBusy] = useState(false);
  const ok = plain || (p1.length >= 8 && p1 === p2);
  const go = async () => {
    setBusy(true);
    try {
      const blob = await exportCase(st, plain ? undefined : p1);
      await saveBlob(blob, `${(st.meta.caseNumber || st.meta.name).replace(/[\\/:*?"<>|\s]+/g, '_')}.baa`);
      notify(plain ? 'ส่งออกไฟล์คดี (ไม่เข้ารหัส) แล้ว' : 'ส่งออกไฟล์คดีเข้ารหัสแล้ว');
      onClose();
    } catch (e) {
      notify('ส่งออกไม่สำเร็จ: ' + (e instanceof Error ? e.message : e), 'err');
    } finally { setBusy(false); }
  };
  return (
    <Modal title="ส่งออกไฟล์คดี" onClose={onClose} footer={<><button class="btn" onClick={onClose}>ยกเลิก</button><button class="btn primary" disabled={!ok || busy} onClick={go}>{busy ? <span class="spinner" /> : <Icon name="download" />}ส่งออก</button></>}>
      <div class="stack">
        <div class="small secondary">ไฟล์คดีมีข้อมูล Statement ทั้งหมด จึงควรเข้ารหัสและเก็บในที่ปลอดภัย</div>
        {!plain && <>
          <Field label="รหัสผ่านสำหรับเข้ารหัส (อย่างน้อย 8 ตัวอักษร)"><input class="input" type="password" value={p1} onInput={(e) => setP1((e.target as HTMLInputElement).value)} autofocus /></Field>
          <Field label="ยืนยันรหัสผ่าน" hint={p2 && p1 !== p2 ? 'รหัสผ่านไม่ตรงกัน' : undefined}><input class="input" type="password" value={p2} onInput={(e) => setP2((e.target as HTMLInputElement).value)} /></Field>
        </>}
        <label class="row small"><input type="checkbox" checked={plain} onChange={(e) => setPlain((e.target as HTMLInputElement).checked)} />ส่งออกโดยไม่เข้ารหัส (ไม่แนะนำ — ใครก็อ่านข้อมูลได้)</label>
      </div>
    </Modal>
  );
}

function WipeModal({ onClose }: { onClose: () => void }) {
  const [t, setT] = useState('');
  return (
    <Modal title="ลบข้อมูลทั้งหมดในเครื่องนี้?" onClose={onClose} footer={<><button class="btn" onClick={onClose}>ยกเลิก</button>
      <button class="btn danger" disabled={t !== 'ลบ'} onClick={async () => { await wipeEverything(); onClose(); notify('ลบข้อมูลทั้งหมดแล้ว'); }}>ลบถาวร</button></>}>
      <div class="stack">
        <div>จะลบทุกคดี ไฟล์ที่นำเข้า ผลวิเคราะห์ เทมเพลต และการตั้งค่าออกจากเบราว์เซอร์นี้ <b>กู้คืนไม่ได้</b> (ไฟล์ต้นฉบับในเครื่องของคุณไม่ถูกลบ)</div>
        <Field label="พิมพ์ “ลบ” เพื่อยืนยัน"><input class="input" value={t} onInput={(e) => setT((e.target as HTMLInputElement).value)} /></Field>
      </div>
    </Modal>
  );
}
