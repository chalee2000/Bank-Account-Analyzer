import { useRef, useState } from 'preact/hooks';
import { buildDemoCase } from '../../demo';
import { caseList, createCase, cs, go, notify, openCase, removeCase, replaceCaseState } from '../../state';
import { formatThaiDate } from '../../core/thai';
import { importCase, inspectCaseFile, WrongPassphraseError } from '../../store/caseFile';
import { BankChip, Empty, Field, Modal } from '../common';
import { Icon } from '../icons';

export function CasesPage() {
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<{ buf: ArrayBuffer; encrypted: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cases = caseList.value;

  const onPick = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const info = await inspectCaseFile(buf);
      if (info.encrypted) setPendingFile({ buf, encrypted: true });
      else await doImport(buf);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'อ่านไฟล์คดีไม่ได้', 'err');
    }
  };
  const doImport = async (buf: ArrayBuffer, pass?: string) => {
    const st = await importCase(buf, pass);
    // สร้าง id ใหม่ถ้าซ้ำกับคดีที่มีอยู่ เพื่อไม่ทับข้อมูลเดิม
    if (caseList.value.some((c) => c.id === st.meta.id)) {
      st.meta = { ...st.meta, id: st.meta.id + '_import' + Date.now().toString(36), name: st.meta.name + ' (นำเข้า)' };
    }
    go('/dashboard');
    await replaceCaseState(st);
    notify('นำเข้าไฟล์คดีแล้ว');
  };

  return (
    <div class="stack" style="max-width:1000px">
      <section class="hero">
        <div class="hero-txt">
          <h1>วิเคราะห์การเงินเชิงสืบสวน</h1>
          <p>นำเข้า Statement หลายบัญชี ไล่เส้นทางเงิน ดูความเชื่อมโยงในผังเครือข่าย แล้วจัดทำรายงานประกอบการสืบสวน — ประมวลผลในเครื่องนี้ทั้งหมด</p>
          <div class="row wrap hero-chips">
            <span class="hero-chip">CSV · Excel · PDF · รูปสแกน (OCR)</span>
            <span class="hero-chip">Excel ที่ตั้งรหัสผ่านได้</span>
          </div>
          <div class="row wrap hero-banks" aria-label="รูปแบบ Statement ที่ระบบรู้จัก">
            <span class="small">รู้จักรูปแบบ Statement ของ</span>
            <BankChip code="KBANK" label="กสิกรไทย" /><BankChip code="SCB" label="ไทยพาณิชย์" /><BankChip code="KTB" label="กรุงไทย" /><BankChip code="BAAC" label="ธ.ก.ส." />
          </div>
        </div>
      </section>
      <div class="notice">
        <Icon name="shield" />
        <div>
          <b>ข้อมูลทั้งหมดประมวลผลและเก็บในเครื่องนี้เท่านั้น</b> — ไฟล์ Statement ไม่ถูกอัปโหลดไปที่ใด ข้อมูลเก็บในเบราว์เซอร์ของคุณ
          แนะนำให้ส่งออก “ไฟล์คดีเข้ารหัส” เพื่อสำรองข้อมูลและย้ายระหว่างคอมพิวเตอร์กับ iPhone
        </div>
      </div>
      <div class="row wrap">
        <button class="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />สร้างคดีใหม่</button>
        <button class="btn" onClick={() => fileRef.current?.click()}><Icon name="download" />นำเข้าไฟล์คดี (.baa)</button>
        <button class="btn" onClick={async () => { go('/dashboard'); await replaceCaseState(buildDemoCase()); }}>ทดลองด้วยข้อมูลสมมติ</button>
        <input ref={fileRef} type="file" accept=".baa,application/octet-stream" hidden onChange={onPick} />
      </div>

      {cases.length === 0 ? (
        <div class="card"><Empty title="ยังไม่มีคดี" icon="file">
          เริ่มจาก “สร้างคดีใหม่” แล้วนำเข้า Statement ของแต่ละบัญชี (CSV, Excel, PDF หรือรูปภาพสแกน) —
          หรือกด “ทดลองด้วยข้อมูลสมมติ” เพื่อดูตัวอย่างการวิเคราะห์ทั้งหมดก่อน
        </Empty></div>
      ) : (
        <div class="grid cols-2">
          {cases.map((c) => (
            <div class="card pad" key={c.id} style={cs.value?.meta.id === c.id ? 'box-shadow:0 0 0 2px var(--accent)' : undefined}>
              <div class="row" style="align-items:flex-start">
                <div class="ico-box"><Icon name="file" /></div>
                <div class="grow">
                  <b>{c.name}</b>
                  <div class="small muted">{c.caseNumber ? `เลขคดี ${c.caseNumber} · ` : ''}แก้ไขล่าสุด {formatThaiDate(c.updatedAt)}</div>
                </div>
              </div>
              <div class="row" style="margin-top:12px">
                <button class="btn primary sm" onClick={async () => { go('/dashboard'); await openCase(c.id); }}>เปิดคดี</button>
                <button class="btn danger sm" onClick={() => setConfirmDel(c.id)}><Icon name="trash" size={15} />ลบ</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <NewCaseModal onClose={() => setCreating(false)} />}
      {confirmDel && (
        <Modal title="ลบคดีนี้?" onClose={() => setConfirmDel(null)} footer={<>
          <button class="btn" onClick={() => setConfirmDel(null)}>ยกเลิก</button>
          <button class="btn danger" onClick={async () => { await removeCase(confirmDel); setConfirmDel(null); notify('ลบคดีแล้ว'); }}>ลบถาวร</button>
        </>}>
          การลบจะเอาข้อมูล Statement และผลวิเคราะห์ของคดีนี้ออกจากเครื่องนี้ถาวร และกู้คืนไม่ได้ (ควรส่งออกไฟล์คดีสำรองไว้ก่อน)
        </Modal>
      )}
      {pendingFile && <PassphraseModal onClose={() => setPendingFile(null)} onSubmit={async (p) => { try { await doImport(pendingFile.buf, p); setPendingFile(null); } catch (e) { notify(e instanceof WrongPassphraseError ? e.message : 'นำเข้าไม่สำเร็จ', 'err'); } }} />}
    </div>
  );
}

function NewCaseModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [no, setNo] = useState('');
  const [inv, setInv] = useState('');
  const [ag, setAg] = useState('');
  const ok = name.trim().length > 0;
  const submit = async () => {
    if (!ok) return;
    await createCase(name.trim(), { caseNumber: no.trim() || undefined, investigator: inv.trim() || undefined, agency: ag.trim() || undefined });
    onClose();
    go('/import');
  };
  return (
    <Modal title="สร้างคดีใหม่" onClose={onClose} footer={<><button class="btn" onClick={onClose}>ยกเลิก</button><button class="btn primary" disabled={!ok} onClick={submit}>สร้างและเริ่มนำเข้าไฟล์</button></>}>
      <div class="stack">
        <Field label="ชื่อคดี / ชื่อเรื่อง *"><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autofocus placeholder="เช่น ตรวจสอบเส้นทางการเงินกรณี …" /></Field>
        <Field label="เลขคดี / เลขที่เอกสาร"><input class="input" value={no} onInput={(e) => setNo((e.target as HTMLInputElement).value)} /></Field>
        <Field label="ผู้จัดทำ / เจ้าหน้าที่ผู้รับผิดชอบ"><input class="input" value={inv} onInput={(e) => setInv((e.target as HTMLInputElement).value)} /></Field>
        <Field label="หน่วยงาน"><input class="input" value={ag} onInput={(e) => setAg((e.target as HTMLInputElement).value)} /></Field>
        <div class="tiny muted">ข้อมูลเหล่านี้ใช้ในหน้าปกรายงานเท่านั้น แก้ไขได้ภายหลังในหน้าตั้งค่า</div>
      </div>
    </Modal>
  );
}

export function PassphraseModal(props: { onClose: () => void; onSubmit: (p: string) => void; title?: string }) {
  const [p, setP] = useState('');
  return (
    <Modal title={props.title ?? 'ไฟล์คดีนี้เข้ารหัสไว้'} onClose={props.onClose} footer={<><button class="btn" onClick={props.onClose}>ยกเลิก</button><button class="btn primary" onClick={() => props.onSubmit(p)}>ถอดรหัส</button></>}>
      <Field label="รหัสผ่านของไฟล์คดี"><input class="input" type="password" value={p} onInput={(e) => setP((e.target as HTMLInputElement).value)} autofocus onKeyDown={(e) => e.key === 'Enter' && props.onSubmit(p)} /></Field>
    </Modal>
  );
}
