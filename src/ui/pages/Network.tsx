import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Core, EventObject } from 'cytoscape';
import { accounts, analysis, cs, derived, go, labelOf, notify, openInspector, patchCase, route, setAccountNote, theme } from '../../state';
import { fmtBaht, fmtInt } from '../../core/thai';
import {
  autoMinAmount, buildElements, fitInView, graphSignature, hashSignature, livePalette, loadCytoscape, makeStyle, netOptionsFromView, ownerRing,
  flowGlyphs, planLayout, runLayoutPlan, snapshotPositions, syncNotes, updateElementsInPlace, type Insets, type LayoutPlan, type LegendItem,
} from '../network/graph';
import { Empty, Field, Modal, Seg, saveBlob } from '../common';
import { Icon } from '../icons';
import { PersonModal } from '../PersonEditor';
import { placeMenu } from '../placeMenu';
import { DEFAULT_NETWORK_OPTIONS, newId, type LayoutMode, type NetNote, type NetworkView, type NetworkViewOptions } from '../../store/model';
import type { ManualNode } from '../../core/types';

interface NodeMenu { id: string; x: number; y: number }
/** เมนูคลิกขวาที่พื้นที่ว่าง (edge = เมนูที่เปิดจากเส้น) / ที่โน้ต — x,y เป็นพิกัดบนจอในผัง, model เป็นพิกัดของผัง */
type CanvasMenuState = { x: number; y: number; model: { x: number; y: number }; edge?: string };
type NoteMenuState = { id: string; x: number; y: number };
type NoteEdit = { id?: string; text: string; model?: { x: number; y: number } };

const MIN_OPTIONS = [0, 1_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];
/** label = ชื่อเต็ม (เมนูคลิกขวา), short = ชื่อบนปุ่มในแผงเครื่องมือ, hint = คำอธิบายใต้ปุ่ม */
const LAYOUTS: { value: LayoutMode; label: string; short: string; hint: string }[] = [
  { value: 'auto', label: 'อัตโนมัติ', short: 'อัตโนมัติ', hint: 'จัดตามแรงดึงดูด เจ้าของ Statement วางบนวงรี' },
  { value: 'concentric', label: 'วงซ้อน: เจ้าของอยู่กลาง', short: 'วงซ้อน', hint: 'เจ้าของ Statement วงใน บัญชีร่วมวงถัดมา คู่บัญชีวงนอก' },
  { value: 'flow', label: 'ผังไหลเงิน: เส้นมุมฉาก', short: 'ผังไหลเงิน', hint: 'ผู้โอนเข้าซ้าย → บัญชีเจ้าของ/ทางผ่านเป็นขั้นบันได → ผู้รับขวา เส้นหักมุมฉาก' },
];

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
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState | null>(null);
  const [noteMenu, setNoteMenu] = useState<NoteMenuState | null>(null);
  const [noteEdit, setNoteEdit] = useState<NoteEdit | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  /** โหมดมือ (ลากพื้นที่ว่าง = เลื่อนผัง) / โหมดเลือก (ลากพื้นที่ว่าง = กรอบเลือกหลายจุด) */
  const [handMode, setHandMode] = useState(true);
  const closeMenus = () => { setMenu(null); setCanvasMenu(null); setNoteMenu(null); };
  const sigRef = useRef('');
  const focus = params.get('focus');

  const built = useMemo(() => {
    if (!res || !d) return null;
    return buildElements(d, res, st, { ...netOptionsFromView(opt, res), focus: focus ? focus.split(',').filter(Boolean) : undefined, flow: layoutMode === 'flow' }, livePalette());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, d, st.manualNodes, st.manualLinks, st.accountNotes, opt, focus, theme.value, layoutMode]);
  /** เลือกรูปแบบการจัดผัง — ผังไหลเงินเปิดป้ายบนเส้นให้ (ถ้ายังปิดอยู่) ให้เห็นยอด/จำนวนครั้ง/ทิศทางแบบผังไหลเงินทั่วไป */
  const chooseLayout = (m: LayoutMode) => {
    setLayoutMode(m);
    if (m === 'flow' && (opt.edgeLabels ?? 'off') === 'off') setOpt({ edgeLabels: 'plain' });
  };
  const builtHash = useMemo(() => (built ? hashSignature(built.elements) : ''), [built]);

  // ค่าล่าสุดสำหรับ handler ของ Cytoscape (ผูกครั้งเดียวตอนสร้าง)
  const live = useRef({ mode: layoutMode, opt, focus, hash: builtHash });
  live.current = { mode: layoutMode, opt, focus, hash: builtHash };

  /** บันทึกมุมมองลงคดี โดยคงส่วนที่ไม่ได้แก้ (ตำแหน่ง โน้ต) ไว้ */
  const saveView = (patch: Partial<NetworkView>) => {
    const c = cs.peek();
    if (!c) return;
    const L = live.current;
    void patchCase({ networkView: { ...(c.networkView ?? {}), layout: L.mode, options: L.opt, ...patch } });
  };
  const notesNow = (): NetNote[] => cs.peek()?.networkView?.notes ?? [];
  /** ตำแหน่งทุกจุดของรูปแบบปัจจุบัน (ไม่บันทึกมุมมองชั่วคราวจาก "ดูในเครือข่าย") */
  const positionsPatch = (manual: boolean): Partial<NetworkView> | null => {
    const cy = cyRef.current;
    const c = cs.peek();
    const L = live.current;
    if (!cy || !c || L.focus || cy.nodes().not('.note').empty()) return null;
    const snap = snapshotPositions(cy, L.hash, manual);
    const positions = { ...(c.networkView?.positions ?? {}) };
    if (snap) positions[L.mode] = snap;
    else delete positions[L.mode];
    return { positions };
  };
  const persistPositions = (manual: boolean) => { const p = positionsPatch(manual); if (p) saveView(p); };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragged = useRef({ nodes: false, notes: new Set<string>() });
  /** หลังลากเสร็จ: จุดที่ลาก → ตำแหน่งที่จัดเอง; โน้ตที่ลาก → ตำแหน่งของโน้ตในรูปแบบนี้ */
  const flushDrag = () => {
    const cy = cyRef.current;
    const { nodes, notes } = dragged.current;
    dragged.current = { nodes: false, notes: new Set() };
    const patch: Partial<NetworkView> = { ...(nodes ? positionsPatch(true) ?? {} : {}) };
    if (notes.size && cy) {
      const mode = live.current.mode;
      patch.notes = notesNow().map((nt) => (notes.has(nt.id) ? { ...nt, pos: { ...nt.pos, [mode]: { ...cy.getElementById('note:' + nt.id).position() } } } : nt));
    }
    if (Object.keys(patch).length) saveView(patch);
  };

  // บันทึกตัวกรอง/รูปแบบเมื่อเปลี่ยน (หน่วงเล็กน้อย ไม่เขียนถ้าเท่าเดิม)
  useEffect(() => {
    const c = cs.peek();
    if (!c) return;
    const prev = c.networkView;
    const same = prev ? prev.layout === layoutMode && JSON.stringify(prev.options) === JSON.stringify(opt)
      : layoutMode === 'auto' && JSON.stringify(opt) === JSON.stringify(DEFAULT_NETWORK_OPTIONS);
    if (same) return;
    const t = setTimeout(() => saveView({}), 400);
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
      // คลิกขวา (เมาส์) หรือกดค้าง (จอสัมผัส): จุดบัญชี → เมนูตั้งชื่อ/ใส่รูป; พื้นที่ว่าง/เส้น → เมนูผัง; โน้ต → แก้/ลบ
      // บนจอสัมผัส การยกนิ้วหลังกดค้างจะเกิด "tap" ตามมา — ไม่นับ tap นั้น ไม่เช่นนั้นเมนูจะปิดทันที
      let heldAt = 0;
      const held = () => Date.now() - heldAt < 800;
      const at = (ev: EventObject) => {
        if (ev.type === 'taphold') heldAt = Date.now();
        const p = ev.renderedPosition ?? ev.target.renderedPosition?.() ?? { x: 0, y: 0 };
        return { x: p.x, y: p.y };
      };
      const openMenu = (ev: EventObject) => {
        const id = ev.target.id() as string;
        if (accounts.value[id]?.kind !== 'account') return;
        closeMenus();
        setMenu({ id, ...at(ev) });
      };
      const openCanvas = (ev: EventObject, edge?: string) => {
        closeMenus();
        const p = at(ev);
        setCanvasMenu({ ...p, model: { ...(ev.position ?? { x: 0, y: 0 }) }, edge });
      };
      const openNote = (ev: EventObject) => { closeMenus(); setNoteMenu({ id: (ev.target.id() as string).slice(5), ...at(ev) }); };
      cy.on('cxttap', 'node', openMenu);
      cy.on('taphold', 'node', openMenu);
      cy.on('cxttap taphold', (ev) => { if (ev.target === cy) openCanvas(ev); });
      cy.on('cxttap taphold', 'edge', (ev) => openCanvas(ev, ev.target.id() as string));
      cy.on('cxttap taphold', 'node.note', openNote);
      cy.on('dbltap', 'node.note', (ev) => {
        const nt = notesNow().find((x) => 'note:' + x.id === ev.target.id());
        if (nt) setNoteEdit({ id: nt.id, text: nt.text });
      });
      cy.on('tap', () => { if (!held()) closeMenus(); });
      cy.on('viewport', () => closeMenus());
      cy.on('tap', 'node', (ev) => {
        if (held()) return; // นิ้วที่ยกหลังกดค้างไม่นับเป็นแตะ
        if (ev.target.hasClass('note')) return;
        const n = ev.target;
        cy!.elements().removeClass('hl faded');
        const nb = n.closedNeighborhood();
        cy!.elements().not(nb).not('.note').addClass('faded');
        nb.addClass('hl');
        const id = n.id() as string;
        if (id.startsWith('m:')) return;
        if (id.startsWith('agg:')) { go('/transactions', { acc: n.data('owner') as string }); return; }
        if (accounts.value[id]?.kind === 'account') openInspector({ kind: 'account', id });
      });
      cy.on('mouseover', 'node', (ev) => { if (!ev.target.hasClass('note')) ev.target.addClass('hov'); });
      cy.on('mouseout', 'node', (ev) => { ev.target.removeClass('hov'); });
      cy.on('tap', (ev) => {
        if (ev.target === cy) cy!.elements().removeClass('hl faded');
      });
      cy.on('tap', 'edge', (ev) => {
        const e = ev.target;
        if (held() || e.hasClass('manual-link')) return;
        if (e.hasClass('agg-edge')) { go('/transactions', { acc: (e.source().data('owner') ?? e.target().data('owner') ?? e.source().id()) as string }); return; }
        go('/transactions', { acc: e.source().id(), to: e.target().id() });
      });
      cy.on('mouseover', 'edge', (ev) => { if (!ev.target.hasClass('faded')) ev.target.addClass('hl'); });
      cy.on('mouseout', 'edge', (ev) => { ev.target.removeClass('hl'); });
      // ลากจุด/โน้ตจัดเอง → จำตำแหน่งในคดี (ลากหลายจุดที่เลือกพร้อมกันก็บันทึกครั้งเดียว)
      cy.on('dragfree', 'node', (ev) => {
        const n = ev.target;
        if (n.hasClass('note')) dragged.current.notes.add((n.id() as string).slice(5));
        else { dragged.current.nodes = true; flowGlyphs(cy!); }
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(flushDrag, 300);
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
      flowGlyphs(cy);
      return;
    }
    sigRef.current = sig;
    closeMenus();
    cy.batch(() => {
      cy.elements().remove();
      cy.add(built.elements);
    });
    syncNotes(cy, notesNow(), layoutMode);
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
          cy.elements().not('.note').addClass('faded');
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

  // โน้ตเปลี่ยน (เพิ่ม/แก้/ลบ/ลาก) หรือเปลี่ยนรูปแบบ → ซิงก์โน้ตบนผัง
  const notesKey = st.networkView?.notes;
  useEffect(() => {
    const cy = cyRef.current;
    if (cy && ready) syncNotes(cy, notesKey, layoutMode);
  }, [notesKey, ready, layoutMode]);

  // โหมดมือ/โหมดเลือก
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.userPanningEnabled(handMode);
    cy.boxSelectionEnabled(true); // โหมดมือ: กด Shift/Ctrl ค้างแล้วลากก็ยังเลือกเป็นกรอบได้
  }, [handMode, ready]);

  // ปุ่มลัด: Ctrl/⌘+A เลือกทั้งหมด, H สลับโหมดมือ, Esc ยกเลิกการเลือก — ไม่ทำงานขณะพิมพ์หรือมีหน้าต่างเปิด
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('.overlay')) return;
      const cy = cyRef.current;
      if (!cy) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') { e.preventDefault(); cy.nodes().select(); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyH') setHandMode((h) => !h);
      else if (e.key === 'Escape') cy.elements().unselect();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    const plan: LayoutPlan = layoutMode === 'concentric' ? { kind: 'concentric' } : layoutMode === 'flow' ? { kind: 'flow' } : { kind: 'fcose', fixed: ownerRing(built.elements), reused: false };
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
      {/* คลิกขวาที่ใดในพื้นที่ผังก็ไม่ให้เมนูของเบราว์เซอร์ขึ้น (ยกเว้นช่องกรอกข้อความ ให้ยังคัดลอก/วางได้) */}
      <div class="net-canvas" onContextMenu={(e) => { if (!(e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) e.preventDefault(); }}>
        <div ref={host} style="position:absolute;inset:0" role="img" aria-label="ผังเครือข่ายความเชื่อมโยงระหว่างบัญชี" onContextMenu={(e) => e.preventDefault()} />
        {menu && <NodeMenuPopup menu={menu} onClose={() => setMenu(null)} onEdit={(id) => { setMenu(null); setPersonId(id); }} />}
        {canvasMenu && (
          <CanvasMenu
            menu={canvasMenu} cy={cyRef.current} opt={opt} handMode={handMode} layoutMode={layoutMode} onClose={() => setCanvasMenu(null)}
            actions={{
              addNote: () => setNoteEdit({ text: '', model: canvasMenu.model }),
              toggleLabels: (m) => setOpt({ edgeLabels: opt.edgeLabels === m ? 'off' : m }),
              togglePin: (key) => { const list = opt.pinnedEdges ?? []; setOpt({ pinnedEdges: list.includes(key) ? list.filter((k) => k !== key) : [...list, key] }); },
              selectAll: () => cyRef.current?.nodes().select(),
              toggleHand: () => setHandMode((h) => !h),
              setLayout: chooseLayout,
              relayout,
              fit,
              toggleBadges: () => setOpt({ bankBadges: !opt.bankBadges }),
            }}
          />
        )}
        {noteMenu && (
          <FloatingMenu x={noteMenu.x} y={noteMenu.y} label="เมนูของข้อความบนผัง" onClose={() => setNoteMenu(null)}>
            <div class="ctx-head">ข้อความบนผัง</div>
            <button role="menuitem" onClick={() => { const nt = notesNow().find((x) => x.id === noteMenu.id); setNoteMenu(null); if (nt) setNoteEdit({ id: nt.id, text: nt.text }); }}><Icon name="edit" size={16} />แก้ข้อความ…</button>
            <button role="menuitem" class="danger" onClick={() => { setNoteMenu(null); saveView({ notes: notesNow().filter((x) => x.id !== noteMenu.id) }); notify('ลบข้อความแล้ว'); }}><Icon name="trash" size={16} />ลบข้อความ</button>
          </FloatingMenu>
        )}
        {!handMode && (
          <div class="net-mode" role="status">โหมดเลือก: ลากกรอบเพื่อเลือกหลายจุด แล้วลากจุดใดก็ได้เพื่อย้ายพร้อมกัน<button onClick={() => setHandMode(true)}>กลับโหมดมือ (H)</button></div>
        )}
        <div class="net-tools" ref={toolsRef}>
          <button class="btn sm" onClick={() => setPanelOpen(!panelOpen)}><Icon name="filter" size={15} />{panelOpen ? 'ซ่อนตัวกรอง' : 'ตัวกรอง / เครื่องมือ'}</button>
          {panelOpen && (
            <div class="card stack" style="padding:12px;gap:10px">
              <Field group label="มุมมอง">
                <Seg value={scope} onChange={(v) => setOpt({ scope: v })} options={[{ value: 'core', label: 'แกนหลัก' }, { value: 'all', label: 'ทุกบัญชี' }]} />
              </Field>
              <Field group label="รูปแบบการจัดผัง">
                <Seg value={layoutMode} onChange={chooseLayout} options={LAYOUTS.map((l) => ({ value: l.value, label: l.short }))} />
                <div class="tiny muted">{LAYOUTS.find((l) => l.value === layoutMode)?.hint}</div>
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
              <div class="tiny muted">{built ? `${fmtInt(built.nodeCount)} จุด · ${fmtInt(built.edgeCount)} เส้น` : ''} · คลิกขวา (หรือกดค้าง) ที่จุด เส้น หรือพื้นที่ว่างเพื่อดูคำสั่งเพิ่มเติม · แตะจุดเพื่อดูรายละเอียด แตะเส้นเพื่อดูธุรกรรม · แตะจุดเส้นประเพื่อดูธุรกรรมของคู่บัญชีที่รวมไว้ · ชี้ที่จุดเพื่ออ่านชื่อเต็ม · ขนาดจุดตามยอดเงินรวม ความหนาเส้นตามยอดโอน</div>
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
      {noteEdit && (
        <NoteModal
          edit={noteEdit} onClose={() => setNoteEdit(null)}
          onSave={(text) => {
            const notes = notesNow();
            if (noteEdit.id) saveView({ notes: notes.map((x) => (x.id === noteEdit.id ? { ...x, text } : x)) });
            else saveView({ notes: [...notes, { id: newId('t_'), text, pos: { [layoutMode]: noteEdit.model ?? { x: 0, y: 0 } } }] });
            setNoteEdit(null);
          }}
        />
      )}
    </div>
  );
}

/** เมนูลอยบนผัง — วางที่ตำแหน่งที่คลิก แต่ไม่ให้ล้นขอบผัง; ปิดเมื่อคลิกที่อื่นหรือกด Esc */
function FloatingMenu({ x, y, label, onClose, children }: { x: number; y: number; label: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  // ยังไม่รู้ขนาดเมนู → ซ่อนไว้ก่อน แล้ววางก่อนวาดจอ (ห้ามวางทับตำแหน่งที่คลิก: บน Windows เหตุการณ์ contextmenu
  // ของเบราว์เซอร์มาหลังปล่อยปุ่ม ถ้าเมนูอยู่ใต้ตัวชี้ เมนูคลิกขวาของเบราว์เซอร์จะเด้งทับ)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (el && box) {
      setPos(placeMenu({ x, y }, { w: el.offsetWidth, h: el.offsetHeight }, { w: box.clientWidth, h: box.clientHeight }));
      el.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [x, y]);
  useEffect(() => {
    const el = ref.current;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => { if (el && !el.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true); };
  }, [x, y]);
  // เนื้อหาเปลี่ยนความสูง (เช่น เปิดเมนูย่อย) → จัดตำแหน่งใหม่ให้ไม่ล้น
  useEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const ro = new ResizeObserver(() => setPos((p) => (p ? { ...p, top: Math.max(8, Math.min(p.top, box.clientHeight - el.offsetHeight - 8)) } : p)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      class="ctx-menu" ref={ref} role="menu" aria-label={label} onContextMenu={(e) => e.preventDefault()}
      style={{ left: (pos?.left ?? x + 6) + 'px', top: (pos?.top ?? y + 6) + 'px', visibility: pos ? 'visible' : 'hidden' }}
    >{children}</div>
  );
}

/** เมนูของจุดบัญชี (คลิกขวา/กดค้าง) */
function NodeMenuPopup({ menu, onClose, onEdit }: { menu: NodeMenu; onClose: () => void; onEdit: (id: string) => void }) {
  const photo = cs.value?.accountNotes[menu.id]?.photo;
  const a = accounts.value[menu.id];
  if (!a) return null;
  const act = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <FloatingMenu x={menu.x} y={menu.y} label={'เมนูของ ' + labelOf(menu.id)} onClose={onClose}>
      <div class="ctx-head ellipsis" title={labelOf(menu.id)}>{labelOf(menu.id)}</div>
      <button role="menuitem" onClick={() => onEdit(menu.id)}><Icon name="user" size={16} />{a.label || photo ? 'แก้ชื่อ-นามสกุล / รูปบุคคล…' : 'ตั้งชื่อ-นามสกุล / ใส่รูปบุคคล…'}</button>
      <button role="menuitem" onClick={act(() => openInspector({ kind: 'account', id: menu.id }))}><Icon name="info" size={16} />รายละเอียดบัญชี</button>
      <button role="menuitem" onClick={act(() => go('/transactions', { acc: menu.id }))}><Icon name="list" size={16} />ธุรกรรมของบัญชีนี้</button>
      {photo && (
        <button role="menuitem" class="danger" onClick={act(() => { void setAccountNote(menu.id, { photo: '' }).then(() => notify('ลบรูปแล้ว')); })}>
          <Icon name="trash" size={16} />ลบรูปบุคคล
        </button>
      )}
    </FloatingMenu>
  );
}

interface CanvasActions {
  addNote: () => void;
  toggleLabels: (m: 'plain' | 'card') => void;
  togglePin: (key: string) => void;
  selectAll: () => void;
  toggleHand: () => void;
  setLayout: (m: LayoutMode) => void;
  relayout: () => void;
  fit: () => void;
  toggleBadges: () => void;
}

const Check = ({ on }: { on: boolean }) => <span class="ctx-check" aria-hidden="true">{on ? <Icon name="check" size={15} /> : null}</span>;

/** เมนูคลิกขวาที่พื้นที่ว่าง หรือบนเส้น (มีคำสั่งของเส้นนั้นด้านบน) */
function CanvasMenu({ menu, cy, opt, handMode, layoutMode, onClose, actions }: {
  menu: CanvasMenuState; cy: Core | null; opt: NetworkViewOptions; handMode: boolean; layoutMode: LayoutMode; onClose: () => void; actions: CanvasActions;
}) {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const act = (fn: () => void) => () => { onClose(); fn(); };
  const edge = menu.edge && cy ? cy.getElementById(menu.edge) : null;
  const nameOf = (id: string) => (accounts.value[id] ? labelOf(id, false) : String(cy?.getElementById(id).data('label') ?? id).split('\n')[0]);
  const isManual = !!edge?.hasClass('manual-link');
  const key = edge ? String(edge.data('key') ?? `${edge.source().id()}>${edge.target().id()}`) : '';
  const pinned = (opt.pinnedEdges ?? []).includes(key);
  const labels = opt.edgeLabels ?? 'off';
  return (
    <FloatingMenu x={menu.x} y={menu.y} label={edge ? 'เมนูของเส้น' : 'เมนูของผัง'} onClose={onClose}>
      {edge && edge.nonempty() && (
        <>
          <div class="ctx-head edge">
            {nameOf(edge.source().id())} → {nameOf(edge.target().id())}
            {!isManual && <div class="tiny muted">{fmtBaht(edge.data('total') as number)} ฿ · {fmtInt(edge.data('count') as number)} รายการ</div>}
            {isManual && <div class="tiny muted">ความสัมพันธ์ที่เพิ่มเอง: {String(edge.data('label') ?? '')}</div>}
          </div>
          {!isManual && (
            <>
              <button role="menuitem" onClick={act(() => {
                if (edge.hasClass('agg-edge')) go('/transactions', { acc: String(edge.source().data('owner') ?? edge.target().data('owner') ?? edge.source().id()) });
                else go('/transactions', { acc: edge.source().id(), to: edge.target().id() });
              })}><Icon name="list" size={16} />ดูธุรกรรมของเส้นนี้</button>
              <button role="menuitemcheckbox" aria-checked={pinned} onClick={act(() => actions.togglePin(key))}><Check on={pinned} />แสดงรายละเอียดเส้นนี้ตลอด</button>
            </>
          )}
          <div class="ctx-sep" />
        </>
      )}
      <button role="menuitem" onClick={act(actions.addNote)}><Icon name="edit" size={16} />เพิ่มข้อความตรงนี้…</button>
      <button role="menuitemcheckbox" aria-checked={labels === 'plain'} onClick={act(() => actions.toggleLabels('plain'))}><Check on={labels === 'plain'} />แสดงรายละเอียดเส้นเงินทุกเส้น</button>
      <button role="menuitemcheckbox" aria-checked={labels === 'card'} onClick={act(() => actions.toggleLabels('card'))}><Check on={labels === 'card'} />แสดงรายละเอียดเส้นเงินทุกเส้น แบบการ์ด</button>
      <div class="ctx-sep" />
      <button role="menuitem" onClick={act(actions.selectAll)}><Check on={false} />เลือกทั้งหมด<span class="ctx-key kbd">Ctrl+A</span></button>
      <button role="menuitemcheckbox" aria-checked={handMode} onClick={act(actions.toggleHand)}><Check on={handMode} />โหมดมือ: ลากเลื่อนผัง<span class="ctx-key kbd">H</span></button>
      <div class="ctx-sep" />
      <button role="menuitem" aria-expanded={layoutOpen} onClick={() => setLayoutOpen(!layoutOpen)}><Icon name="network" size={16} />จัดวาง<span class="ctx-key">{layoutOpen ? '▾' : '▸'}</span></button>
      {layoutOpen && (
        <>
          {LAYOUTS.map((l) => (
            <button role="menuitemradio" aria-checked={layoutMode === l.value} class="ctx-sub" key={l.value} onClick={act(() => actions.setLayout(l.value))}><Check on={layoutMode === l.value} />{l.label}</button>
          ))}
          <button role="menuitem" class="ctx-sub" onClick={act(actions.relayout)}><Icon name="refresh" size={15} />จัดเรียงใหม่</button>
        </>
      )}
      <button role="menuitem" onClick={act(actions.fit)}><Icon name="fit" size={16} />พอดีจอ</button>
      <div class="ctx-sep" />
      <button role="menuitemcheckbox" aria-checked={!!opt.bankBadges} onClick={act(actions.toggleBadges)}><Check on={!!opt.bankBadges} />แสดงไอคอนธนาคารทุกโหนด</button>
    </FloatingMenu>
  );
}

/** เพิ่ม/แก้ข้อความบนผัง */
function NoteModal({ edit, onSave, onClose }: { edit: NoteEdit; onSave: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(edit.text);
  return (
    <Modal title={edit.id ? 'แก้ข้อความบนผัง' : 'เพิ่มข้อความบนผัง'} onClose={onClose} footer={<>
      <button class="btn" onClick={onClose}>ยกเลิก</button>
      <button class="btn primary" disabled={!text.trim()} onClick={() => onSave(text.trim())}>บันทึก</button>
    </>}>
      <div class="stack">
        <Field label="ข้อความ">
          <textarea class="textarea" rows={4} value={text} autofocus maxLength={500} placeholder="เช่น ถอนเงินสดต่อเนื่องหลังรับโอน 5 มี.ค. — ตรวจ CCTV ตู้ ATM" onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        </Field>
        <div class="tiny muted">ข้อความนี้เป็นบันทึกของผู้สืบสวน ลากย้ายบนผังได้ บันทึกในคดี และแสดงในภาพผังของรายงาน</div>
      </div>
    </Modal>
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
