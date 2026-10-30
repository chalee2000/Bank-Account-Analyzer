// ชื่อ-นามสกุล ที่มา และรูปบุคคลของบัญชี — ใช้ทั้งเมนูคลิกขวาบนผังเครือข่ายและแผงรายละเอียดบัญชี
import { useRef, useState } from 'preact/hooks';
import { accounts, cs, notify, setAccountNote } from '../state';
import { bankDisplay, formatAccountNumber } from '../core/normalize';
import type { AccountNote } from '../store/model';
import { imageFileToAvatar } from './avatar';
import { Field, Modal } from './common';
import { Icon } from './icons';

export interface PersonDraft {
  label: string;
  note: string;
  photo?: string;
}

export const draftOf = (n: AccountNote | undefined): PersonDraft => ({ label: n?.label ?? '', note: n?.note ?? '', photo: n?.photo });

/** ค่าที่บันทึก: ค่าว่างแปลว่าลบ (setAccountNote ลบคีย์ที่ว่างให้) */
export const noteOf = (d: PersonDraft): AccountNote => ({ label: d.label.trim(), note: d.note.trim(), photo: d.photo ?? '' });

export function PersonPhoto({ src, size = 56, alt }: { src?: string; size?: number; alt: string }) {
  return src ? (
    <img class="person-photo" src={src} width={size} height={size} alt={alt} />
  ) : (
    <span class="person-photo empty" style={{ width: size + 'px', height: size + 'px' }} aria-hidden="true"><Icon name="user" size={Math.round(size * 0.45)} /></span>
  );
}

/**
 * ช่องกรอกชื่อ/ที่มา/รูป — ไม่บันทึกเอง: แจ้งผู้ใช้งานผ่าน onChange
 * onCommit: เรียกเมื่อควรบันทึกทันที (ออกจากช่องข้อความ หรือเปลี่ยน/ลบรูป) — ใช้ในแผงที่บันทึกอัตโนมัติ
 */
export function PersonFields(props: { draft: PersonDraft; onChange: (d: PersonDraft) => void; onCommit?: (d: PersonDraft) => void }) {
  const { draft } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  const setPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const photo = await imageFileToAvatar(file);
      const next = { ...draft, photo };
      props.onChange(next);
      props.onCommit?.(next);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const removePhoto = () => {
    const next = { ...draft, photo: undefined };
    props.onChange(next);
    props.onCommit?.(next);
  };

  return (
    <div class="stack">
      <div
        class={'person-photo-row' + (drag ? ' drag' : '')}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void setPhoto(e.dataTransfer?.files?.[0]); }}
      >
        <PersonPhoto src={draft.photo} size={72} alt={draft.label ? `รูปของ ${draft.label}` : 'รูปบุคคล'} />
        <div class="stack tight">
          <div class="row wrap">
            <button type="button" class="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Icon name="image" size={15} />{busy ? 'กำลังย่อรูป…' : draft.photo ? 'เปลี่ยนรูป' : 'ใส่รูปบุคคล'}
            </button>
            {draft.photo && <button type="button" class="btn sm ghost" onClick={removePhoto}><Icon name="trash" size={15} />ลบรูป</button>}
          </div>
          <span class="tiny muted">เลือกไฟล์หรือลากรูปมาวาง · ระบบตัดเป็นจัตุรัสและย่อให้เล็ก เก็บในเครื่องนี้เท่านั้น</span>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden aria-label="เลือกรูปบุคคล" onChange={(e) => void setPhoto((e.target as HTMLInputElement).files?.[0])} />
      </div>
      <Field label="ชื่อ-นามสกุล (ใช้แสดงแทนในทุกหน้า)">
        <input
          class="input" value={draft.label} placeholder="เช่น นายสมมติ ตัวอย่าง"
          onInput={(e) => props.onChange({ ...draft, label: (e.target as HTMLInputElement).value })}
          onBlur={() => props.onCommit?.(draft)}
        />
      </Field>
      <Field label="ที่มา / หมายเหตุ">
        <textarea
          class="textarea" rows={3} value={draft.note} placeholder="เช่น ตามข้อมูล KYC เลขที่หนังสือ … / ภาพจาก CCTV วันที่ …"
          onInput={(e) => props.onChange({ ...draft, note: (e.target as HTMLTextAreaElement).value })}
          onBlur={() => props.onCommit?.(draft)}
        />
      </Field>
      <div class="tiny muted">ชื่อและรูปเป็นข้อมูลที่ผู้สืบสวนบันทึกจากหลักฐานอื่น ระบบไม่ได้ยืนยันว่าเป็นเจ้าของหรือผู้ใช้บัญชีจริง — ควรระบุที่มาไว้เสมอ</div>
    </div>
  );
}

/** หน้าต่างจากเมนูคลิกขวาบนผัง: แก้แล้วกดบันทึกครั้งเดียว */
export function PersonModal({ id, onClose }: { id: string; onClose: () => void }) {
  const a = accounts.value[id];
  const [draft, setDraft] = useState<PersonDraft>(() => draftOf(cs.value?.accountNotes[id]));
  const [saving, setSaving] = useState(false);
  if (!a) return null;
  const save = async () => {
    setSaving(true);
    try {
      await setAccountNote(id, noteOf(draft));
      notify('บันทึกชื่อ/รูปบุคคลแล้ว');
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="ชื่อ-นามสกุล และรูปบุคคล" onClose={onClose} footer={<>
      <button class="btn" onClick={onClose}>ยกเลิก</button>
      <button class="btn primary" disabled={saving} onClick={save}>บันทึก</button>
    </>}>
      <div class="stack">
        <div class="person-account">
          <b>{a.number ? formatAccountNumber(a.number) : 'ไม่ทราบเลขบัญชี'}</b>{a.bank ? ' · ' + bankDisplay(a.bank) : ''}
          {a.name && <div class="small secondary">ชื่อบัญชีตามข้อมูลธนาคาร: {a.name}</div>}
        </div>
        <PersonFields draft={draft} onChange={setDraft} />
      </div>
    </Modal>
  );
}
