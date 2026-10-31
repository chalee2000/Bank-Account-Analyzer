// เอกสารรายงานประกอบการสืบสวน (HTML รูปแบบ A4) — ใช้ทั้งแสดงตัวอย่างและพิมพ์/บันทึกเป็น PDF
import type { ComponentChildren } from 'preact';
import type { AnalysisResult, Finding, FindingLevel, TraceResult } from '../core/types';
import type { CaseState, Derived, LayoutMode } from '../store/model';
import { accountLabel } from '../analysis/ctx';
import { CLOSING_STATEMENT, LIMITATIONS, ROLE_LABEL, SIGNAL_LABEL, PRIORITY_DISCLAIMER } from '../analysis';
import { bankDisplay, formatAccountNumber } from '../core/normalize';
import { fmtBaht, fmtDuration, fmtInt, fmtPct, formatThaiDate, formatThaiDateTime, formatTs, isoDate } from '../core/thai';
import { bucketLabels, bucketize, heatmapData } from '../ui/chartData';
import { staticHeatmapSvg, staticLineSvg } from './staticCharts';
import { FLAG_LABEL, KIND_LABEL } from '../ui/labels';

/** สีชุดข้อมูลที่ 1–2 ของพาเลตต์ที่ผ่านการตรวจ (พิมพ์ได้ชัดทั้งสีและขาวดำ) */
const SERIES_BLUE = '#2a78d6';
const SERIES_ORANGE = '#eb6834';

export interface ReportOptions {
  summary: boolean;
  quality: boolean;
  profile: boolean;
  counterparties: boolean;
  trails: boolean;
  network: boolean;
  /** รูปบุคคลที่ผู้สืบสวนใส่ไว้ในจุดบัญชี — ค่าเริ่มต้นไม่แสดง เพื่อไม่ให้รูปติดไปในเอกสารโดยไม่ตั้งใจ */
  networkPhotos: boolean;
  timeline: boolean;
  findings: boolean;
  appendixParams: boolean;
  appendixTxns: boolean;
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  summary: true, quality: true, profile: true, counterparties: true, trails: true, network: true, networkPhotos: false,
  timeline: true, findings: true, appendixParams: true, appendixTxns: true,
};

export interface ReportData {
  st: CaseState;
  d: Derived;
  res: AnalysisResult;
  opts: ReportOptions;
  net: {
    dataUrl: string; nodeCount: number; edgeCount: number; legend: { label: string; color: string }[]; summary?: string;
    layout?: LayoutMode; manualPositions?: boolean;
  } | null;
  traces: { label: string; direction: 'forward' | 'backward'; result: TraceResult }[];
  generatedAt: number;
}

const LEVELS: FindingLevel[] = ['fact', 'observation', 'hypothesis', 'recommendation'];
const LEVEL_TITLE: Record<FindingLevel, string> = {
  fact: 'ข้อเท็จจริง (Fact) — สิ่งที่ข้อมูลยืนยันโดยตรง',
  observation: 'ข้อสังเกต (Observation) — รูปแบบหรือความสัมพันธ์ที่เห็นจากข้อมูล',
  hypothesis: 'สมมติฐาน (Hypothesis) — คำอธิบายที่เป็นไปได้และต้องทดสอบต่อ',
  recommendation: 'ข้อเสนอแนะ (Recommendation) — สิ่งที่ควรตรวจเพิ่มเพื่อยืนยันหรือหักล้าง',
};
const STATUS_TH = { open: 'ยังไม่ได้พิจารณา', considered: 'พิจารณาแล้ว', ruled_out: 'ตัดออกด้วยหลักฐาน', supported: 'มีหลักฐานสนับสนุน' } as const;
const TYPE_TH: Record<string, string> = { csv: 'CSV', xlsx: 'Excel', 'pdf-text': 'PDF (ข้อความ)', 'pdf-ocr': 'PDF (OCR)', 'image-ocr': 'รูปภาพ (OCR)' };

function H({ n, children }: { n: string; children: ComponentChildren }) {
  return <h2 class="rpt-h2"><span>{n}</span>{children}</h2>;
}

export function ReportDocument({ data }: { data: ReportData }) {
  const { st, d, res, opts } = data;
  const lab = (id: string, bank = true) => accountLabel(d.accounts[id], bank);
  const real = Object.values(d.accounts).filter((a) => a.kind === 'account');
  const q = res.quality;
  const txns = d.txns.filter((t) => t.kind !== 'fee' && t.kind !== 'interest');
  const totalAmt = txns.reduce((a, t) => a + t.amount, 0);
  const strong = res.signals.filter((s) => s.prominence >= 2);
  const typeCounts = new Map<string, number>();
  for (const s of strong) typeCounts.set(s.type, (typeCounts.get(s.type) ?? 0) + 1);
  const included = st.findings.filter((f) => f.include && f.text.trim());
  const sectionNo = (() => { let i = 0; return () => String(++i); })();
  const topPrio = res.priority.slice(0, 6).filter((p) => p.orderingScore > 0);

  // ข้อมูลกราฟ
  let flowSvg = '';
  let heatSvg = '';
  if (opts.profile && q.firstTs !== undefined && q.lastTs !== undefined) {
    const b = bucketize(txns, (t) => (t.kind === 'cash_withdrawal' || t.kind === 'cash_deposit' ? 'cash' : 'x'), q.firstTs, q.lastTs);
    const lbl = bucketLabels(b.bucket);
    flowSvg = staticLineSvg(b.xs, [
      { name: 'โอน/ชำระระหว่างบัญชี', color: SERIES_BLUE, values: b.values.get('x') ?? new Array(b.xs.length).fill(0) },
      { name: 'ฝาก/ถอนเงินสด', color: SERIES_ORANGE, values: b.values.get('cash') ?? new Array(b.xs.length).fill(0) },
    ], lbl.xLabel);
    const hm = heatmapData(txns);
    if (hm.used > 0) heatSvg = staticHeatmapSvg(hm.grid);
  }

  const profiles = real.filter((a) => res.profiles[a.id]).sort((a, b) => (res.profiles[b.id]!.totalIn + res.profiles[b.id]!.totalOut) - (res.profiles[a.id]!.totalIn + res.profiles[a.id]!.totalOut)).slice(0, 40);
  const pairsAmt = res.pairs.filter((p) => d.accounts[p.from]?.kind === 'account' && d.accounts[p.to]?.kind === 'account').slice(0, 10);
  const pairsFreq = [...res.pairs].filter((p) => d.accounts[p.from]?.kind === 'account' && d.accounts[p.to]?.kind === 'account').sort((a, b) => b.count - a.count || b.total - a.total).slice(0, 10);

  // ไทม์ไลน์
  const tl: { ts: number; hasTime: boolean; kind: string; text: string; amount?: number }[] = [];
  for (const e of st.events) tl.push({ ts: e.ts, hasTime: true, kind: 'เหตุการณ์', text: `${e.title}${e.detail ? ' — ' + e.detail : ''}${e.source ? ` (แหล่งที่มา: ${e.source})` : ''}` });
  for (const s of strong.slice(0, 12)) tl.push({ ts: s.startTs, hasTime: !s.timeApprox, kind: 'สัญญาณ', text: `${SIGNAL_LABEL[s.type]} — ${s.summary}`, amount: s.totalAmount });
  for (const t of [...txns].sort((a, b) => b.amount - a.amount).slice(0, 25)) tl.push({ ts: t.ts, hasTime: t.hasTime, kind: 'ธุรกรรม', text: `${lab(t.from, false)} → ${lab(t.to, false)} (${KIND_LABEL[t.kind]})`, amount: t.amount });
  tl.sort((a, b) => a.ts - b.ts);

  // ธุรกรรมหลักฐานในภาคผนวก
  const evidenceIds = new Set<string>();
  for (const f of included) for (const id of f.txnIds ?? []) evidenceIds.add(id);
  const evidence = d.txns.filter((t) => evidenceIds.has(t.id)).slice(0, 300);

  const fileRows = d.files;

  return (
    <article class="rpt" lang="th">
      {/* ===== ปก ===== */}
      <section class="rpt-cover">
        <div class="rpt-kicker">รายงานประกอบการสืบสวน</div>
        <h1>การวิเคราะห์ข้อมูลทางการเงินและความเชื่อมโยงของบัญชี</h1>
        <div class="rpt-case">{st.meta.name}</div>
        <table class="rpt-kv">
          <tbody>
            {st.meta.caseNumber && <tr><th>เลขคดี / เลขที่เอกสาร</th><td>{st.meta.caseNumber}</td></tr>}
            {st.meta.agency && <tr><th>หน่วยงาน</th><td>{st.meta.agency}</td></tr>}
            {st.meta.investigator && <tr><th>ผู้จัดทำ</th><td>{st.meta.investigator}</td></tr>}
            <tr><th>วันที่จัดทำรายงาน</th><td>{formatThaiDateTime(data.generatedAt, true, true)}</td></tr>
            <tr><th>ช่วงเวลาของข้อมูล</th><td>{q.firstTs !== undefined ? `${formatThaiDate(q.firstTs, true)} ถึง ${formatThaiDate(q.lastTs!, true)}` : '–'}</td></tr>
            <tr><th>ข้อมูลที่ใช้วิเคราะห์</th><td>{fmtInt(real.length)} บัญชี (มี Statement {fmtInt(real.filter((a) => a.hasStatement).length)} บัญชี) · {fmtInt(txns.length)} ธุรกรรม · {fmtInt(fileRows.length)} ไฟล์ต้นฉบับ</td></tr>
          </tbody>
        </table>
        <div class="rpt-box">
          <b>หมายเหตุสำคัญ:</b> รายงานนี้จัดทำจากข้อมูลทางการเงินที่นำเข้าเพื่อช่วยชี้เป้าและสร้างสมมติฐานในการสืบสวน
          ผลที่ปรากฏไม่ใช่ข้อพิสูจน์ความผิดของบุคคลใด และต้องตรวจสอบร่วมกับพยานหลักฐานอื่นที่ได้มาโดยชอบด้วยกฎหมาย
        </div>
      </section>

      {/* ===== 1 บทสรุป ===== */}
      {opts.summary && (
        <section>
          <H n={sectionNo()}>บทสรุปผู้บริหาร (Executive Summary)</H>
          <ul class="rpt-list">
            <li>ข้อมูลที่ใช้วิเคราะห์ครอบคลุมช่วงเวลา {q.firstTs !== undefined ? `${formatThaiDate(q.firstTs, true)} ถึง ${formatThaiDate(q.lastTs!, true)}` : '–'} เกี่ยวข้องกับ {fmtInt(real.length)} บัญชี รวม {fmtInt(txns.length)} ธุรกรรม มูลค่ารวม {fmtBaht(totalAmt)} บาท</li>
            {strong.length > 0
              ? <li>ระบบพบสัญญาณที่เกินเกณฑ์และควรตรวจสอบต่อ {fmtInt(strong.length)} รายการ ({[...typeCounts.entries()].map(([t, c]) => `${SIGNAL_LABEL[t as keyof typeof SIGNAL_LABEL].replace(/ \(.*\)/, '')} ${c}`).join(', ')})</li>
              : <li>ไม่พบสัญญาณที่เกินเกณฑ์ตามค่าตั้งต้นที่ใช้ในการวิเคราะห์</li>}
            {strong.slice(0, 4).map((s) => <li key={s.id}>{s.summary}</li>)}
            {topPrio.length > 0 && <li>บัญชีที่ตัวชี้วัดโครงสร้างเด่นเมื่อเทียบกับบัญชีอื่นในคดี (ควรเปิดดูก่อน): {topPrio.map((p) => lab(p.accountId)).join('; ')}. {PRIORITY_DISCLAIMER}</li>}
            {(q.balanceMismatch > 0 || q.skipped > 0 || q.noTime > 0) && <li>ข้อจำกัดของข้อมูล: {[q.skipped && `มีแถวที่อ่านไม่ได้/ถูกข้าม ${fmtInt(q.skipped)} แถว`, q.balanceMismatch && `ยอดคงเหลือไม่ต่อเนื่อง ${fmtInt(q.balanceMismatch)} รายการ`, q.noTime && `ไม่มีเวลา ${fmtInt(q.noTime)} รายการ`].filter(Boolean).join('; ')}</li>}
          </ul>
        </section>
      )}

      {/* ===== 2 คุณภาพข้อมูล ===== */}
      {opts.quality && (
        <section>
          <H n={sectionNo()}>คุณภาพและขอบเขตของข้อมูล</H>
          <table class="rpt-table">
            <thead><tr><th>ไฟล์</th><th>ชนิด</th><th>บัญชีเจ้าของ</th><th class="n">รายการ</th><th>ช่วงเวลา</th><th class="n">ข้าม</th><th class="n">ซ้ำ</th><th class="n">ยอดไม่ต่อเนื่อง</th></tr></thead>
            <tbody>
              {fileRows.map((f) => {
                const sf = st.files.find((x) => x.record.id === f.id);
                return (
                  <tr key={f.id}>
                    <td>{f.name}</td><td>{TYPE_TH[f.type] ?? f.type}</td>
                    <td>{sf ? `${formatAccountNumber(sf.owner.number)} ${sf.owner.bank ? bankDisplay(sf.owner.bank) : ''}` : ''}</td>
                    <td class="n">{fmtInt(f.rowsImported)}</td>
                    <td>{f.firstTs !== undefined ? `${formatThaiDate(f.firstTs)} – ${formatThaiDate(f.lastTs!)}` : '–'}</td>
                    <td class="n">{f.rowsSkipped}</td><td class="n">{f.duplicatesRemoved}</td><td class="n">{f.balanceChecks?.mismatches ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="rpt-note">
            รวมแถวในไฟล์ {fmtInt(q.totalRows)} · นำเข้า {fmtInt(q.imported)} · ข้าม {fmtInt(q.skipped)} · รายการซ้ำข้ามไฟล์ที่ตัดออก {fmtInt(q.duplicatesRemoved)} · รายการสองฝั่งที่รวมเป็นรายการเดียว {fmtInt(q.mirrorsMerged)} ·
            ไม่ระบุคู่บัญชี {fmtInt(q.noCounterparty)} · ไม่มีเวลา {fmtInt(q.noTime)} · คู่บัญชีที่ได้จากการอ่านข้อความ {fmtInt(q.inferredCounterparty)}
          </p>
          {fileRows.flatMap((f) => f.warnings.map((w) => `${f.name}: ${w}`)).map((w, i) => <p class="rpt-note warn" key={i}>⚠ {w}</p>)}
        </section>
      )}

      {/* ===== 3 โปรไฟล์ ===== */}
      {opts.profile && (
        <section>
          <H n={sectionNo()}>โปรไฟล์ทางการเงินรายบัญชี</H>
          {flowSvg && (<figure class="rpt-fig"><div dangerouslySetInnerHTML={{ __html: flowSvg }} /><figcaption>รูปที่ 1 ยอดเงินรวมของธุรกรรมตามช่วงเวลา (สีน้ำเงิน = โอน/ชำระระหว่างบัญชี, สีส้ม = ฝาก/ถอนเงินสด)</figcaption></figure>)}
          <table class="rpt-table small">
            <thead><tr><th>บัญชี</th><th class="n">เงินเข้า</th><th class="n">เงินออก</th><th class="n">สุทธิ</th><th class="n">เข้า/ออก (ครั้ง)</th><th class="n">ผู้ส่ง/ผู้รับ</th><th class="n">Flow-through</th><th class="n">ถือเงินมัธยฐาน</th></tr></thead>
            <tbody>
              {profiles.map((a) => {
                const p = res.profiles[a.id]!;
                return (
                  <tr key={a.id}>
                    <td>{lab(a.id)}{!a.hasStatement && <span class="rpt-tag"> ไม่มี Statement</span>}</td>
                    <td class="n">{fmtBaht(p.totalIn)}</td><td class="n">{fmtBaht(p.totalOut)}</td><td class="n">{fmtBaht(p.net)}</td>
                    <td class="n">{p.inCount}/{p.outCount}</td><td class="n">{p.uniqueSenders}/{p.uniqueReceivers}</td>
                    <td class="n">{fmtPct(p.flowThrough, 0)}</td><td class="n">{fmtDuration(p.holding.medianMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="rpt-note">Flow-through = เงินออก ÷ เงินเข้า × 100 เป็นตัวชี้วัดการไหลผ่านของเงินเท่านั้น ไม่ใช่หลักฐานว่าบัญชีเป็นบัญชีทางผ่าน · ระยะเวลาถือเงินคำนวณจากการจับคู่แบบเข้าก่อนออกก่อน (FIFO) ซึ่งเป็นสมมติฐาน{profiles.length >= 40 ? ' · แสดง 40 บัญชีแรกตามยอดรวม (ดูทั้งหมดในไฟล์ Excel)' : ''}</p>
          {heatSvg && (<figure class="rpt-fig"><div dangerouslySetInnerHTML={{ __html: heatSvg }} /><figcaption>รูปที่ 2 ยอดเงินรวมแยกตามวันในสัปดาห์และชั่วโมง (เฉพาะรายการที่มีเวลา)</figcaption></figure>)}
        </section>
      )}

      {/* ===== 4 คู่บัญชี ===== */}
      {opts.counterparties && (
        <section>
          <H n={sectionNo()}>คู่บัญชีสำคัญ (Top Counterparties)</H>
          <h3 class="rpt-h3">เรียงตามยอดเงิน</h3>
          <table class="rpt-table small"><thead><tr><th>ผู้โอน</th><th>ผู้รับ</th><th class="n">ยอดรวม</th><th class="n">ครั้ง</th><th>ช่วงเวลา</th></tr></thead>
            <tbody>{pairsAmt.map((p) => <tr key={p.from + p.to}><td>{lab(p.from)}</td><td>{lab(p.to)}</td><td class="n">{fmtBaht(p.total)}</td><td class="n">{p.count}</td><td>{formatThaiDate(p.firstTs)}{p.lastTs - p.firstTs > 86_400_000 ? ' – ' + formatThaiDate(p.lastTs) : ''}</td></tr>)}</tbody></table>
          <h3 class="rpt-h3">เรียงตามความถี่</h3>
          <table class="rpt-table small"><thead><tr><th>ผู้โอน</th><th>ผู้รับ</th><th class="n">ครั้ง</th><th class="n">ยอดรวม</th></tr></thead>
            <tbody>{pairsFreq.map((p) => <tr key={p.from + p.to}><td>{lab(p.from)}</td><td>{lab(p.to)}</td><td class="n">{p.count}</td><td class="n">{fmtBaht(p.total)}</td></tr>)}</tbody></table>
        </section>
      )}

      {/* ===== 5 Money Trail ===== */}
      {opts.trails && (
        <section>
          <H n={sectionNo()}>เส้นทางเงิน (Money Trail)</H>
          {data.traces.length === 0 && res.signals.filter((s) => s.type === 'layering').length === 0 && <p class="rpt-note">ไม่มีเส้นทางที่ปักหมุดไว้ และไม่พบเส้นทางส่งต่อเงินต่อเนื่องตามเกณฑ์</p>}
          {data.traces.map((t, i) => (
            <div key={i} class="rpt-trail">
              <h3 class="rpt-h3">{t.label} ({t.direction === 'forward' ? 'Forward Trace' : 'Backward Trace'})</h3>
              <table class="rpt-table small"><thead><tr><th>วันเวลา</th><th>จาก</th><th>ไป</th><th class="n">ยอดรายการ</th><th class="n">ยอดที่ไล่ได้</th></tr></thead>
                <tbody>{t.result.edges.slice(0, 40).map((e) => <tr key={e.txnId}><td>{formatTs(e.ts, d.txns.find((x) => x.id === e.txnId)?.hasTime ?? true)}</td><td>{lab(e.from, false)}</td><td>{lab(e.to, false)}</td><td class="n">{fmtBaht(e.amount)}</td><td class="n">{fmtBaht(e.traced)}</td></tr>)}</tbody></table>
              {t.result.edges.length > 40 && <p class="rpt-note">แสดง 40 จาก {t.result.edges.length} รายการแรกตามเวลา</p>}
              <p class="rpt-note"><b>{t.direction === 'forward' ? 'ปลายทางของเงิน' : 'ต้นทางที่ไล่ถึง'}:</b> {t.result.terminals.slice(0, 6).map((x) => `${lab(x.accountId, false)}${x.cash ? ' (เงินสด)' : ''} ${fmtBaht(x.amount)} บาท`).join('; ') || '–'}</p>
            </div>
          ))}
          {data.traces.length === 0 && res.signals.filter((s) => s.type === 'layering').slice(0, 3).map((s) => (
            <p key={s.id} class="rpt-para">{s.summary}</p>
          ))}
          <p class="rpt-note">เส้นทางเป็นสมมติฐานจากเวลาและยอดเงิน (จับคู่เงินเข้า–ออกแบบ FIFO ภายใน {st.settings.traceMaxGapHours} ชั่วโมง) ไม่ใช่การยืนยันว่าเป็นเงินก้อนเดียวกัน</p>
        </section>
      )}

      {/* ===== 6 เครือข่าย ===== */}
      {opts.network && (
        <section>
          <H n={sectionNo()}>ผังความเชื่อมโยง (Network / Link Analysis)</H>
          {data.net ? (
            <figure class="rpt-fig">
              <img src={data.net.dataUrl} alt="ผังเครือข่ายความเชื่อมโยงระหว่างบัญชี" style="width:100%;border:1px solid #ddd" />
              <figcaption>รูปที่ 3 ผังเครือข่าย {fmtInt(data.net.nodeCount)} จุด {fmtInt(data.net.edgeCount)} เส้น{data.net.summary ? ` (${data.net.summary})` : ''} — ขนาดจุดตามยอดเงินรวม ความหนาเส้นตามยอดโอน วงกลมใหญ่ที่มีวงขาว = เจ้าของ Statement วงกลมเส้นประ = คู่บัญชีอื่นที่รวมไว้ สี่เหลี่ยมเส้นประ = จุดเงินสด เส้นสีเขียว = เงินเข้าเจ้าของ เส้นสีส้ม = เงินออกจากเจ้าของ
                {data.net.layout === 'concentric' && ' · รูปแบบวงซ้อน: เจ้าของ Statement อยู่วงใน บัญชีร่วมวงถัดมา คู่บัญชีอื่นวงนอก'}
                {data.net.layout === 'flow' && ' · รูปแบบผังไหลเงิน: ผู้โอนเข้าอยู่คอลัมน์ซ้าย บัญชีเจ้าของ/ทางผ่านเรียงเป็นขั้นบันได (แต่ละบัญชีมีเส้นแนวดิ่งของตัวเอง) ผู้รับอยู่คอลัมน์ขวา ป้ายบนเส้น = ยอดรวมปัดเป็นบาท (จำนวนครั้ง) ลูกศรบอกทิศทางเงิน'}
                {data.net.manualPositions && ' · จัดตำแหน่งตามที่ผู้สืบสวนจัดไว้บนหน้าเครือข่าย'}
                {data.net.legend.length > 0 && <> · สี: {data.net.legend.map((l) => <span key={l.label} class="rpt-sw"><i style={{ background: l.color }} />{l.label}</span>)}</>}</figcaption>
            </figure>
          ) : <p class="rpt-note">ไม่มีข้อมูลเครือข่ายสำหรับแสดง</p>}
          {data.net && !!st.networkView?.notes?.length && (
            <div class="rpt-notes">
              <strong>ข้อความประกอบผัง (บันทึกของผู้สืบสวน)</strong>
              <ol>{st.networkView.notes.map((nt) => <li key={nt.id}>{nt.text}</li>)}</ol>
            </div>
          )}
          <table class="rpt-table small">
            <thead><tr><th>บัญชี</th><th class="n">โอนเข้า/ออก (บัญชี)</th><th class="n">Betweenness</th><th>จุดตัด</th><th>บทบาทเบื้องต้นที่ “อาจมี”</th></tr></thead>
            <tbody>
              {Object.values(res.metrics).sort((a, b) => b.betweenness - a.betweenness || b.degree - a.degree).slice(0, 8).map((m) => (
                <tr key={m.accountId}><td>{lab(m.accountId)}</td><td class="n">{m.inDegree}/{m.outDegree}</td><td class="n">{m.betweenness.toFixed(3)}</td><td>{m.isBridge ? 'ใช่' : '–'}</td>
                  <td>{(res.roleHints[m.accountId] ?? []).map((h) => ROLE_LABEL[h.role].replace(/ \(.*\)/, '')).join(', ') || '–'}</td></tr>
              ))}
            </tbody>
          </table>
          <p class="rpt-note">Degree หรือ Betweenness สูงไม่ได้หมายความว่ามีความผิดหรือเป็นผู้สั่งการ · ป้ายบทบาทได้จากโครงสร้างข้อมูลเท่านั้นและต้องยืนยันด้วยหลักฐานอื่น</p>
          {data.st.manualLinks.length > 0 && (
            <>
              <h3 class="rpt-h3">ความสัมพันธ์ที่ผู้สืบสวนบันทึกจากหลักฐานอื่น</h3>
              <table class="rpt-table small"><thead><tr><th>จาก</th><th>ความสัมพันธ์</th><th>ถึง</th></tr></thead>
                <tbody>{data.st.manualLinks.map((l) => {
                  const nm = (id: string) => data.st.manualNodes.find((n) => n.id === id)?.label ?? lab(id);
                  return <tr key={l.id}><td>{nm(l.a)}</td><td>{l.label}</td><td>{nm(l.b)}</td></tr>;
                })}</tbody></table>
            </>
          )}
        </section>
      )}

      {/* ===== 7 ไทม์ไลน์ ===== */}
      {opts.timeline && (
        <section>
          <H n={sectionNo()}>ไทม์ไลน์เหตุการณ์สำคัญ</H>
          <table class="rpt-table small">
            <thead><tr><th style="width:26mm">วันเวลา</th><th style="width:18mm">ประเภท</th><th>รายละเอียด</th><th class="n" style="width:26mm">ยอด</th></tr></thead>
            <tbody>{tl.map((r, i) => <tr key={i}><td>{formatThaiDateTime(r.ts, r.hasTime).replace(' เวลา', ' ')}</td><td>{r.kind}</td><td>{r.text}</td><td class="n">{r.amount !== undefined ? fmtBaht(r.amount) : ''}</td></tr>)}</tbody>
          </table>
          <p class="rpt-note">แสดงเหตุการณ์ที่บันทึกโดยผู้สืบสวน สัญญาณเด่น และธุรกรรมยอดสูงสุด 25 รายการ</p>
        </section>
      )}

      {/* ===== 8 ผลวิเคราะห์ ===== */}
      {opts.findings && (
        <section>
          <H n={sectionNo()}>ผลการวิเคราะห์</H>
          {included.length === 0 && <p class="rpt-note">ยังไม่ได้เลือกข้อความผลวิเคราะห์ที่จะใส่ในรายงาน (หน้า “ผลวิเคราะห์”)</p>}
          {LEVELS.map((l) => {
            const list = included.filter((f) => f.level === l);
            if (!list.length) return null;
            return (
              <div key={l} class={'rpt-lvl ' + l}>
                <h3 class="rpt-h3">{LEVEL_TITLE[l]}</h3>
                <ol class="rpt-ol">{list.map((f: Finding) => <li key={f.id}>{f.text}</li>)}</ol>
              </div>
            );
          })}
          <h3 class="rpt-h3">คำอธิบายทางเลือกที่ได้พิจารณา</h3>
          <table class="rpt-table small"><thead><tr><th>คำอธิบายทางเลือก</th><th style="width:34mm">สถานะ</th><th>หลักฐาน/หมายเหตุ</th></tr></thead>
            <tbody>{st.altHypotheses.map((a) => <tr key={a.id}><td>{a.label}</td><td>{STATUS_TH[a.status]}</td><td>{a.note ?? ''}</td></tr>)}</tbody></table>
        </section>
      )}

      {/* ===== ข้อจำกัด ===== */}
      <section>
        <H n={sectionNo()}>ข้อจำกัดของการวิเคราะห์</H>
        <ul class="rpt-list">{LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
        <div class="rpt-closing">{CLOSING_STATEMENT}</div>
      </section>

      {/* ===== ภาคผนวก ===== */}
      {opts.appendixParams && (
        <section class="rpt-appendix">
          <h2 class="rpt-h2"><span>ภาคผนวก ก</span>พารามิเตอร์และวิธีการวิเคราะห์</h2>
          <table class="rpt-table small">
            <tbody>
              {[
                ['ยอดขั้นต่ำที่นำมาพิจารณาเป็นสัญญาณ', `${fmtBaht(st.settings.minSignalAmount)} บาท`],
                ['เงินไหลผ่านเร็ว', `เงินออก ≥ ${Math.round(st.settings.rapidMinRatio * 100)}% ภายใน ${st.settings.rapidWindowMin} นาที`],
                ['แบ่งโอน', `≥ ${st.settings.splitMinCount} รายการ ยอดใกล้เคียง ±${Math.round(st.settings.splitAmountTolerance * 100)}% ภายใน ${st.settings.splitWindowMin} นาที ไปอย่างน้อย 2 บัญชี`],
                ['รวมเงิน', `≥ ${st.settings.convergeMinSenders} บัญชีผู้ส่ง ภายใน ${st.settings.convergeWindowMin} นาที`],
                ['ส่งต่อต่อเนื่อง', `≥ ${st.settings.chainMinHops} ทอด ทอดละไม่เกิน ${st.settings.chainWindowMin} นาที ยอดคงเหลือต่อทอด ≥ ${Math.round(st.settings.chainMinRetain * 100)}%`],
                ['เงินวนกลับ', `ภายใน ${st.settings.circularWindowHours} ชั่วโมง`],
                ['ถอนเงินสดหลังรับโอน', `ภายใน ${st.settings.cashOutWindowMin} นาที`],
                ['รูปแบบซ้ำหลายวัน', `≥ ${st.settings.repeatedMinDays} วัน`],
                ['วงเงินที่ตรวจ “ใต้วงเงิน”', st.settings.thresholds.length ? `${st.settings.thresholds.map((x) => fmtInt(x)).join(', ')} บาท (ช่วงใต้วงเงิน ${Math.round(st.settings.thresholdBand * 100)}%)` : 'ไม่ตรวจ'],
                ['ไล่เส้นทางเงิน', `ช่องว่างเวลาสูงสุดต่อทอด ${st.settings.traceMaxGapHours} ชั่วโมง`],
                ['จับคู่รายการสองฝั่ง (mirror)', `ยอดเท่ากัน เวลาต่างกันไม่เกิน ${st.settings.mirrorToleranceMin} นาที และคู่บัญชีเข้ากันได้`],
              ].map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
            </tbody>
          </table>
          <p class="rpt-note">วิธีการ: ปรับรูปแบบข้อมูลจากทุกไฟล์เป็นตารางธุรกรรมเดียว ตัดรายการซ้ำข้ามไฟล์ จับคู่รายการที่ปรากฏทั้งสองฝั่ง คำนวณโปรไฟล์ ระยะเวลาถือเงิน (FIFO) ตรวจรูปแบบตามเกณฑ์ข้างต้น และสร้างเครือข่ายเพื่อคำนวณ Degree, Betweenness และจุดตัด ทุกขั้นตอนเป็นการคำนวณในเครื่อง</p>
          <h3 class="rpt-h3">ไฟล์ต้นฉบับและค่า SHA-256</h3>
          <table class="rpt-table small"><thead><tr><th>ไฟล์</th><th>SHA-256</th></tr></thead>
            <tbody>{fileRows.map((f) => <tr key={f.id}><td>{f.name}</td><td class="mono">{f.sha256}</td></tr>)}</tbody></table>
        </section>
      )}

      {opts.appendixTxns && evidence.length > 0 && (
        <section class="rpt-appendix">
          <h2 class="rpt-h2"><span>ภาคผนวก ข</span>ธุรกรรมที่เป็นหลักฐานของข้อความผลวิเคราะห์</h2>
          <table class="rpt-table tiny">
            <thead><tr><th>วันเวลา</th><th>จาก</th><th>ไป</th><th class="n">ยอด</th><th>ชนิด</th><th>แหล่งที่มา</th><th>หมายเหตุ</th></tr></thead>
            <tbody>{evidence.map((t) => (
              <tr key={t.id}>
                <td>{formatTs(t.ts, t.hasTime)}</td><td>{lab(t.from, false)}</td><td>{lab(t.to, false)}</td><td class="n">{fmtBaht(t.amount)}</td><td>{KIND_LABEL[t.kind]}</td>
                <td>{t.sources.map((s) => `${st.files.find((f) => f.record.id === s.fileId)?.record.name ?? s.fileId}#${s.row}`).join(', ')}</td>
                <td>{[t.mirrored && 'ยืนยัน 2 ฝั่ง', t.inferred && 'คู่บัญชีอนุมาน', ...(t.flags ?? []).map((f) => FLAG_LABEL[f] ?? f)].filter(Boolean).join('; ')}</td>
              </tr>
            ))}</tbody>
          </table>
          {evidenceIds.size > evidence.length && <p class="rpt-note">แสดง {evidence.length} จาก {evidenceIds.size} รายการ (ดูทั้งหมดในไฟล์ Excel)</p>}
        </section>
      )}
      <footer class="rpt-foot">จัดทำโดยระบบ Bank Account Analyzer · ประมวลผลในเครื่อง · {isoDate(data.generatedAt)}</footer>
    </article>
  );
}
