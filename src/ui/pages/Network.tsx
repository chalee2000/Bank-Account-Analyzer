import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Core } from 'cytoscape';
import { accounts, analysis, cs, derived, go, labelOf, notify, openInspector, patchCase, route, theme } from '../../state';
import { fmtInt } from '../../core/thai';
import { autoMinAmount, buildElements, fitInView, layoutOptions, livePalette, loadCytoscape, makeStyle, ownerRing, type ColorBy, type Insets, type LegendItem, type Scope } from '../network/graph';
import { Empty, Field, Modal, Seg, saveBlob } from '../common';
import { Icon } from '../icons';
import { newId } from '../../store/model';
import type { ManualNode } from '../../core/types';

const MIN_OPTIONS = [0, 1_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];

export function NetworkPage() {
  const res = analysis.value;
  const d = derived.value;
  const st = cs.value!;
  const params = route.value.params;
  const host = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [ready, setReady] = useState(false);
  const [scope, setScope] = useState<Scope>('core');
  const [topPerOwner, setTopPerOwner] = useState(12);
  const [colorBy, setColorBy] = useState<ColorBy>('role');
  const [minAmount, setMinAmount] = useState(0);
  const [allMin, setAllMin] = useState(() => (analysis.value ? autoMinAmount(analysis.value) : 0));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showCash, setShowCash] = useState(true);
  const [showManual, setShowManual] = useState(true);
  const [panelOpen, setPanelOpen] = useState(typeof window !== 'undefined' ? window.innerWidth > 720 : true);
  const [modal, setModal] = useState<'node' | 'link' | null>(null);
  const focus = params.get('focus');

  const built = useMemo(() => {
    if (!res || !d) return null;
    return buildElements(d, res, st, {
      scope, topPerOwner, minAmount: scope === 'all' ? allMin : minAmount, colorBy, showCash, showManual,
      focus: focus ? focus.split(',').filter(Boolean) : undefined,
      from: from ? Date.parse(from + 'T00:00:00Z') : undefined,
      to: to ? Date.parse(to + 'T23:59:59Z') : undefined,
    }, livePalette());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, d, st.manualNodes, st.manualLinks, scope, topPerOwner, minAmount, allMin, colorBy, showCash, showManual, from, to, focus, theme.value]);

  /** พื้นที่ที่แผงเครื่องมือ/คำอธิบายสีลอยทับ — ใช้เว้นขอบตอนจัดผังให้พอดี (จอแคบ: แผงเต็มความกว้าง จึงเว้นด้านบนแทน) */
  const viewInsets = (): Insets => {
    const w = host.current?.clientWidth ?? 1000;
    const tools = toolsRef.current;
    const legendH = (legendRef.current?.offsetHeight ?? 0) + 24;
    if (w < 720) return { top: tools ? Math.min(tools.offsetHeight + 16, 320) : 16, right: 12, bottom: legendH, left: 12 };
    return { top: 16, right: 16, bottom: legendH, left: (tools?.offsetWidth ?? 0) + 28 };
  };

  // สร้าง cytoscape — ต้องรอให้ข้อมูลพร้อม (host ถูก render) ไม่เช่นนั้นเมื่อเปิดหน้านี้ก่อนวิเคราะห์เสร็จจะไม่มีผังขึ้นเลย
  const hasData = !!res && !!d;
  useEffect(() => {
    if (!hasData) return;
    let disposed = false;
    let cy: Core | null = null;
    void loadCytoscape().then((cytoscape) => {
      if (disposed || !host.current) return;
      cy = cytoscape({ container: host.current, elements: [], style: makeStyle(livePalette()), wheelSensitivity: 0.25, minZoom: 0.05, maxZoom: 4 });
      cyRef.current = cy;
      cy.on('tap', 'node', (ev) => {
        const n = ev.target;
        cy!.elements().removeClass('hl faded');
        const nb = n.closedNeighborhood();
        cy!.elements().not(nb).addClass('faded');
        nb.addClass('hl');
        const id = n.id() as string;
        if (id.startsWith('m:')) return;
        if (id.startsWith('agg:')) { go('/transactions', { acc: n.data('owner') as string }); return; }
        if (accounts.value[id]?.kind === 'account') openInspector({ kind: 'account', id });
      });
      cy.on('mouseover', 'node', (ev) => { ev.target.addClass('hov'); });
      cy.on('mouseout', 'node', (ev) => { ev.target.removeClass('hov'); });
      cy.on('tap', (ev) => {
        if (ev.target === cy) cy!.elements().removeClass('hl faded');
      });
      cy.on('tap', 'edge', (ev) => {
        const e = ev.target;
        if (e.hasClass('manual-link')) return;
        go('/transactions', { acc: e.source().id(), to: e.target().id() });
      });
      cy.on('mouseover', 'edge', (ev) => { if (!ev.target.hasClass('faded')) ev.target.addClass('hl'); });
      cy.on('mouseout', 'edge', (ev) => { ev.target.removeClass('hl'); });
      setReady(true);
    });
    return () => { disposed = true; cyRef.current = null; setReady(false); cy?.destroy(); };
  }, [hasData]);

  // ใส่ข้อมูลและจัดวาง
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready || !built) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(built.elements);
    });
    if (built.nodeCount === 0) return;
    const layout = cy.layout(layoutOptions(built.nodeCount, false, ownerRing(built.elements)) as never);
    layout.one('layoutstop', () => {
      if (focus) {
        const ids = focus.split(',').filter((x) => cy.getElementById(x).nonempty());
        if (ids.length) {
          const col = cy.nodes().filter((n) => ids.includes(n.id()));
          cy.elements().addClass('faded');
          const nb = col.closedNeighborhood();
          nb.removeClass('faded');
          col.addClass('hl');
          fitInView(cy, viewInsets(), nb);
          return;
        }
      }
      fitInView(cy, viewInsets());
    });
    layout.run();
  }, [built, ready, focus]);

  // เปิด/ปิดแผงเครื่องมือแล้วจัดผังให้พอดีพื้นที่ใหม่
  const firstPanel = useRef(true);
  useEffect(() => {
    if (firstPanel.current) { firstPanel.current = false; return; }
    const cy = cyRef.current;
    if (cy && ready) fitInView(cy, viewInsets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  // เปลี่ยนธีม
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const t = setTimeout(() => cy.style(makeStyle(livePalette()) as never), 30);
    return () => clearTimeout(t);
  }, [theme.value, ready]);

  if (!res || !d) return <Empty title="ยังไม่มีข้อมูล" icon="network">นำเข้า Statement ก่อน</Empty>;

  const relayout = () => cyRef.current?.layout(layoutOptions(built?.nodeCount ?? 0, true, built ? ownerRing(built.elements) : []) as never).run();
  const fit = () => { if (cyRef.current) fitInView(cyRef.current, viewInsets()); };
  const exportPng = async () => {
    const cy = cyRef.current;
    if (!cy) return;
    const uri = cy.png({ output: 'base64uri', scale: 2, bg: livePalette().surface, full: true }) as string;
    const blob = await (await fetch(uri)).blob();
    await saveBlob(blob, `network_${st.meta.caseNumber ?? 'case'}.png`.replace(/[\\/:*?"<>|\s]/g, '_'));
  };

  return (
    <div class="net-wrap">
      <div class="net-canvas">
        <div ref={host} style="position:absolute;inset:0" role="img" aria-label="ผังเครือข่ายความเชื่อมโยงระหว่างบัญชี" />
        <div class="net-tools" ref={toolsRef}>
          <button class="btn sm" onClick={() => setPanelOpen(!panelOpen)}><Icon name="filter" size={15} />{panelOpen ? 'ซ่อนตัวกรอง' : 'ตัวกรอง / เครื่องมือ'}</button>
          {panelOpen && (
            <div class="card stack" style="padding:12px;gap:10px">
              <Field label="มุมมอง">
                <Seg value={scope} onChange={setScope} options={[{ value: 'core', label: 'แกนหลัก' }, { value: 'all', label: 'ทุกบัญชี' }]} />
              </Field>
              <Field label="ระบายสีตาม">
                <Seg value={colorBy} onChange={setColorBy} options={[{ value: 'role', label: 'บทบาท' }, { value: 'bank', label: 'ธนาคาร' }, { value: 'community', label: 'ชุมชน' }]} />
              </Field>
              {scope === 'core' ? (
                <Field label="คู่บัญชีที่แสดงต่อเจ้าของ (ยอดสูงสุด)">
                  <select class="select sm" value={topPerOwner} onChange={(e) => setTopPerOwner(Number((e.target as HTMLSelectElement).value))}>
                    {[6, 12, 25, 50, 100].map((v) => <option value={v}>{v} บัญชี</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="ยอดโอนรวมระหว่างคู่บัญชี ≥">
                  <select class="select sm" value={allMin} onChange={(e) => setAllMin(Number((e.target as HTMLSelectElement).value))}>
                    {[...new Set([...MIN_OPTIONS, allMin])].sort((a, b) => a - b).map((v) => <option value={v}>{v === 0 ? 'ทั้งหมด' : fmtInt(v) + ' บาท'}</option>)}
                  </select>
                </Field>
              )}
              <div class="row">
                <Field label="ตั้งแต่"><input class="input sm" type="date" value={from} onChange={(e) => setFrom((e.target as HTMLInputElement).value)} /></Field>
                <Field label="ถึง"><input class="input sm" type="date" value={to} onChange={(e) => setTo((e.target as HTMLInputElement).value)} /></Field>
              </div>
              <label class="row small"><input type="checkbox" checked={showCash} onChange={(e) => setShowCash((e.target as HTMLInputElement).checked)} />แสดงจุดเงินสด (ATM/สาขา)</label>
              <label class="row small"><input type="checkbox" checked={showManual} onChange={(e) => setShowManual((e.target as HTMLInputElement).checked)} />แสดงข้อมูลที่เพิ่มเอง</label>
              <div class="row wrap">
                <button class="btn sm" onClick={fit}><Icon name="fit" size={15} />พอดีจอ</button>
                <button class="btn sm" onClick={relayout}><Icon name="refresh" size={15} />จัดเรียงใหม่</button>
                <button class="btn sm" onClick={exportPng}><Icon name="image" size={15} />PNG</button>
              </div>
              <div class="row wrap">
                <button class="btn sm" onClick={() => setModal('node')}><Icon name="plus" size={15} />เพิ่มบุคคล/โทรศัพท์/ยานพาหนะ</button>
                <button class="btn sm" onClick={() => setModal('link')} disabled={!built}><Icon name="link" size={15} />เพิ่มความสัมพันธ์</button>
              </div>
              {scope === 'all' && res.pairs.length > 1500 && allMin > 0 && <div class="tiny" style="color:var(--warning)">เครือข่ายใหญ่ ({fmtInt(res.pairs.length)} คู่บัญชี) — แสดงเฉพาะคู่ที่ยอดตั้งแต่ {fmtInt(allMin)} บาทเพื่อความเร็ว ปรับได้ด้านบน</div>}
              {built && <div class="small secondary">{built.summary}</div>}
              <div class="tiny muted">{built ? `${fmtInt(built.nodeCount)} จุด · ${fmtInt(built.edgeCount)} เส้น` : ''} · แตะจุดเพื่อดูรายละเอียด แตะเส้นเพื่อดูธุรกรรม · แตะจุดเส้นประเพื่อดูธุรกรรมของคู่บัญชีที่รวมไว้ · ชี้ที่จุดเพื่ออ่านชื่อเต็ม · ขนาดจุดตามยอดเงินรวม ความหนาเส้นตามยอดโอน</div>
            </div>
          )}
        </div>
        {built && built.legend.length > 0 && (
          <div class="net-legend card" ref={legendRef} style="padding:8px 12px">
            <div class="legend">{built.legend.map((l) => <span key={l.label}><Swatch item={l} />{l.label}</span>)}</div>
          </div>
        )}
        {built?.nodeCount === 0 && <div class="empty" style="position:absolute;inset:0">ไม่มีจุดที่ตรงกับตัวกรอง</div>}
      </div>
      {modal === 'node' && <NodeModal onClose={() => setModal(null)} />}
      {modal === 'link' && <LinkModal onClose={() => setModal(null)} />}
    </div>
  );
}

function Swatch({ item }: { item: LegendItem }) {
  return <i class={'sw ' + item.shape} style={{ '--c': item.color }} />;
}

const NODE_TYPES: { value: ManualNode['type']; label: string }[] = [
  { value: 'person', label: 'บุคคล' }, { value: 'phone', label: 'หมายเลขโทรศัพท์' }, { value: 'vehicle', label: 'ยานพาหนะ' },
  { value: 'device', label: 'อุปกรณ์/IMEI/IP' }, { value: 'location', label: 'สถานที่' }, { value: 'other', label: 'อื่น ๆ' },
];

function NodeModal({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<ManualNode['type']>('person');
  const [note, setNote] = useState('');
  return (
    <Modal title="เพิ่มจุดข้อมูลที่ได้จากหลักฐานอื่น" onClose={onClose} footer={<>
      <button class="btn" onClick={onClose}>ยกเลิก</button>
      <button class="btn primary" disabled={!label.trim()} onClick={async () => { await patchCase({ manualNodes: [...cs.value!.manualNodes, { id: newId('n_'), type, label: label.trim(), note: note.trim() || undefined }] }); notify('เพิ่มจุดแล้ว'); onClose(); }}>เพิ่ม</button>
    </>}>
      <div class="stack">
        <Field label="ชนิด"><select class="select" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as ManualNode['type'])}>{NODE_TYPES.map((t) => <option value={t.value}>{t.label}</option>)}</select></Field>
        <Field label="ชื่อ / หมายเลข *"><input class="input" value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} autofocus /></Field>
        <Field label="ที่มา / หมายเหตุ"><textarea class="textarea" rows={3} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} placeholder="เช่น ได้จาก KYC เลขที่เอกสาร …" /></Field>
        <div class="tiny muted">จุดที่เพิ่มเองเป็นข้อมูลที่ผู้สืบสวนบันทึกจากหลักฐานอื่น ระบบไม่ได้ตรวจสอบความถูกต้อง</div>
      </div>
    </Modal>
  );
}

function LinkModal({ onClose }: { onClose: () => void }) {
  const st = cs.value!;
  const options = [
    ...Object.values(accounts.value).filter((a) => a.kind === 'account').map((a) => ({ id: a.id, label: labelOf(a.id) })),
    ...st.manualNodes.map((n) => ({ id: n.id, label: `[${NODE_TYPES.find((t) => t.value === n.type)?.label}] ${n.label}` })),
  ];
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [label, setLabel] = useState('');
  return (
    <Modal title="เพิ่มความสัมพันธ์" onClose={onClose} footer={<>
      <button class="btn" onClick={onClose}>ยกเลิก</button>
      <button class="btn primary" disabled={!a || !b || a === b || !label.trim()} onClick={async () => { await patchCase({ manualLinks: [...cs.value!.manualLinks, { id: newId('l_'), a, b, label: label.trim() }] }); notify('เพิ่มความสัมพันธ์แล้ว'); onClose(); }}>เพิ่ม</button>
    </>}>
      <div class="stack">
        <Field label="จาก"><select class="select" value={a} onChange={(e) => setA((e.target as HTMLSelectElement).value)}><option value="">— เลือก —</option>{options.map((o) => <option value={o.id}>{o.label}</option>)}</select></Field>
        <Field label="ถึง"><select class="select" value={b} onChange={(e) => setB((e.target as HTMLSelectElement).value)}><option value="">— เลือก —</option>{options.map((o) => <option value={o.id}>{o.label}</option>)}</select></Field>
        <Field label="ความสัมพันธ์ *"><input class="input" value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} placeholder="เช่น เจ้าของบัญชีตาม KYC, ใช้โทรศัพท์เครื่องนี้, พบร่วมกันใน CCTV" /></Field>
      </div>
    </Modal>
  );
}
