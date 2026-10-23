import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addStoredFile, cs, notify, removeStoredFile } from '../../state';
import { BANKS, bankDisplay, formatAccountNumber, normalizeAccountNumber } from '../../core/normalize';
import { fmtBaht, fmtInt, formatThaiDate, formatThaiDateTime } from '../../core/thai';
import { readStatementFile, type ReadResult } from '../../ingest';
import { PdfPasswordError, UnsupportedFileError } from '../../ingest/errors';
import { detectMapping, suggestOwner } from '../../ingest/detectColumns';
import { parseRows } from '../../ingest/parseRows';
import type { ColumnMapping, OwnerSuggestion, RawTable } from '../../ingest/types';
import { MAPPING_FIELDS } from '../../ingest/types';
import { getKv, listTemplates, saveTemplate } from '../../store/db';
import type { StoredFile } from '../../store/model';
import { Empty, Field, Modal, Notice } from '../common';
import { Icon } from '../icons';

type Status = 'reading' | 'needs-password' | 'ready' | 'error' | 'imported';

interface QueueItem {
  id: string;
  file: File;
  status: Status;
  phase?: string;
  fraction?: number;
  error?: string;
  result?: ReadResult;
  tableIdx: number;
  /** ตารางที่ผู้ใช้อาจแก้ค่า (OCR) — คัดลอกจากผลอ่าน */
  rows?: string[][];
  edits: number;
  mapping?: ColumnMapping;
  owner: { bank: string; number: string; name: string };
  suggestion?: OwnerSuggestion;
  password?: string;
  forceOcr?: boolean;
  saveTemplate?: boolean;
  open?: boolean;
}

const queue = signal<QueueItem[]>([]);
let counter = 0;

function patchItem(id: string, patch: Partial<QueueItem>) {
  queue.value = queue.value.map((q) => (q.id === id ? { ...q, ...patch } : q));
}

const TYPE_LABEL: Record<string, string> = {
  csv: 'CSV', xlsx: 'Excel', 'pdf-text': 'PDF (ข้อความ)', 'pdf-ocr': 'PDF (OCR)', 'image-ocr': 'รูปภาพ (OCR)',
};

const headerSig = (rows: string[][], h: number) => (h >= 0 && rows[h] ? 'hdr:' + rows[h]!.map((c) => c.toLowerCase().replace(/\s+/g, '')).join('|') : '');

async function startReading(id: string) {
  const item = queue.value.find((q) => q.id === id);
  if (!item) return;
  patchItem(id, { status: 'reading', phase: 'กำลังอ่านไฟล์', fraction: undefined, error: undefined });
  try {
    const result = await readStatementFile(item.file, {
      password: item.password,
      ocr: item.forceOcr ? 'force' : 'auto',
      onProgress: (p) => patchItem(id, { phase: p.phase, fraction: p.fraction }),
    });
    const templates = await listTemplates().catch(() => []);
    const table = result.tables[0]!;
    selectTable(id, result, 0, templates);
  } catch (e) {
    if (e instanceof PdfPasswordError) {
      patchItem(id, { status: 'needs-password', error: e.wrong ? 'รหัสผ่านไม่ถูกต้อง ลองอีกครั้ง' : undefined });
    } else {
      patchItem(id, {
        status: 'error',
        error: e instanceof UnsupportedFileError ? e.message : 'อ่านไฟล์ไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)),
      });
    }
  }
}

function selectTable(id: string, result: ReadResult, idx: number, templates?: Awaited<ReturnType<typeof listTemplates>>) {
  const table = result.tables[idx]!;
  let mapping = detectMapping(table);
  const sig = headerSig(table.rows, mapping.headerRow);
  const tpl = templates?.find((t) => t.key === sig);
  if (tpl) mapping = { ...tpl.mapping, headerRow: mapping.headerRow };
  const suggestion = suggestOwner(table.rows, mapping.headerRow);
  const guessedAcct = suggestion.number ? formatAccountNumber(suggestion.number) : '';
  patchItem(id, {
    status: 'ready',
    result,
    tableIdx: idx,
    rows: table.rows.map((r) => [...r]),
    edits: 0,
    mapping,
    suggestion,
    owner: { bank: suggestion.bank ?? '', number: guessedAcct, name: suggestion.name ?? '' },
    open: true,
    phase: undefined,
  });
}

function addFiles(files: FileList | File[]) {
  const items: QueueItem[] = [...files].map((f) => ({
    id: 'q' + ++counter, file: f, status: 'reading' as Status, tableIdx: 0, edits: 0, owner: { bank: '', number: '', name: '' },
  }));
  queue.value = [...queue.value, ...items];
  // อ่านทีละไฟล์ เพื่อไม่ให้หน่วยความจำพุ่ง (สำคัญบน iPhone)
  void (async () => {
    for (const it of items) await startReading(it.id);
  })();
}

export function ImportPage() {
  const st = cs.value!;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [skipView, setSkipView] = useState<StoredFile | null>(null);
  const items = queue.value;

  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent); };
  }, []);

  return (
    <div class="stack" style="max-width:1100px">
      <div
        class={'dropzone' + (over ? ' over' : '')} role="button" tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files); }}
      >
        <Icon name="upload" size={34} />
        <h2 style="margin-top:8px">ลากไฟล์ Statement มาวางที่นี่ หรือกดเพื่อเลือกไฟล์</h2>
        <div class="secondary small" style="margin-top:4px">รองรับหลายไฟล์พร้อมกัน · CSV, Excel (.xlsx), PDF (ข้อความหรือสแกน), รูปภาพ · 1 ไฟล์ = 1 บัญชี</div>
        <input
          ref={input} type="file" multiple hidden
          accept=".csv,.txt,.tsv,.xlsx,.xlsm,.pdf,image/*,application/pdf,text/csv"
          onChange={(e) => { const f = (e.target as HTMLInputElement).files; if (f?.length) addFiles(f); (e.target as HTMLInputElement).value = ''; }}
        />
      </div>

      {items.length > 0 && (
        <div class="card">
          <div class="card-head"><h2>คิวนำเข้า</h2>
            <button class="btn sm ghost" onClick={() => (queue.value = queue.value.filter((q) => q.status !== 'imported'))}>ล้างรายการที่นำเข้าแล้ว</button>
          </div>
          <div class="card-body" style="padding:6px 0 0">
            {items.map((it) => <QueueCard key={it.id} item={it} />)}
          </div>
        </div>
      )}

      <div class="card">
        <div class="card-head"><h2>ไฟล์ในคดีนี้ ({st.files.length})</h2></div>
        <div class="card-body" style="padding:6px 0 0">
          {st.files.length === 0 && <Empty title="ยังไม่มีไฟล์">นำเข้าไฟล์ด้านบนเพื่อเริ่มวิเคราะห์</Empty>}
          {st.files.map((f) => <StoredFileRow key={f.record.id} f={f} onSkipped={() => setSkipView(f)} />)}
        </div>
      </div>

      <div class="notice">
        <Icon name="info" />
        <div class="small">
          <b>ข้อควรรู้:</b> ระบบไม่เดาเลขบัญชีหรือยอดเงินที่อ่านไม่ชัด — แถวที่ระบุวันที่ ยอด หรือทิศทางเงินไม่ได้จะถูกข้ามพร้อมเหตุผล ·
          ไฟล์ .xls รุ่นเก่ายังไม่รองรับ (บันทึกเป็น .xlsx หรือ .csv ก่อน) · PDF ที่มีรหัสผ่านระบบจะถามรหัสผ่าน (ใช้ในเครื่องเท่านั้น)
        </div>
      </div>

      {skipView && (
        <Modal title={`แถวที่ถูกข้าม — ${skipView.record.name}`} wide onClose={() => setSkipView(null)}>
          <div class="tbl-wrap" style="max-height:60vh">
            <table class="tbl"><thead><tr><th>แถวที่</th><th>เหตุผล</th><th>ข้อความในแถว</th></tr></thead>
              <tbody>{skipView.skipped.map((s, i) => <tr key={i}><td>{s.row}</td><td class="wrap">{s.reason}</td><td class="wrap" style="max-width:520px">{s.text}</td></tr>)}</tbody></table>
          </div>
          {skipView.record.rowsSkipped > skipView.skipped.length && <div class="tiny muted" style="margin-top:6px">แสดง {skipView.skipped.length} จาก {skipView.record.rowsSkipped} แถว</div>}
        </Modal>
      )}
    </div>
  );
}

function StoredFileRow({ f, onSkipped }: { f: StoredFile; onSkipped: () => void }) {
  const r = f.record;
  const [confirm, setConfirm] = useState(false);
  return (
    <div class="file-item">
      <div class="ico-box"><Icon name="file" /></div>
      <div class="grow">
        <div class="row wrap"><b class="ellipsis">{r.name}</b><span class="chip">{TYPE_LABEL[r.type] ?? r.type}</span></div>
        <div class="small secondary">
          บัญชี {formatAccountNumber(f.owner.number)} {f.owner.bank ? '· ' + bankDisplay(f.owner.bank) : ''} {f.owner.name ? '· ' + f.owner.name : ''}
        </div>
        <div class="small muted">
          {fmtInt(r.rowsImported)} รายการ{r.firstTs !== undefined && r.lastTs !== undefined ? ` · ${formatThaiDate(r.firstTs)} – ${formatThaiDate(r.lastTs)}` : ''}
          {r.duplicatesRemoved > 0 && ` · รายการซ้ำที่ตัดออก ${r.duplicatesRemoved}`}
          {r.rowsSkipped > 0 && <> · <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); onSkipped(); }}>แถวที่ข้าม {r.rowsSkipped}</a></>}
        </div>
        <div class="tiny muted mono" title="SHA-256 ของไฟล์ต้นฉบับ (ใช้ยืนยันความครบถ้วนในรายงาน)">SHA-256 {r.sha256.slice(0, 16)}…</div>
        {r.warnings.map((w, i) => <div class="small" style="color:var(--warning)" key={i}>⚠ {w}</div>)}
      </div>
      <button class="btn danger sm" onClick={() => setConfirm(true)}><Icon name="trash" size={15} />เอาออก</button>
      {confirm && (
        <Modal title="เอาไฟล์นี้ออกจากคดี?" onClose={() => setConfirm(false)} footer={<>
          <button class="btn" onClick={() => setConfirm(false)}>ยกเลิก</button>
          <button class="btn danger" onClick={async () => { setConfirm(false); await removeStoredFile(r.id); notify('เอาไฟล์ออกแล้ว'); }}>เอาออก</button>
        </>}>
          ข้อมูลของไฟล์ <b>{r.name}</b> จะถูกลบออกจากคดี และวิเคราะห์ใหม่ทั้งหมด (ไฟล์ต้นฉบับในเครื่องคุณไม่ถูกลบ)
        </Modal>
      )}
    </div>
  );
}

function colLetter(i: number): string {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

function QueueCard({ item }: { item: QueueItem }) {
  const [pw, setPw] = useState('');
  const r = item.result;
  const typeLabel = r ? TYPE_LABEL[r.tables[item.tableIdx]!.fileType] : '';
  const icon = item.status === 'imported' ? 'check' : item.status === 'error' ? 'warn' : 'file';
  return (
    <div class="file-item" style="flex-direction:column;gap:10px">
      <div class="row" style="width:100%;align-items:flex-start">
        <div class="ico-box" style={item.status === 'error' ? 'background:var(--critical-bg);color:var(--critical)' : item.status === 'imported' ? 'background:color-mix(in srgb,var(--s3) 20%,transparent);color:var(--good)' : undefined}><Icon name={icon} /></div>
        <div class="grow">
          <div class="row wrap"><b class="ellipsis">{item.file.name}</b>{typeLabel && <span class="chip">{typeLabel}</span>}<span class="tiny muted">{(item.file.size / 1024).toFixed(0)} KB</span></div>
          {item.status === 'reading' && (
            <div class="stack tight" style="margin-top:4px">
              <div class="small secondary"><span class="spinner" style="width:12px;height:12px;margin-right:6px" />{item.phase ?? 'กำลังอ่าน…'}</div>
              {item.fraction !== undefined && <div class="progress"><i style={{ width: `${Math.round(item.fraction * 100)}%` }} /></div>}
            </div>
          )}
          {item.status === 'error' && <div class="small" style="color:var(--critical)">{item.error}</div>}
          {item.status === 'imported' && <div class="small" style="color:var(--good)">นำเข้าเรียบร้อย</div>}
          {item.status === 'needs-password' && (
            <div class="row" style="margin-top:6px;max-width:420px">
              <input class="input sm" type="password" placeholder="รหัสผ่าน PDF" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { patchItem(item.id, { password: pw }); void startReading(item.id); } }} />
              <button class="btn sm primary" onClick={() => { patchItem(item.id, { password: pw }); void startReading(item.id); }}>เปิดไฟล์</button>
              {item.error && <span class="small" style="color:var(--critical)">{item.error}</span>}
            </div>
          )}
          {item.status === 'needs-password' && !item.error && <div class="tiny muted">PDF นี้มีรหัสผ่าน (ธนาคารมักใช้เลขบัตรประชาชนหรือวันเกิด) — ใช้ในเครื่องนี้เท่านั้น ไม่ถูกส่งออก</div>}
        </div>
        {(item.status === 'ready' || item.status === 'imported') && (
          <button class="btn sm ghost" onClick={() => patchItem(item.id, { open: !item.open })}>{item.open ? 'ซ่อน' : 'ตรวจสอบ'}</button>
        )}
        {item.status === 'error' && <button class="btn sm" onClick={() => void startReading(item.id)}>ลองใหม่</button>}
        <button class="btn sm ghost icon" aria-label="เอาออกจากคิว" onClick={() => (queue.value = queue.value.filter((q) => q.id !== item.id))}><Icon name="close" size={16} /></button>
      </div>
      {item.status === 'ready' && item.open && <ReviewPanel item={item} />}
    </div>
  );
}

function ReviewPanel({ item }: { item: QueueItem }) {
  const st = cs.value!;
  const result = item.result!;
  const baseTable = result.tables[item.tableIdx]!;
  const rows = item.rows ?? baseTable.rows;
  const mapping = item.mapping!;
  const isOcr = baseTable.fileType === 'pdf-ocr' || baseTable.fileType === 'image-ocr';
  const [busy, setBusy] = useState(false);

  const table: RawTable = useMemo(() => ({ ...baseTable, rows }), [baseTable, rows, item.edits]);
  const fileId = 'f_' + result.sha256.slice(0, 10) + (result.tables.length > 1 ? '_' + item.tableIdx : '');
  const parsed = useMemo(() => parseRows(table, mapping, fileId), [table, mapping, fileId]);
  const ownerNorm = normalizeAccountNumber(item.owner.number);
  const alreadyImported = st.files.some((f) => f.record.id === fileId);
  const width = Math.min(30, Math.max(0, ...rows.slice(0, 60).map((r) => r.length)));
  const setMap = (patch: Partial<ColumnMapping>) => patchItem(item.id, { mapping: { ...mapping, ...patch } });
  const setOwner = (patch: Partial<QueueItem['owner']>) => patchItem(item.id, { owner: { ...item.owner, ...patch } });

  const totals = useMemo(() => {
    let inn = 0; let out = 0; let first: number | undefined; let last: number | undefined;
    for (const r of parsed.rows) {
      if (r.direction === 'in') inn += r.amount; else out += r.amount;
      if (first === undefined || r.ts < first) first = r.ts;
      if (last === undefined || r.ts > last) last = r.ts;
    }
    return { inn, out, first, last };
  }, [parsed]);

  const colOptions = [<option value="">— ไม่ใช้ —</option>].concat(
    Array.from({ length: width }, (_, i) => {
      const h = mapping.headerRow >= 0 ? rows[mapping.headerRow]?.[i] : '';
      const sample = rows[Math.max(0, mapping.headerRow + 1)]?.[i] ?? '';
      return <option value={String(i)}>{`${colLetter(i)} · ${h || sample || '(ว่าง)'}`.slice(0, 40)}</option>;
    }),
  );

  const canImport = !!ownerNorm && parsed.rows.length > 0 && !alreadyImported;

  const doImport = async () => {
    if (!ownerNorm) return;
    setBusy(true);
    try {
      if (item.saveTemplate) {
        const sig = headerSig(rows, mapping.headerRow);
        if (sig) await saveTemplate(sig, item.file.name, mapping);
      }
      const stored: StoredFile = {
        record: {
          id: fileId, name: item.file.name + (result.tables.length > 1 ? ` [${baseTable.sheetName}]` : ''), size: item.file.size, sha256: result.sha256,
          type: baseTable.fileType, importedAt: Date.now(), ownerAccountId: `${item.owner.bank || '?'}:${ownerNorm.number}`,
          rowsTotal: parsed.stats.totalRows, rowsImported: parsed.rows.length, rowsSkipped: parsed.stats.skipped.length, duplicatesRemoved: 0,
          firstTs: totals.first, lastTs: totals.last, warnings: parsed.stats.warnings,
          balanceChecks: { checked: parsed.stats.balanceChecked, mismatches: parsed.stats.balanceMismatches },
          mappingSummary: JSON.stringify(mapping),
        },
        owner: { bank: item.owner.bank || undefined, number: ownerNorm.number, name: item.owner.name.trim() || undefined },
        rows: parsed.rows,
        skipped: parsed.stats.skipped.slice(0, 500),
        mapping,
      };
      await addStoredFile(stored);
      patchItem(item.id, { status: 'imported', open: false });
      notify(`นำเข้า ${fmtInt(parsed.rows.length)} รายการจาก ${item.file.name}`);
    } catch (e) {
      notify('นำเข้าไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
    }
  };

  const mapFields: { key: keyof ColumnMapping; label: string }[] = MAPPING_FIELDS.map((f) => ({ key: f.key, label: f.label }));
  const hl = (col: number) => (col === mapping.date || col === mapping.time ? 'hl-date' : col === mapping.withdrawal || col === mapping.deposit || col === mapping.amount || col === mapping.balance ? 'hl-money' : '');
  const previewRows = rows.slice(0, Math.min(rows.length, Math.max(mapping.headerRow + 12, 14)));

  return (
    <div class="stack" style="width:100%">
      {result.tables.length > 1 && (
        <Field label="เลือกชีตที่เป็น Statement">
          <select class="select" value={item.tableIdx} onChange={(e) => selectTable(item.id, result, Number((e.target as HTMLSelectElement).value))}>
            {result.tables.map((t, i) => <option value={i}>{t.sheetName} ({t.rows.length} แถว)</option>)}
          </select>
        </Field>
      )}
      {(result.notes.length > 0 || (baseTable.notes?.length ?? 0) > 0) ? <div class="tiny muted">{[...result.notes, ...(baseTable.notes ?? [])].join(' · ')}</div> : null}

      <section class="stack tight">
        <h3>1) บัญชีเจ้าของ Statement นี้</h3>
        <div class="grid cols-3">
          <Field label="ธนาคาร / ผู้ให้บริการ">
            <select class="select" value={item.owner.bank} onChange={(e) => setOwner({ bank: (e.target as HTMLSelectElement).value })}>
              <option value="">ไม่ระบุ</option>
              {BANKS.map((b) => <option value={b.code}>{b.nameTh} ({b.code})</option>)}
            </select>
          </Field>
          <Field label="เลขที่บัญชี *" hint={ownerNorm ? `อ่านเป็น ${formatAccountNumber(ownerNorm.number)}` : 'ต้องมีตัวเลขอย่างน้อย 3 หลัก'}>
            <input class="input" value={item.owner.number} onInput={(e) => setOwner({ number: (e.target as HTMLInputElement).value })} inputMode="numeric" placeholder="เช่น 123-4-56789-0" />
          </Field>
          <Field label="ชื่อบัญชี"><input class="input" value={item.owner.name} onInput={(e) => setOwner({ name: (e.target as HTMLInputElement).value })} /></Field>
        </div>
        {item.suggestion && (item.suggestion.number || item.suggestion.name) && <div class="tiny muted">ค่าที่เติมให้อ่านจากหัวเอกสาร — โปรดตรวจกับต้นฉบับ</div>}
      </section>

      <section class="stack tight">
        <h3>2) จับคู่คอลัมน์</h3>
        <div class="grid cols-3">
          <Field label="แถวหัวตาราง (0 = ไม่มีหัวตาราง)">
            <input class="input" type="number" min={0} max={rows.length} value={mapping.headerRow + 1}
              onChange={(e) => setMap({ headerRow: Number((e.target as HTMLInputElement).value) - 1 })} />
          </Field>
          <Field label="รูปแบบจำนวนเงิน">
            <select class="select" value={mapping.amountMode} onChange={(e) => setMap({ amountMode: (e.target as HTMLSelectElement).value as ColumnMapping['amountMode'] })}>
              <option value="two-columns">แยกคอลัมน์ ถอน / ฝาก</option>
              <option value="signed">คอลัมน์เดียว มีเครื่องหมาย +/−</option>
              <option value="drcr-column">คอลัมน์เดียว + ตัวบอกทิศทาง (Dr/Cr)</option>
              <option value="infer-balance">ไม่มีทิศทาง — ใช้ส่วนต่างยอดคงเหลือ</option>
            </select>
          </Field>
          <Field label="ปีในวันที่">
            <select class="select" value={mapping.yearMode} onChange={(e) => setMap({ yearMode: (e.target as HTMLSelectElement).value as ColumnMapping['yearMode'] })}>
              <option value="auto">ตรวจอัตโนมัติ (พ.ศ./ค.ศ.)</option>
              <option value="be">เป็น พ.ศ. ทั้งหมด</option>
              <option value="ce">เป็น ค.ศ. ทั้งหมด</option>
            </select>
          </Field>
        </div>
        <div class="map-grid">
          {mapFields.map((f) => (
            <Field key={f.key} label={f.label}>
              <select class="select sm" value={mapping[f.key] === undefined ? '' : String(mapping[f.key])}
                onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setMap({ [f.key]: v === '' ? undefined : Number(v) } as Partial<ColumnMapping>); }}>
                {colOptions}
              </select>
            </Field>
          ))}
        </div>
        <div class="row wrap">
          <label class="row small"><input type="checkbox" checked={mapping.cpFromDescription} onChange={(e) => setMap({ cpFromDescription: (e.target as HTMLInputElement).checked })} />
            อ่านเลขบัญชี/ชื่อ/ธนาคารคู่โอนจากข้อความรายละเอียด (เดา — ติดธง “อนุมาน”)</label>
          <label class="row small"><input type="checkbox" checked={mapping.dayFirst} onChange={(e) => setMap({ dayFirst: (e.target as HTMLInputElement).checked })} /> วันที่เป็น วัน/เดือน/ปี</label>
          <label class="row small"><input type="checkbox" checked={!!item.saveTemplate} onChange={(e) => patchItem(item.id, { saveTemplate: (e.target as HTMLInputElement).checked })} /> จำการจับคู่นี้สำหรับไฟล์หัวตารางเดียวกัน</label>
        </div>
      </section>

      <section class="stack tight">
        <div class="row"><h3 class="grow">3) ตัวอย่างข้อมูล {isOcr && <span class="chip warn">OCR — คลิกเซลล์เพื่อแก้ไข</span>}</h3>
          {isOcr && (
            <label class="row small"><input type="checkbox" checked={!!item.forceOcr} onChange={(e) => { patchItem(item.id, { forceOcr: (e.target as HTMLInputElement).checked }); }} /> บังคับใช้ OCR (อ่านใหม่)</label>
          )}
        </div>
        <div class="preview-wrap">
          <table>
            <thead><tr><th>#</th>{Array.from({ length: width }, (_, i) => <th key={i}>{colLetter(i)}</th>)}</tr></thead>
            <tbody>
              {previewRows.map((row, ri) => (
                <tr key={ri} class={ri === mapping.headerRow ? 'is-header' : ''}>
                  <td class="row-head">{ri + 1}</td>
                  {Array.from({ length: width }, (_, ci) => {
                    const conf = baseTable.confidence?.[ri]?.[ci];
                    const low = isOcr && conf !== undefined && conf < 80 && !!row[ci];
                    return (
                      <td
                        key={ci} class={(ri > mapping.headerRow ? hl(ci) : '') + (low ? ' low-conf' : '')} title={low ? `ความมั่นใจ OCR ${Math.round(conf!)}%` : undefined}
                        contentEditable={isOcr}
                        onBlur={(e) => {
                          const v = (e.currentTarget as HTMLElement).innerText.trim();
                          if (v !== (row[ci] ?? '')) {
                            const next = rows.map((r) => [...r]);
                            while (next[ri]!.length <= ci) next[ri]!.push('');
                            next[ri]![ci] = v;
                            patchItem(item.id, { rows: next, edits: item.edits + 1 });
                          }
                        }}
                      >{row[ci] ?? ''}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="tiny muted">พื้นสีฟ้า = วันที่/เวลา · พื้นสีเขียว = ยอดเงิน · พื้นสีเหลือง = OCR ความมั่นใจต่ำ</div>
      </section>

      <section class="stack tight">
        <h3>4) ผลการอ่านข้อมูล</h3>
        <div class="grid cols-4 keep2">
          <div class="card pad"><div class="tiny muted">อ่านได้</div><b>{fmtInt(parsed.rows.length)}</b> <span class="small muted">จาก {fmtInt(parsed.stats.totalRows)} แถว</span></div>
          <div class="card pad"><div class="tiny muted">เงินเข้า / เงินออก</div><span class="small">{fmtBaht(totals.inn)} / {fmtBaht(totals.out)}</span></div>
          <div class="card pad"><div class="tiny muted">ช่วงเวลา</div><span class="small">{totals.first !== undefined ? formatThaiDate(totals.first) : '–'} – {totals.last !== undefined ? formatThaiDate(totals.last) : '–'}</span></div>
          <div class="card pad"><div class="tiny muted">ยอดคงเหลือต่อเนื่อง</div><span class="small">{parsed.stats.balanceChecked ? `${parsed.stats.balanceChecked - parsed.stats.balanceMismatches}/${parsed.stats.balanceChecked}` : 'ไม่มีข้อมูลตรวจ'}</span></div>
        </div>
        {parsed.stats.warnings.map((w, i) => <Notice kind="warn" key={i}>{w}</Notice>)}
        {parsed.stats.noCounterparty > 0 && <Notice kind="info">{parsed.stats.noCounterparty} รายการไม่ระบุคู่บัญชี (จะเชื่อมในเครือข่ายไม่ได้) {parsed.stats.inferredCounterparty > 0 ? `· ${parsed.stats.inferredCounterparty} รายการได้คู่บัญชีจากการอ่านข้อความ` : ''}</Notice>}
        {parsed.stats.skipped.length > 0 && (
          <details>
            <summary class="small">แถวที่ถูกข้าม {parsed.stats.skipped.length} แถว (คลิกเพื่อดู)</summary>
            <div class="tbl-wrap" style="max-height:200px;margin-top:6px"><table class="tbl"><tbody>
              {parsed.stats.skipped.slice(0, 40).map((s, i) => <tr key={i}><td style="width:60px">{s.row}</td><td class="wrap" style="width:240px">{s.reason}</td><td class="wrap">{s.text}</td></tr>)}
            </tbody></table></div>
          </details>
        )}
        {parsed.rows.slice(0, 3).length > 0 && (
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>เวลา</th><th>ทิศทาง</th><th class="num">จำนวน</th><th>คู่บัญชีที่อ่านได้</th><th>รายละเอียด</th></tr></thead><tbody>
            {parsed.rows.slice(0, 4).map((r) => (
              <tr key={r.row}><td>{formatThaiDateTime(r.ts, r.hasTime).replace(' เวลา', '')}</td><td>{r.direction === 'in' ? 'เข้า' : 'ออก'}</td><td class="num">{fmtBaht(r.amount)}</td>
                <td>{[r.cp.bank && bankDisplay(r.cp.bank), r.cp.number && formatAccountNumber(r.cp.number), r.cp.name].filter(Boolean).join(' ') || '—'}{r.cp.inferred ? ' *' : ''}</td><td class="ellipsis" style="max-width:260px">{r.description}</td></tr>
            ))}</tbody></table></div>
        )}
      </section>

      {alreadyImported && <Notice kind="warn">ไฟล์นี้ (เนื้อหาเหมือนกันทุกไบต์) ถูกนำเข้าในคดีนี้แล้ว</Notice>}
      {st.files.some((f) => ownerNorm && f.record.ownerAccountId === `${item.owner.bank || '?'}:${ownerNorm.number}`) && !alreadyImported && (
        <Notice kind="info">บัญชีนี้มี Statement อยู่แล้วในคดี — รายการที่ซ้ำกันข้ามไฟล์จะถูกตัดออกอัตโนมัติ</Notice>
      )}
      <div class="row" style="justify-content:flex-end">
        <button class="btn primary" disabled={!canImport || busy} onClick={doImport}>
          {busy ? <span class="spinner" /> : <Icon name="check" />}นำเข้า {fmtInt(parsed.rows.length)} รายการ
        </button>
      </div>
      {!ownerNorm && <div class="small" style="color:var(--critical);text-align:right">กรอกเลขที่บัญชีเจ้าของ Statement ก่อนนำเข้า</div>}
    </div>
  );
}

void getKv;
