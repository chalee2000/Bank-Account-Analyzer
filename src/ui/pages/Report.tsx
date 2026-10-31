import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { analysis, cs, derived, engineTrace, notify } from '../../state';
import { DEFAULT_REPORT_OPTIONS, ReportDocument, type ReportData, type ReportOptions } from '../../report/ReportDocument';
import { netOptionsFromView, renderNetworkImage } from '../network/graph';
import { DEFAULT_NETWORK_OPTIONS } from '../../store/model';
import { buildWorkbook } from '../../report/exportXlsx';
import { Empty, Notice, saveBlob } from '../common';
import { Icon } from '../icons';

const OPT_LABELS: { key: keyof ReportOptions; label: string }[] = [
  { key: 'summary', label: 'บทสรุปผู้บริหาร' }, { key: 'quality', label: 'คุณภาพและขอบเขตข้อมูล' }, { key: 'profile', label: 'โปรไฟล์ทางการเงิน + กราฟ' },
  { key: 'counterparties', label: 'คู่บัญชีสำคัญ' }, { key: 'trails', label: 'เส้นทางเงิน (Money Trail)' }, { key: 'network', label: 'ผังความเชื่อมโยง' }, { key: 'networkPhotos', label: 'รูปบุคคลในผังความเชื่อมโยง' },
  { key: 'timeline', label: 'ไทม์ไลน์' }, { key: 'findings', label: 'ผลวิเคราะห์ 4 ระดับ' }, { key: 'appendixParams', label: 'ภาคผนวก ก: พารามิเตอร์/ไฟล์/SHA-256' }, { key: 'appendixTxns', label: 'ภาคผนวก ข: ธุรกรรมหลักฐาน' },
];

const PAPER_PX = 793.7; // 210mm ที่ 96dpi

function loadOpts(): ReportOptions {
  try {
    const raw = localStorage.getItem('baa-report-opts');
    if (raw) return { ...DEFAULT_REPORT_OPTIONS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_REPORT_OPTIONS };
}

export function ReportPage() {
  const st = cs.value!;
  const d = derived.value;
  const res = analysis.value;
  const [opts, setOpts] = useState<ReportOptions>(loadOpts);
  const [net, setNet] = useState<ReportData['net']>(null);
  const [netBusy, setNetBusy] = useState(false);
  const [traces, setTraces] = useState<ReportData['traces']>([]);
  const [generatedAt, setGeneratedAt] = useState(() => Date.now());
  const [scale, setScale] = useState(1);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem('baa-report-opts', JSON.stringify(opts)); } catch { /* ignore */ } }, [opts]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, (el.clientWidth - 4) / PAPER_PX)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ภาพเครือข่าย (พื้นขาว) — สร้างใหม่เมื่อข้อมูลเปลี่ยน
  useEffect(() => {
    if (!res || !d || !opts.network) { setNet(null); return; }
    let cancelled = false;
    setNetBusy(true);
    // ใช้มุมมองที่จัดไว้บนหน้าเครือข่าย (ตัวกรอง รูปแบบ ตำแหน่ง) — คดีที่ไม่เคยจัดใช้ค่าเริ่มต้นเดียวกับหน้าเครือข่าย
    const view = st.networkView;
    const mode = view?.layout ?? 'auto';
    renderNetworkImage(d, res, st, { ...netOptionsFromView(view?.options ?? DEFAULT_NETWORK_OPTIONS, res), showPhotos: opts.networkPhotos }, undefined, { mode, saved: view?.positions?.[mode] })
      .then((r) => { if (!cancelled) setNet(r); })
      .catch((e) => { console.error(e); if (!cancelled) setNet(null); })
      .finally(() => !cancelled && setNetBusy(false));
    return () => { cancelled = true; };
  }, [res, d, st.manualNodes, st.manualLinks, st.accountNotes, st.networkView, opts.network, opts.networkPhotos]);

  // เส้นทางที่ปักหมุด
  useEffect(() => {
    if (!res) return;
    let cancelled = false;
    void (async () => {
      const out: ReportData['traces'] = [];
      for (const p of st.pinnedTraces) {
        try {
          const r = await engineTrace({ direction: p.direction, accountId: p.seed.accountId, txnId: p.seed.txnId });
          out.push({ label: p.label, direction: p.direction, result: r });
        } catch { /* ข้าม */ }
      }
      if (!cancelled) setTraces(out);
    })();
    return () => { cancelled = true; };
  }, [res, st.pinnedTraces]);

  const data = useMemo<ReportData | null>(() => (d && res ? { st, d, res, opts, net, traces, generatedAt } : null), [st, d, res, opts, net, traces, generatedAt]);

  if (!d || !res || !data) return <Empty title="ยังไม่มีข้อมูลสำหรับทำรายงาน" icon="report">นำเข้า Statement ก่อน</Empty>;

  const print = () => {
    const old = document.title;
    document.title = `รายงาน_${(st.meta.caseNumber || st.meta.name).replace(/[\\/:*?"<>|\s]+/g, '_')}`;
    const restore = () => { document.title = old; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    setTimeout(() => window.print(), 50);
  };

  const exportXlsx = async () => {
    setXlsxBusy(true);
    try {
      const blob = await buildWorkbook(st, d, res, traces);
      await saveBlob(blob, `${(st.meta.caseNumber || st.meta.name).replace(/[\\/:*?"<>|\s]+/g, '_')}_ข้อมูลสนับสนุน.xlsx`);
      notify('ส่งออก Excel แล้ว');
    } catch (e) {
      notify('ส่งออก Excel ไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally { setXlsxBusy(false); }
  };

  const includedCount = st.findings.filter((f) => f.include && f.text.trim()).length;

  return (
    <div class="stack">
      <div class="report-controls card pad stack">
        <div class="row wrap">
          <button class="btn primary" onClick={print} disabled={netBusy}><Icon name="report" />บันทึกเป็น PDF / พิมพ์</button>
          <button class="btn" onClick={exportXlsx} disabled={xlsxBusy}>{xlsxBusy ? <span class="spinner" /> : <Icon name="download" />}ส่งออก Excel (ข้อมูลสนับสนุน)</button>
          <button class="btn ghost" onClick={() => setGeneratedAt(Date.now())}><Icon name="refresh" size={16} />อัปเดตวันที่จัดทำ</button>
          {netBusy && <span class="small secondary row"><span class="spinner" />กำลังสร้างภาพผังเครือข่าย…</span>}
        </div>
        <details>
          <summary class="small"><b>เลือกส่วนที่จะรวมในรายงาน</b></summary>
          <div class="row wrap" style="margin-top:8px;gap:6px 18px">
            {OPT_LABELS.map((o) => (
              <label class="row small" key={o.key}><input type="checkbox" checked={opts[o.key]} onChange={(e) => setOpts({ ...opts, [o.key]: (e.target as HTMLInputElement).checked })} />{o.label}</label>
            ))}
          </div>
        </details>
        <div class="tiny muted">
          • บันทึกเป็น PDF: เลือกปลายทาง “บันทึกเป็น PDF” ในหน้าต่างพิมพ์ (ตั้งค่า: A4, ไม่มีหัว/ท้ายกระดาษของเบราว์เซอร์, เปิด “พื้นหลังกราฟิก”) ·
          บน iPhone: กด พิมพ์ แล้วถ่างนิ้วบนภาพตัวอย่างเพื่อเปิดเป็น PDF จากนั้นกดแชร์ → บันทึกลงไฟล์
        </div>
        {includedCount === 0 && opts.findings && <Notice kind="warn">ยังไม่ได้เลือกข้อความผลวิเคราะห์ที่จะใส่ในรายงาน — ไปที่หน้า “ผลวิเคราะห์” แล้วติ๊ก “ใส่ในรายงาน”</Notice>}
        <Notice kind="info">รายงานนี้แนบข้อจำกัดของการวิเคราะห์และข้อความปิดท้ายมาตรฐานทุกฉบับ ซึ่งแก้ไขหรือลบไม่ได้</Notice>
      </div>

      <div class="paper-wrap" ref={wrap}>
        <div class="paper-scale" style={{ zoom: String(scale) } as never}>
          <ReportDocument data={data} />
        </div>
      </div>
    </div>
  );
}
