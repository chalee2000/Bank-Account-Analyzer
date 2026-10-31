import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Core, EventObject } from 'cytoscape';
import { accounts, analysis, cs, derived, go, labelOf, notify, openInspector, patchCase, route, setAccountNote, theme } from '../../state';
import { fmtInt } from '../../core/thai';
import {
  autoMinAmount, buildElements, fitInView, graphSignature, hashSignature, livePalette, loadCytoscape, makeStyle, netOptionsFromView, ownerRing,
  planLayout, runLayoutPlan, snapshotPositions, updateElementsInPlace, type Insets, type LayoutPlan, type LegendItem,
} from '../network/graph';
import { Empty, Field, Modal, Seg, saveBlob } from '../common';
import { Icon } from '../icons';
import { PersonModal } from '../PersonEditor';
import { DEFAULT_NETWORK_OPTIONS, newId, type LayoutMode, type NetworkViewOptions } from '../../store/model';
import type { ManualNode } from '../../core/types';

interface NodeMenu { id: string; x: number; y: number }

const MIN_OPTIONS = [0, 1_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];
const LAYOUTS: { value: LayoutMode; label: string }[] = [{ value: 'auto', label: 'อัตโนมัติ' }, { value: 'concentric', label: 'วงซ้อน: เจ้าของอยู่กลาง' }];

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
  // ตัวกรอง + รูปแบบการจัดผัง: เริ่มจากที่บันทึกในคดี (เปิดหน้าใหม่ได้มุมมองเดิม และรายงานใช้มุมมองเดียวกัน)
  const [opt, setOptState] = useState<NetworkViewOptions>(() => ({ ...DEFAULT_NETWORK_OPTIONS, ...st.networkView?.options }));
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => st.networkView?.layout ?? 'auto');
  const setOpt = (p: Partial<NetworkViewOptions>) => setOptState((o) => ({ ...o, ...p }));
  const { scope, topPerOwner, colorBy, showCash, showManual } = opt;
  const from = opt.from ?? '';
  const to = opt.to ?? '';
  const allMin = opt.allMin ?? (res ? autoMinAmount(res) : 0);
  const [panelOpen, setPanelOpen] = useState(typeof window !== 'undefined' ? window.innerWidth > 720 : true);
  const [modal, setModal] = useState<'node' | 'link' | null>(null);
  const [menu, setMenu] = useState<NodeMenu | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const sigRef = useRef('');
  const focus = params.get('focus');

  const built = useMemo(() => {
    if (!res || !d) return null;
    return buildElements(d, res, st, { ...netOptionsFromView(opt, res), focus: focus ? focus.split(',').filter(Boolean) : undefined }, livePalette());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, d, st.manualNodes, st.manualLinks, st.accountNotes, opt, focus, theme.value]);
  const builtHash = useMemo(() => (built ? hashSignature(built.elements) : ''), [built]);

  // ค่าล่าสุดสำหรับ handler ของ Cytoscape (ผูกครั้งเดียวตอนสร้าง)
  const live = useRef({ mode: layoutMode, opt, focus, hash: builtHash });
  live.current = { mode: layoutMode, opt, focus, hash: builtHash };

  /** บันทึกตำแหน่งทุกจุดของรูปแบบปัจจุบันลงคดี (ไม่บันทึกมุมมองชั่วคราวจาก "ดูในเครือข่าย") */
  const persistPositions = (manual: boolean) => {
    const cy = cyRef.current;
    const c = cs.peek();
    const L = live.current;
    if (!cy || !c || L.focus || cy.nodes().empty()) return;
    const snap = snapshotPositions(cy, L.hash, manual);
    const positions = { ...(c.networkView?.positions ?? {}) };
    if (snap) positions[L.mode] = snap;
    else delete positions[L.mode];
    void patchCase({ networkView: { layout: L.mode, options: L.opt, positions } });
  };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // บันทึกตัวกรอง/รูปแบบเมื่อเปลี่ยน (หน่วงเล็กน้อย ไม่เขียนถ้าเท่าเดิม)
  useEffect(() => {
    const c = cs.peek();
    if (!c) return;
    const prev = c.networkView;
    const same = prev ? prev.layout === layoutMode && JSON.stringify(prev.options) === JSON.stringify(opt)
      : layoutMode === 'auto' && JSON.stringify(opt) === JSON.stringify(DEFAULT_NETWORK_OPTIONS);
    if (same) return;
    const t = setTimeout(() => {
      const cur = cs.peek();
      if (cur) void patchCase({ networkView: { layout: layoutMode, options: opt, positions: cur.networkView?.positions } });
    }, 400);
    return () => clearTimeout(t);
  }, [opt, layoutMode]);

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
      (host.current as HTMLDivElement & { __cy?: Core }).__cy = cy; // ให้ e2e หาตำแหน่งจุดบนผังได้
      // คลิกขวา (เมาส์) หรือกดค้าง (จอสัมผัส) ที่จุดบัญชี → เมนูตั้งชื่อ/ใส่รูป
      let heldAt = 0;
      const openMenu = (ev: EventObject) => {
        const id = ev.target.id() as string;
        if (accounts.value[id]?.kind !== 'account') return;
        if (ev.type === 'taphold') heldAt = Date.now();
        const p = ev.renderedPosition ?? ev.target.renderedPosition();
        setMenu({ id, x: p.x, y: p.y });
      };
      cy.on('cxttap', 'node', openMenu);
      cy.on('taphold', 'node', openMenu);
      cy.on('tap', () => setMenu(null));
      cy.on('viewport', () => setMenu(null));
      cy.on('tap', 'node', (ev) => {
        if (Date.now() - heldAt < 800) return; // นิ้วที่ยกหลังกดค้างไม่นับเป็นแตะ
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
      // ลากจุดจัดเอง → จำตำแหน่งในคดี
      cy.on('dragfree', 'node', () => {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => persistPositions(true), 300);
      });
      setReady(true);
    });
    return () => { disposed = true; clearTimeout(saveTimer.current); cyRef.current = null; sigRef.current = ''; setReady(false); cy?.destroy(); };
  }, [hasData]);

  // ใส่ข้อมูลและจัดวาง — ถ้าโครงสร้างผังและรูปแบบเท่าเดิม (เช่น แค่ตั้งชื่อ/ใส่รูป/เปลี่ยนสี) แก้ข้อมูลของจุดเดิม ไม่จัดวางใหม่
  const runSeq = useRef(0);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready || !built) return;
    const sig = layoutMode + '#' + (focus ?? '') + '#' + graphSignature(built.elements);
    if (sig === sigRef.current && cy.elements().nonempty()) {
      updateElementsInPlace(cy, built.elements);
      return;
    }
    sigRef.current = sig;
    setMenu(null);
    cy.batch(() => {
      cy.elements().remove();
      cy.add(built.elements);
    });
    if (built.nodeCount === 0) return;
    const saved = cs.peek()?.networkView?.positions?.[layoutMode];
    const plan = planLayout(layoutMode, built.elements, saved);
    const my = ++runSeq.current;
    void runLayoutPlan(cy, plan, built.nodeCount).then(() => {
      if (my !== runSeq.current || cyRef.current !== cy) return;
      // ผลจัดอัตโนมัติก็บันทึกด้วย — เปิดหน้าใหม่ได้ผังเดิม และรายงานตรงกับที่เห็น; ถ้าใช้จุดเดิมบางส่วน คงสถานะ "จัดเอง" ไว้
      if (plan.kind !== 'preset') persistPositions(plan.kind === 'fcose' && plan.reused ? !!saved?.manual : false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, ready, focus, layoutMode]);

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

  /** จัดเรียงใหม่ตามรูปแบบที่เลือก และล้างตำแหน่งที่ลากเองของรูปแบบนั้น */
  const relayout = () => {
    const cy = cyRef.current;
    if (!cy || !built || built.nodeCount === 0) return;
    const plan: LayoutPlan = layoutMode === 'concentric' ? { kind: 'concentric' } : { kind: 'fcose', fixed: ownerRing(built.elements), reused: false };
    const my = ++runSeq.current;
    void runLayoutPlan(cy, plan, built.nodeCount, true).then(() => {
      if (my !== runSeq.current) return;
      fitInView(cy, viewInsets());
      persistPositions(false);
    });
  };
  const savedPos = st.networkView?.positions?.[layoutMode];
  const manualActive = !focus && !!savedPos?.manual && savedPos.sig === builtHash;
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
        <div ref={host} style="position:absolute;inset:0" role="img" aria-label="ผังเครือข่ายความเชื่อมโยงระหว่างบัญชี" onContextMenu={(e) => e.preventDefault()} />
        {menu && <NodeMenuPopup menu={menu} onClose={() => setMenu(null)} onEdit={(id) => { setMenu(null); setPersonId(id); }} />}
        <div class="net-tools" ref={toolsRef}>
          <button class="btn sm" onClick={() => setPanelOpen(!panelOpen)}><Icon name="filter" size={15} />{panelOpen ? 'ซ่อนตัวกรอง' : 'ตัวกรอง / เครื่องมือ'}</button>
          {panelOpen && (
            <div class="card stack" style="padding:12px;gap:10px">
              <Field group label="มุมมอง">
                <Seg value={scope} onChange={(v) => setOpt({ scope: v })} options={[{ value: 'core', label: 'แกนหลัก' }, { value: 'all', label: 'ทุกบัญชี' }]} />
              </Field>
              <Field group label="รูปแบบการจัดผัง">
                <Seg value={layoutMode} onChange={setLayoutMode} options={LAYOUTS} />
              </Field>
              <Field group label="ระบายสีตาม">
                <Seg value={colorBy} onChange={(v) => setOpt({ colorBy: v })} options={[{ value: 'role', label: 'บทบาท' }, { value: 'bank', label: 'ธนาคาร' }, { value: 'community', label: 'ชุมชน' }]} />
              </Field>
              {scope === 'core' ? (
                <Field label="คู่บัญชีที่แสดงต่อเจ้าของ (ยอดสูงสุด)">
                  <select class="select sm" value={topPerOwner} onChange={(e) => setOpt({ topPerOwner: Number((e.target as HTMLSelectElement).value) })}>
                    {[6, 12, 25, 50, 100].map((v) => <option value={v}>{v} บัญชี</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="ยอดโอนรวมระหว่างคู่บัญชี ≥">
                  <select class="select sm" value={allMin} onChange={(e) => setOpt({ allMin: Number((e.target as HTMLSelectElement).value) })}>
                    {[...new Set([...MIN_OPTIONS, allMin])].sort((a, b) => a - b).map((v) => <option value={v}>{v === 0 ? 'ทั้งหมด' : fmtInt(v) + ' บาท'}</option>)}
                  </select>
                </Field>
              )}
              <div class="row">
                <Field label="ตั้งแต่"><input class="input sm" type="date" value={from} onChange={(e) => setOpt({ from: (e.target as HTMLInputElement).value || undefined })} /></Field>
                <Field label="ถึง"><input class="input sm" type="date" value={to} onChange={(e) => setOpt({ to: (e.target as HTMLInputElement).value || undefined })} /></Field>
              </div>
              <label class="row small"><input type="checkbox" checked={showCash} onChange={(e) => setOpt({ showCash: (e.target as HTMLInputElement).checked })} />แสดงจุดเงินสด (ATM/สาขา)</label>
              <label class="row small"><input type="checkbox" checked={showManual} onChange={(e) => setOpt({ showManual: (e.target as HTMLInputElement).checked })} />แสดงข้อมูลที่เพิ่มเอง</label>
              <div class="row wrap">
                <button class="btn sm" onClick={fit}><Icon name="fit" size={15} />พอดีจอ</button>
                <button class="btn sm" onClick={relayout} title="จัดตามรูปแบบที่เลือก และล้างตำแหน่งที่ลากเอง"><Icon name="refresh" size={15} />จัดเรียงใหม่</button>
                <button class="btn sm" onClick={exportPng}><Icon name="image" size={15} />PNG</button>
              </div>
              <div class="row wrap">
                <button class="btn sm" onClick={() => setModal('node')}><Icon name="plus" size={15} />เพิ่มบุคคล/โทรศัพท์/ยานพาหนะ</button>
                <button class="btn sm" onClick={() => setModal('link')} disabled={!built}><Icon name="link" size={15} />เพิ่มความสัมพันธ์</button>
              </div>
              {scope === 'all' && res.pairs.length > 1500 && allMin > 0 && <div class="tiny" style="color:var(--warning)">เครือข่ายใหญ่ ({fmtInt(res.pairs.length)} คู่บัญชี) — แสดงเฉพาะคู่ที่ยอดตั้งแต่ {fmtInt(allMin)} บาทเพื่อความเร็ว ปรับได้ด้านบน</div>}
              <div class="tiny net-pos-status" data-manual={manualActive ? '1' : '0'}>
                {focus ? 'มุมมองชั่วคราวจาก “ดูในเครือข่าย” — ไม่บันทึกตำแหน่ง'
                  : manualActive ? <><Icon name="pin" size={13} /> ใช้ตำแหน่งที่จัดเอง (บันทึกในคดี ใช้ในรายงานด้วย) · กด “จัดเรียงใหม่” เพื่อจัดอัตโนมัติ</>
                  : 'ลากจุดเพื่อจัดตำแหน่งเอง ระบบจำไว้ในคดีและใช้ในรายงาน'}
              </div>
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
      {personId && <PersonModal id={personId} onClose={() => setPersonId(null)} />}
    </div>
  );
}

/** เมนูลอยของจุดบัญชี (คลิกขวา/กดค้าง) — วางที่ตำแหน่งจุด แต่ไม่ให้ล้นขอบผัง */
function NodeMenuPopup({ menu, onClose, onEdit }: { menu: NodeMenu; onClose: () => void; onEdit: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const photo = cs.value?.accountNotes[menu.id]?.photo;
  const a = accounts.value[menu.id];

  useEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (el && box) {
      setPos({
        left: Math.max(8, Math.min(menu.x + 6, box.clientWidth - el.offsetWidth - 8)),
        top: Math.max(8, Math.min(menu.y + 6, box.clientHeight - el.offsetHeight - 8)),
      });
      el.querySelector<HTMLButtonElement>('button')?.focus();
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => { if (el && !el.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true); };
  }, [menu.id, menu.x, menu.y]);

  if (!a) return null;
  const act = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <div class="ctx-menu" ref={ref} role="menu" aria-label={'เมนูของ ' + labelOf(menu.id)} style={{ left: pos.left + 'px', top: pos.top + 'px' }}>
      <div class="ctx-head ellipsis" title={labelOf(menu.id)}>{labelOf(menu.id)}</div>
      <button role="menuitem" onClick={() => onEdit(menu.id)}><Icon name="user" size={16} />{a.label || photo ? 'แก้ชื่อ-นามสกุล / รูปบุคคล…' : 'ตั้งชื่อ-นามสกุล / ใส่รูปบุคคล…'}</button>
      <button role="menuitem" onClick={act(() => openInspector({ kind: 'account', id: menu.id }))}><Icon name="info" size={16} />รายละเอียดบัญชี</button>
      <button role="menuitem" onClick={act(() => go('/transactions', { acc: menu.id }))}><Icon name="list" size={16} />ธุรกรรมของบัญชีนี้</button>
      {photo && (
        <button role="menuitem" class="danger" onClick={act(() => { void setAccountNote(menu.id, { photo: '' }).then(() => notify('ลบรูปแล้ว')); })}>
          <Icon name="trash" size={16} />ลบรูปบุคคล
        </button>
      )}
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
