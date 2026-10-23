// ส่งออกข้อมูลสนับสนุนเป็น Excel หลายชีต — ใช้ exceljs (โหลดเมื่อกดส่งออกเท่านั้น)
import type { AnalysisResult, TraceResult } from '../core/types';
import type { CaseState, Derived } from '../store/model';
import { accountLabel } from '../analysis/ctx';
import { CLOSING_STATEMENT, LIMITATIONS, ROLE_LABEL, SIGNAL_LABEL } from '../analysis';
import { bankDisplay, formatAccountNumber } from '../core/normalize';
import { formatTs } from '../core/thai';
import { FLAG_LABEL, KIND_LABEL, metricRows } from '../ui/labels';

const FONT = { name: 'Tahoma', size: 10 };
const MONEY = '#,##0.00';

export async function buildWorkbook(
  st: CaseState, d: Derived, res: AnalysisResult,
  traces: { label: string; direction: 'forward' | 'backward'; result: TraceResult }[],
): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = st.meta.investigator || 'Bank Account Analyzer';
  wb.created = new Date();
  const lab = (id: string) => accountLabel(d.accounts[id]);
  const acct = (id: string) => (d.accounts[id]?.number ? formatAccountNumber(d.accounts[id]!.number) : '');
  const bank = (id: string) => bankDisplay(d.accounts[id]?.bank);
  // เก็บเวลาแบบ wall-clock ใน UTC → เซลล์วันที่ของ Excel ไม่ถูกเลื่อนตามเขตเวลา
  const dt = (ts: number) => new Date(ts);

  const sheet = (name: string, cols: { header: string; key: string; width: number; fmt?: string }[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: { font: FONT, numFmt: c.fmt, alignment: { vertical: 'top', wrapText: false } } }));
    const h = ws.getRow(1);
    h.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C5CAB' } };
    h.alignment = { vertical: 'middle', wrapText: true };
    h.height = 26;
    return ws;
  };

  // ---- 1) สรุป ----
  {
    const ws = wb.addWorksheet('สรุป');
    ws.columns = [{ width: 38 }, { width: 90 }];
    const rows: (string | number)[][] = [
      ['รายงาน', 'ข้อมูลสนับสนุนการวิเคราะห์ข้อมูลทางการเงินเชิงสืบสวน'],
      ['ชื่อคดี', st.meta.name], ['เลขคดี', st.meta.caseNumber ?? ''], ['หน่วยงาน', st.meta.agency ?? ''], ['ผู้จัดทำ', st.meta.investigator ?? ''],
      ['จัดทำเมื่อ', formatTs(Date.now(), true)],
      ['ช่วงเวลาของข้อมูล', res.quality.firstTs !== undefined ? `${formatTs(res.quality.firstTs, false)} – ${formatTs(res.quality.lastTs!, false)}` : ''],
      ['จำนวนบัญชี', Object.values(d.accounts).filter((a) => a.kind === 'account').length],
      ['จำนวนธุรกรรม', d.txns.length],
      ['รายการสองฝั่งที่รวมเป็นรายการเดียว', res.quality.mirrorsMerged],
      ['รายการซ้ำข้ามไฟล์ที่ตัดออก', res.quality.duplicatesRemoved],
      ['แถวที่ถูกข้าม', res.quality.skipped],
      ['จำนวนสัญญาณที่ตรวจพบ', res.signals.length],
      [],
      ['ข้อจำกัดของการวิเคราะห์', ''],
      ...LIMITATIONS.map((l, i) => [`${i + 1}.`, l]),
      [],
      ['ข้อความสำคัญ', CLOSING_STATEMENT],
    ];
    rows.forEach((r) => { ws.addRow(r).font = FONT; });
    ws.getColumn(1).font = { ...FONT, bold: true };
    ws.eachRow((row) => { row.alignment = { wrapText: true, vertical: 'top' }; });
  }

  // ---- 2) ธุรกรรมรวม ----
  {
    const ws = sheet('ธุรกรรมรวม', [
      { header: 'รหัสรายการ', key: 'id', width: 18 }, { header: 'วันเวลา', key: 'ts', width: 19, fmt: 'dd/mm/yyyy hh:mm:ss' },
      { header: 'วันเวลา (พ.ศ.)', key: 'tsBe', width: 18 }, { header: 'มีเวลา', key: 'hasTime', width: 8 },
      { header: 'จาก', key: 'from', width: 34 }, { header: 'เลขบัญชีผู้โอน', key: 'fromNo', width: 16 }, { header: 'ธนาคารผู้โอน', key: 'fromBank', width: 14 },
      { header: 'ไป', key: 'to', width: 34 }, { header: 'เลขบัญชีผู้รับ', key: 'toNo', width: 16 }, { header: 'ธนาคารผู้รับ', key: 'toBank', width: 14 },
      { header: 'จำนวนเงิน', key: 'amount', width: 15, fmt: MONEY }, { header: 'ชนิด', key: 'kind', width: 13 }, { header: 'ช่องทาง', key: 'channel', width: 14 },
      { header: 'รายละเอียดตามต้นฉบับ', key: 'desc', width: 50 }, { header: 'เลขอ้างอิง', key: 'ref', width: 16 }, { header: 'สถานที่/ตู้', key: 'loc', width: 22 },
      { header: 'IP Address', key: 'ip', width: 16 }, { header: 'รหัสตู้/เครื่อง', key: 'atm', width: 16 }, { header: 'ธนาคารเจ้าของตู้/ช่องทาง', key: 'atmBank', width: 18 },
      { header: 'รหัสสาขา', key: 'branch', width: 10 }, { header: 'ละติจูด', key: 'lat', width: 12 }, { header: 'ลองจิจูด', key: 'lng', width: 12 },
      { header: 'เบอร์โทร', key: 'phone', width: 14 },
      { header: 'หมายเหตุ', key: 'flags', width: 30 }, { header: 'แหล่งที่มา (ไฟล์#แถว)', key: 'src', width: 40 },
    ]);
    for (const t of d.txns) {
      ws.addRow({
        id: t.id, ts: dt(t.ts), tsBe: formatTs(t.ts, t.hasTime, true), hasTime: t.hasTime ? 'ใช่' : 'ไม่มี',
        from: lab(t.from), fromNo: acct(t.from), fromBank: bank(t.from), to: lab(t.to), toNo: acct(t.to), toBank: bank(t.to),
        amount: t.amount, kind: KIND_LABEL[t.kind], channel: t.channel ?? '', desc: t.description ?? '', ref: t.reference ?? '', loc: t.location ?? '',
        ip: t.extra?.ip ?? '', atm: t.extra?.atmId ?? '', atmBank: t.extra?.atmBank ?? '', branch: t.extra?.branch ?? '',
        lat: t.extra?.lat ?? '', lng: t.extra?.lng ?? '', phone: t.extra?.phone ?? '',
        flags: [t.mirrored && 'ยืนยัน 2 ฝั่ง', t.inferred && 'คู่บัญชีอนุมาน', ...(t.flags ?? []).map((f) => FLAG_LABEL[f] ?? f)].filter(Boolean).join('; '),
        src: t.sources.map((s) => `${st.files.find((f) => f.record.id === s.fileId)?.record.name ?? s.fileId}#${s.row}`).join(', '),
      });
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 25 } };
  }

  // ---- 3) โปรไฟล์บัญชี ----
  {
    const ws = sheet('โปรไฟล์บัญชี', [
      { header: 'บัญชี', key: 'label', width: 36 }, { header: 'เลขที่บัญชี', key: 'no', width: 16 }, { header: 'ธนาคาร', key: 'bank', width: 14 }, { header: 'มี Statement', key: 'stmt', width: 11 },
      { header: 'เงินเข้า', key: 'in', width: 16, fmt: MONEY }, { header: 'เงินออก', key: 'out', width: 16, fmt: MONEY }, { header: 'สุทธิ', key: 'net', width: 16, fmt: MONEY },
      { header: 'รายการเข้า', key: 'inC', width: 10 }, { header: 'รายการออก', key: 'outC', width: 10 }, { header: 'ผู้ส่ง (บัญชี)', key: 'snd', width: 10 }, { header: 'ผู้รับ (บัญชี)', key: 'rcv', width: 10 },
      { header: 'ยอดเฉลี่ย', key: 'avg', width: 14, fmt: MONEY }, { header: 'ยอดมัธยฐาน', key: 'med', width: 14, fmt: MONEY }, { header: 'ยอดสูงสุด', key: 'max', width: 14, fmt: MONEY },
      { header: 'Flow-through (%)', key: 'ft', width: 14, fmt: '0.0' }, { header: 'ถือเงินมัธยฐาน (นาที)', key: 'hold', width: 14, fmt: '0.0' },
      { header: 'ออกใน 15 นาที (%)', key: 'h15', width: 13, fmt: '0' }, { header: 'ออกใน 60 นาที (%)', key: 'h60', width: 13, fmt: '0' },
      { header: 'บทบาทเบื้องต้นที่ “อาจมี”', key: 'roles', width: 50 }, { header: 'Betweenness', key: 'bet', width: 12, fmt: '0.000' }, { header: 'จุดตัด', key: 'br', width: 8 },
      { header: 'องค์ประกอบ: ปริมาณ', key: 'c1', width: 10, fmt: '0%' }, { header: 'ความถี่', key: 'c2', width: 9, fmt: '0%' }, { header: 'Flow-through', key: 'c3', width: 11, fmt: '0%' },
      { header: 'ถือเงินสั้น', key: 'c4', width: 9, fmt: '0%' }, { header: 'Degree', key: 'c5', width: 9, fmt: '0%' }, { header: 'Betweenness', key: 'c6', width: 11, fmt: '0%' }, { header: 'สัญญาณ', key: 'c7', width: 9, fmt: '0%' },
    ]);
    const prio = new Map(res.priority.map((p) => [p.accountId, p.components]));
    for (const a of Object.values(d.accounts).filter((x) => x.kind === 'account')) {
      const p = res.profiles[a.id];
      const m = res.metrics[a.id];
      const c = prio.get(a.id);
      ws.addRow({
        label: lab(a.id), no: acct(a.id), bank: bank(a.id), stmt: a.hasStatement ? 'มี' : 'ไม่มี',
        in: p?.totalIn ?? 0, out: p?.totalOut ?? 0, net: p?.net ?? 0, inC: p?.inCount ?? 0, outC: p?.outCount ?? 0, snd: p?.uniqueSenders ?? 0, rcv: p?.uniqueReceivers ?? 0,
        avg: p?.avgAmount ?? 0, med: p?.medianAmount ?? 0, max: p?.maxAmount ?? 0, ft: p?.flowThrough ?? null,
        hold: p?.holding.medianMs != null ? p.holding.medianMs / 60000 : null,
        h15: p ? p.holding.shareWithin[15] * 100 : null, h60: p ? p.holding.shareWithin[60] * 100 : null,
        roles: (res.roleHints[a.id] ?? []).map((h) => `${ROLE_LABEL[h.role]} — ${h.reason}`).join(' | '),
        bet: m?.betweenness ?? null, br: m?.isBridge ? 'ใช่' : '',
        c1: c?.volume, c2: c?.frequency, c3: c?.flowThrough, c4: c?.quickHolding, c5: c?.degree, c6: c?.betweenness, c7: c?.signals,
      });
    }
    ws.addRow([]);
    ws.addRow(['หมายเหตุ: องค์ประกอบลำดับการตรวจสอบเป็นค่าสัมพัทธ์ภายในคดี ไม่ใช่คะแนนความผิด · บทบาทเบื้องต้นได้จากโครงสร้างข้อมูลและต้องยืนยันด้วยหลักฐานอื่น']).font = { ...FONT, italic: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 25 } };
  }

  // ---- 4) คู่บัญชี ----
  {
    const ws = sheet('คู่บัญชี', [
      { header: 'ผู้โอน', key: 'from', width: 36 }, { header: 'ผู้รับ', key: 'to', width: 36 }, { header: 'ยอดรวม', key: 'total', width: 16, fmt: MONEY }, { header: 'จำนวนครั้ง', key: 'count', width: 11 },
      { header: 'รายการแรก', key: 'first', width: 19, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'รายการล่าสุด', key: 'last', width: 19, fmt: 'dd/mm/yyyy hh:mm' },
    ]);
    for (const p of res.pairs) ws.addRow({ from: lab(p.from), to: lab(p.to), total: p.total, count: p.count, first: dt(p.firstTs), last: dt(p.lastTs) });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };
  }

  // ---- 5) สัญญาณ ----
  {
    const ws = sheet('สัญญาณรูปแบบ', [
      { header: 'ชนิด', key: 'type', width: 34 }, { header: 'ความเด่น (1–3)', key: 'prom', width: 10 }, { header: 'เริ่ม', key: 'start', width: 19, fmt: 'dd/mm/yyyy hh:mm' },
      { header: 'สิ้นสุด', key: 'end', width: 19, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'ยอดที่เกี่ยวข้อง', key: 'amt', width: 16, fmt: MONEY },
      { header: 'บัญชีที่เกี่ยวข้อง', key: 'focus', width: 60 }, { header: 'คำอธิบาย', key: 'sum', width: 90 }, { header: 'ตัวชี้วัด', key: 'metrics', width: 60 },
      { header: 'จำนวนรายการหลักฐาน', key: 'n', width: 12 }, { header: 'รหัสรายการหลักฐาน', key: 'ids', width: 60 }, { header: 'รหัสสัญญาณ', key: 'id', width: 28 },
    ]);
    for (const s of res.signals) {
      ws.addRow({
        type: SIGNAL_LABEL[s.type], prom: s.prominence, start: dt(s.startTs), end: dt(s.endTs), amt: s.totalAmount,
        focus: s.focus.map(lab).join(' · '), sum: s.summary, metrics: metricRows(s.metrics).map((r) => `${r.label}: ${r.value}`).join('; '),
        n: s.txnIds.length, ids: s.txnIds.join(', '), id: s.id,
      });
    }
    ws.addRow([]);
    ws.addRow(['หมายเหตุ: สัญญาณคือรูปแบบที่ควรตรวจสอบต่อ ไม่ใช่ข้อพิสูจน์ความผิด · “ความเด่น” บอกว่าเกินเกณฑ์มากเพียงใด ไม่ใช่ระดับความผิด']).font = { ...FONT, italic: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };
  }

  // ---- 6) ผลวิเคราะห์ ----
  {
    const ws = sheet('ผลวิเคราะห์', [
      { header: 'ระดับ', key: 'lvl', width: 16 }, { header: 'ข้อความ', key: 'text', width: 130 }, { header: 'ใส่ในรายงาน', key: 'inc', width: 12 }, { header: 'ที่มา', key: 'src', width: 14 },
    ]);
    const LV = { fact: 'ข้อเท็จจริง', observation: 'ข้อสังเกต', hypothesis: 'สมมติฐาน', recommendation: 'ข้อเสนอแนะ' } as const;
    for (const f of st.findings) ws.addRow({ lvl: LV[f.level], text: f.text, inc: f.include ? 'ใช่' : 'ไม่', src: f.source === 'auto' ? 'ร่างอัตโนมัติ' : 'ผู้ใช้' });
    ws.eachRow((r, i) => { if (i > 1) r.alignment = { wrapText: true, vertical: 'top' }; });
  }

  // ---- 7) เส้นทางเงิน ----
  if (traces.length) {
    const ws = sheet('เส้นทางเงิน', [
      { header: 'เส้นทาง', key: 'label', width: 40 }, { header: 'ชนิด', key: 'dir', width: 12 }, { header: 'ทอด', key: 'depth', width: 7 }, { header: 'วันเวลา', key: 'ts', width: 19, fmt: 'dd/mm/yyyy hh:mm:ss' },
      { header: 'จาก', key: 'from', width: 34 }, { header: 'ไป', key: 'to', width: 34 }, { header: 'ยอดรายการ', key: 'amt', width: 15, fmt: MONEY }, { header: 'ยอดที่ไล่ได้', key: 'tr', width: 15, fmt: MONEY }, { header: 'รหัสรายการ', key: 'id', width: 20 },
    ]);
    for (const t of traces) for (const e of t.result.edges) ws.addRow({ label: t.label, dir: t.direction === 'forward' ? 'Forward' : 'Backward', depth: e.depth + 1, ts: dt(e.ts), from: lab(e.from), to: lab(e.to), amt: e.amount, tr: e.traced, id: e.txnId });
  }

  // ---- 8) คุณภาพข้อมูล / Audit ----
  {
    const ws = sheet('ไฟล์และคุณภาพข้อมูล', [
      { header: 'ไฟล์', key: 'name', width: 40 }, { header: 'ชนิด', key: 'type', width: 14 }, { header: 'บัญชีเจ้าของ', key: 'owner', width: 30 }, { header: 'ขนาด (ไบต์)', key: 'size', width: 14 },
      { header: 'SHA-256', key: 'sha', width: 68 }, { header: 'แถวทั้งหมด', key: 'tot', width: 11 }, { header: 'นำเข้า', key: 'imp', width: 9 }, { header: 'ข้าม', key: 'skip', width: 8 }, { header: 'ซ้ำที่ตัด', key: 'dup', width: 9 },
      { header: 'ช่วงเวลา', key: 'range', width: 30 }, { header: 'ยอดคงเหลือตรวจ', key: 'bc', width: 12 }, { header: 'ไม่ต่อเนื่อง', key: 'bm', width: 11 }, { header: 'คำเตือน', key: 'warn', width: 70 },
    ]);
    for (const f of d.files) {
      const sf = st.files.find((x) => x.record.id === f.id);
      ws.addRow({
        name: f.name, type: f.type, owner: sf ? `${formatAccountNumber(sf.owner.number)} ${sf.owner.name ?? ''}` : '', size: f.size, sha: f.sha256, tot: f.rowsTotal, imp: f.rowsImported, skip: f.rowsSkipped, dup: f.duplicatesRemoved,
        range: f.firstTs !== undefined ? `${formatTs(f.firstTs, false)} – ${formatTs(f.lastTs!, false)}` : '', bc: f.balanceChecks?.checked ?? 0, bm: f.balanceChecks?.mismatches ?? 0, warn: f.warnings.join('; '),
      });
    }
    ws.addRow([]);
    ws.addRow(['พารามิเตอร์การวิเคราะห์']).font = { ...FONT, bold: true };
    for (const [k, v] of Object.entries(st.settings)) ws.addRow([k, Array.isArray(v) ? v.join(', ') : v]);
    ws.addRow([]);
    ws.addRow(['การจับคู่เงินเข้า-ออกใช้สมมติฐาน FIFO; เวลาทั้งหมดเป็นเวลาตามที่ปรากฏใน Statement (สมมติเขตเวลาไทย)']).font = { ...FONT, italic: true };
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
