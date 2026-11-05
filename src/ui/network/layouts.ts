// รูปแบบการจัดผังเพิ่มเติม แนวเดียวกับเครื่องมือวิเคราะห์ความเชื่อมโยง (เช่น i2 Analyst's Notebook):
// Peacock (ศูนย์กลาง + แฉก), Packed (อัดแน่นเป็นกลุ่ม), Hierarchy (ชั้นตามทิศเงิน), Organization (แผนผังองค์กร)
// ทุกฟังก์ชันเป็น pure — รับจุด/เส้น คืนตำแหน่ง (ทดสอบแบบ headless ได้ และได้ผลเดิมทุกครั้งกับข้อมูลเดิม)

export interface LNode { id: string; role?: string; size?: number; label?: string; fs?: number; tw?: number; ring?: number }
/** labelW: ความกว้างป้ายยอดเงินของเส้นโดยประมาณ (ค่ามากกว่าระหว่างแบบปกติ/การ์ด — ตำแหน่งจึงไม่เปลี่ยนตามการเปิดป้าย) */
export interface LEdge { source: string; target: string; total?: number; labelW?: number }
export type Pos = { x: number; y: number };

const r1 = (v: number) => Math.round(v * 10) / 10;

/** ขนาดจุด + ป้ายใต้จุดโดยประมาณ (ตัดบรรทัดตามความกว้างป้าย) */
export function nodeBox(n: LNode): { w: number; h: number } {
  const size = n.size ?? 20;
  if (!n.label) return { w: size, h: size };
  const fs = n.fs ?? 10;
  const tw = n.tw ?? 140;
  let lines = 0;
  let lw = 0;
  for (const l of n.label.split('\n')) {
    const w = l.length * fs * 0.55;
    lines += Math.max(1, Math.ceil(w / tw));
    lw = Math.max(lw, Math.min(w, tw));
  }
  return { w: Math.max(size, lw), h: size + lines * fs * 1.3 + 8 };
}

/** ความกว้างข้อความโดยประมาณ (บรรทัดที่ยาวที่สุด) — สระ/วรรณยุกต์ไทยบน-ล่างไม่กินที่ */
export function labelTextWidth(text: string, fs: number): number {
  return Math.max(0, ...text.split('\n').map((l) => l.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').length * fs * 0.56));
}

/** ความกว้างป้ายยอดเงินบนเส้น (ตัวอักษร 9.5): แบบปกติ 1 บรรทัด หรือแบบการ์ดที่มีกรอบ — เอาค่าที่กว้างกว่า */
export function edgeLabelWidth(label?: string, card?: string): number {
  return Math.round(Math.max(label ? labelTextWidth(label, 9.5) + 4 : 0, card ? labelTextWidth(card, 9.5) + 12 : 0));
}

interface Graph {
  ids: string[];
  byId: Map<string, LNode>;
  /** เพื่อนบ้านไม่สนทิศ → น้ำหนัก (ยอดรวมสองทิศ) */
  nb: Map<string, Map<string, number>>;
  /** เส้นมีทิศ (รวมเส้นซ้ำ) */
  out: Map<string, Map<string, number>>;
  vol: Map<string, number>;
}

function graphOf(nodes: LNode[], edges: LEdge[]): Graph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = nodes.map((n) => n.id);
  const nb = new Map(ids.map((id) => [id, new Map<string, number>()]));
  const out = new Map(ids.map((id) => [id, new Map<string, number>()]));
  const vol = new Map(ids.map((id) => [id, 0]));
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    const w = (e.total ?? 0) || 1;
    const add = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + w);
    add(nb.get(e.source)!, e.target);
    add(nb.get(e.target)!, e.source);
    add(out.get(e.source)!, e.target);
    vol.set(e.source, vol.get(e.source)! + w);
    vol.set(e.target, vol.get(e.target)! + w);
  }
  return { ids, byId, nb, out, vol };
}

/** ความสำคัญ: เจ้าของ Statement ก่อน (ตามลำดับเดิม) แล้วตามยอดรวม */
function byImportance(g: Graph) {
  return (a: string, b: string) => {
    const na = g.byId.get(a)!;
    const nb = g.byId.get(b)!;
    const oa = na.role === 'owner' ? 0 : 1;
    const ob = nb.role === 'owner' ? 0 : 1;
    return oa - ob || (na.ring ?? 1e9) - (nb.ring ?? 1e9) || g.vol.get(b)! - g.vol.get(a)! || (a < b ? -1 : a > b ? 1 : 0);
  };
}

/** ผลักจุดที่ขยับได้ออกจากกันจนกรอบ (จุด + ป้าย) ไม่ทับกัน — จุดอื่นถือว่าตรึงไว้ */
function separate(pos: Record<string, Pos>, movable: string[], all: string[], g: Graph, pad = 14, rounds = 60): void {
  const box = new Map(all.map((id) => [id, nodeBox(g.byId.get(id)!)]));
  const mov = new Set(movable);
  for (let it = 0; it < rounds; it++) {
    let moved = false;
    for (const a of movable) {
      const pa = pos[a]!;
      const ba = box.get(a)!;
      for (const b of all) {
        if (a === b) continue;
        const pb = pos[b]!;
        const bb = box.get(b)!;
        const ox = (ba.w + bb.w) / 2 + pad - Math.abs(pa.x - pb.x);
        const oy = (ba.h + bb.h) / 2 + pad - Math.abs(pa.y - pb.y);
        if (ox <= 0 || oy <= 0) continue;
        const share = mov.has(b) ? 0.5 : 1;
        if (ox < oy) pa.x += (pa.x >= pb.x ? 1 : -1) * ox * share;
        else pa.y += (pa.y >= pb.y ? 1 : -1) * oy * share;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

// ======================= Peacock =======================

export const PEACOCK = { slot: 66, ringGap: 86, minR: 120, hubGap: 90 };

/**
 * Peacock: บัญชีศูนย์กลาง (เจ้าของ Statement และบัญชีที่มีคู่บัญชีติดต่อกับมันเพียงรายเดียว) แต่ละรายล้อมด้วย "แฉก"
 * ของคู่บัญชีเหล่านั้นเป็นวง (หลายวงเมื่อมีมาก) หันออกด้านนอก; ศูนย์กลางเรียงบนวงใหญ่ห่างกันพอไม่ให้แฉกทับกัน;
 * บัญชีที่เชื่อมหลายศูนย์กลางอยู่ตรงกลางระหว่างศูนย์กลางเหล่านั้น
 */
export function peacockPositions(nodes: LNode[], edges: LEdge[]): Record<string, Pos> {
  const g = graphOf(nodes, edges);
  const imp = byImportance(g);
  const isOwner = (id: string) => g.byId.get(id)!.role === 'owner';
  const deg = (id: string) => g.nb.get(id)!.size;
  const leafOf = new Map<string, string>();
  for (const id of g.ids) {
    if (deg(id) !== 1 || isOwner(id)) continue;
    const h = [...g.nb.get(id)!.keys()][0]!;
    // คู่ที่แยกออกมาเป็นสองจุด: จุดที่สำคัญกว่าเป็นศูนย์กลาง
    if (deg(h) > 1 || isOwner(h) || imp(h, id) < 0) leafOf.set(id, h);
  }
  const leaves = new Map<string, string[]>();
  for (const [l, h] of leafOf) (leaves.get(h) ?? leaves.set(h, []).get(h)!).push(l);
  const hubSet = new Set(g.ids.filter((id) => !leafOf.has(id) && (leaves.has(id) || isOwner(id))));
  const hubs = [...hubSet].sort(imp);
  const others = g.ids.filter((id) => !leafOf.has(id) && !hubSet.has(id));
  const n = hubs.length;
  const A = n > 1 ? Math.PI * 1.5 : Math.PI * 2;

  // แฉกของแต่ละศูนย์กลาง: วงในก่อน (ยอดสูงอยู่วงใน)
  const fans = new Map<string, { r: number; ids: string[] }[]>();
  const fanR = new Map<string, number>();
  for (const h of hubs) {
    const ls = (leaves.get(h) ?? []).sort((a, b) => g.nb.get(h)!.get(b)! - g.nb.get(h)!.get(a)! || imp(a, b));
    const rings: { r: number; ids: string[] }[] = [];
    let r = Math.max(PEACOCK.minR, (g.byId.get(h)!.size ?? 40) / 2 + 70);
    let i = 0;
    while (i < ls.length) {
      const cap = Math.max(4, Math.floor((A * r) / PEACOCK.slot));
      rings.push({ r, ids: ls.slice(i, i + cap) });
      i += cap;
      r += PEACOCK.ringGap;
    }
    fans.set(h, rings);
    fanR.set(h, (rings.length ? rings[rings.length - 1]!.r : nodeBox(g.byId.get(h)!).w / 2) + 70);
  }

  const pos: Record<string, Pos> = {};
  const angle = new Map<string, number>();
  if (n === 1) { pos[hubs[0]!] = { x: 0, y: 0 }; angle.set(hubs[0]!, -Math.PI / 2); }
  else if (n > 1) {
    let Rm = 0;
    for (let i = 0; i < n; i++) {
      const a = fanR.get(hubs[i]!)!;
      const b = fanR.get(hubs[(i + 1) % n]!)!;
      Rm = Math.max(Rm, (a + b + PEACOCK.hubGap) / (2 * Math.sin(Math.PI / n)));
    }
    Rm = Math.max(Rm, Math.max(...hubs.map((h) => fanR.get(h)!)) + 160);
    hubs.forEach((h, i) => {
      const t = -Math.PI / 2 + (2 * Math.PI * i) / n;
      pos[h] = { x: Rm * Math.cos(t), y: Rm * Math.sin(t) };
      angle.set(h, t);
    });
  }
  for (const h of hubs) {
    const c = pos[h]!;
    const phi = angle.get(h)!;
    fans.get(h)!.forEach((ring, k) => {
      const m = ring.ids.length;
      ring.ids.forEach((id, j) => {
        const t = A >= Math.PI * 2 - 1e-6
          ? phi + (2 * Math.PI * (j + (k % 2) * 0.5)) / m
          : phi - A / 2 + (A * (j + 0.5)) / m;
        pos[id] = { x: c.x + ring.r * Math.cos(t), y: c.y + ring.r * Math.sin(t) };
      });
    });
  }
  // บัญชีที่เชื่อมหลายศูนย์กลาง: ค่าเฉลี่ยถ่วงน้ำหนักของเพื่อนบ้านที่วางแล้ว ดึงเข้ากลาง
  let pending = others.filter((id) => deg(id) > 0);
  for (let pass = 0; pass < 4 && pending.length; pass++) {
    const next: string[] = [];
    for (const id of pending) {
      let sx = 0, sy = 0, sw = 0;
      for (const [v, w] of g.nb.get(id)!) if (pos[v]) { sx += pos[v]!.x * w; sy += pos[v]!.y * w; sw += w; }
      if (!sw) { next.push(id); continue; }
      const k = n > 1 ? 0.55 : 1;
      pos[id] = { x: (sx / sw) * k, y: (sy / sw) * k + (n > 1 ? 0 : 160) };
    }
    pending = next;
  }
  pending.forEach((id, i) => { pos[id] = { x: (i - (pending.length - 1) / 2) * 120, y: 0 }; });
  const placed = g.ids.filter((id) => pos[id]);
  separate(pos, others.filter((id) => pos[id]), placed, g);
  placeIsolated(pos, g.ids.filter((id) => !pos[id]), g);
  return round(pos);
}

/** จุดที่ไม่มีเส้นเลย: เรียงเป็นแถวใต้ผัง */
function placeIsolated(pos: Record<string, Pos>, ids: string[], g: Graph): void {
  if (!ids.length) return;
  const ys = Object.values(pos).map((p) => p.y);
  const xs = Object.values(pos).map((p) => p.x);
  let y = ys.length ? Math.max(...ys) + 180 : 0;
  let x = xs.length ? Math.min(...xs) : 0;
  const x0 = x;
  const maxW = Math.max(800, xs.length ? Math.max(...xs) - Math.min(...xs) : 800);
  for (const id of ids) {
    const b = nodeBox(g.byId.get(id)!);
    if (x - x0 > maxW) { x = x0; y += 140; }
    pos[id] = { x: x + b.w / 2, y };
    x += b.w + 40;
  }
}

function round(pos: Record<string, Pos>): Record<string, Pos> {
  for (const k of Object.keys(pos)) pos[k] = { x: r1(pos[k]!.x), y: r1(pos[k]!.y) };
  return pos;
}

// ======================= Packed =======================

/**
 * Packed: บัญชีที่เชื่อมถึงกันเป็นกลุ่มเดียวกัน แต่ละกลุ่มอัดแน่นเป็นก้อนกลม (บัญชีสำคัญอยู่กลาง คู่บัญชีที่ติดต่อกันอยู่ใกล้กัน)
 * แล้วเรียงก้อนชิดกันเป็นแถว — ใช้พื้นที่น้อยที่สุด เห็นทุกกลุ่มในจอเดียว (ไม่ได้จัดตามทิศเงิน)
 */
export function packedPositions(nodes: LNode[], edges: LEdge[]): Record<string, Pos> {
  const g = graphOf(nodes, edges);
  const imp = byImportance(g);
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const start of [...g.ids].sort(imp)) {
    if (seen.has(start)) continue;
    // BFS จากจุดสำคัญ เพื่อนบ้านยอดสูงก่อน → จุดที่ติดต่อกันได้ตำแหน่งใกล้กันบนเกลียว
    const order: string[] = [];
    const q = [start];
    seen.add(start);
    while (q.length) {
      const u = q.shift()!;
      order.push(u);
      for (const [v] of [...g.nb.get(u)!].sort((a, b) => b[1] - a[1])) if (!seen.has(v)) { seen.add(v); q.push(v); }
    }
    groups.push(order);
  }
  const PAD = 10;
  const discs = groups.map((order) => {
    const local: Record<string, Pos> = {};
    const rects: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const cell = 160;
    const grid = new Map<string, number[]>();
    const keyOf = (cx: number, cy: number) => `${cx},${cy}`;
    const overlaps = (r: { x1: number; y1: number; x2: number; y2: number }) => {
      for (let cx = Math.floor(r.x1 / cell); cx <= Math.floor(r.x2 / cell); cx++) {
        for (let cy = Math.floor(r.y1 / cell); cy <= Math.floor(r.y2 / cell); cy++) {
          for (const i of grid.get(keyOf(cx, cy)) ?? []) {
            const o = rects[i]!;
            if (r.x1 < o.x2 && r.x2 > o.x1 && r.y1 < o.y2 && r.y2 > o.y1) return true;
          }
        }
      }
      return false;
    };
    const addRect = (r: { x1: number; y1: number; x2: number; y2: number }) => {
      const i = rects.push(r) - 1;
      for (let cx = Math.floor(r.x1 / cell); cx <= Math.floor(r.x2 / cell); cx++) {
        for (let cy = Math.floor(r.y1 / cell); cy <= Math.floor(r.y2 / cell); cy++) {
          (grid.get(keyOf(cx, cy)) ?? grid.set(keyOf(cx, cy), []).get(keyOf(cx, cy))!).push(i);
        }
      }
    };
    let k = 0;
    for (const id of order) {
      const n = g.byId.get(id)!;
      const b = nodeBox(n);
      const half = (n.size ?? 20) / 2;
      for (;; k++) {
        const r = 7 * Math.sqrt(k);
        const t = k * 2.399963;
        const x = r * Math.cos(t);
        const y = r * Math.sin(t);
        const rect = { x1: x - b.w / 2 - PAD, x2: x + b.w / 2 + PAD, y1: y - half - PAD, y2: y - half + b.h + PAD };
        if (!overlaps(rect)) { addRect(rect); local[id] = { x, y }; break; }
      }
      k = Math.floor(k * 0.6); // ไม่ต้องเริ่มจากกลางใหม่ทุกครั้ง (ด้านในเต็มแล้ว)
    }
    const R = Math.max(40, ...rects.map((r) => Math.max(Math.hypot(r.x1, r.y1), Math.hypot(r.x2, r.y1), Math.hypot(r.x1, r.y2), Math.hypot(r.x2, r.y2))));
    return { local, R };
  });
  // เรียงก้อนเป็นแถว (ใหญ่ก่อน) ความกว้างแถวราวรากที่สองของพื้นที่รวม
  const sorted = discs.map((d, i) => ({ ...d, i })).sort((a, b) => b.R - a.R);
  const gap = 50;
  const W = Math.max(sorted[0] ? 2 * sorted[0].R : 0, Math.sqrt(sorted.reduce((s, d) => s + (2 * d.R + gap) ** 2, 0)) * 1.25);
  const pos: Record<string, Pos> = {};
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const d of sorted) {
    const D = 2 * d.R;
    if (x > 0 && x + D > W) { x = 0; y += rowH + gap; rowH = 0; }
    const cx = x + d.R;
    const cy = y + d.R;
    for (const [id, p] of Object.entries(d.local)) pos[id] = { x: cx + p.x, y: cy + p.y };
    x += D + gap;
    rowH = Math.max(rowH, D);
  }
  return round(pos);
}

// ======================= Hierarchy =======================

/** ลำดับตามทิศเงินแบบ greedy (Eades et al.) — ใช้ตัดวงวน: เส้นที่ย้อนลำดับถือว่ากลับทิศตอนแบ่งชั้น */
export function flowOrder(ids: string[], out: Map<string, Map<string, number>>, cmp: (a: string, b: string) => number): string[] {
  const rem = new Set(ids);
  const inW = new Map<string, Map<string, number>>(ids.map((id) => [id, new Map()]));
  for (const [u, m] of out) for (const [v, w] of m) if (inW.has(v) && rem.has(u)) inW.get(v)!.set(u, w);
  const sum = (m: Map<string, number> | undefined) => { let s = 0; for (const [k, w] of m ?? []) if (rem.has(k)) s += w; return s; };
  const s1: string[] = [];
  const s2: string[] = [];
  while (rem.size) {
    let moved = true;
    while (moved) {
      moved = false;
      const sinks = [...rem].filter((u) => sum(out.get(u)) === 0 && sum(inW.get(u)) > 0).sort(cmp);
      for (const u of sinks.reverse()) { s2.unshift(u); rem.delete(u); moved = true; }
      const srcs = [...rem].filter((u) => sum(inW.get(u)) === 0).sort(cmp);
      for (const u of srcs) { s1.push(u); rem.delete(u); moved = true; }
    }
    if (!rem.size) break;
    const u = [...rem].sort((a, b) => sum(out.get(b)) - sum(inW.get(b)) - (sum(out.get(a)) - sum(inW.get(a))) || cmp(a, b))[0]!;
    s1.push(u);
    rem.delete(u);
  }
  return [...s1, ...s2];
}

export const HIER = { gapX: 34, minRank: 170, rankPad: 90 };

/**
 * Hierarchy: แบ่งชั้นตามทิศเงิน (ต้นทางอยู่ชั้นบน ปลายทางอยู่ชั้นล่าง; วงวนตัดด้วยลำดับ greedy) แล้วเรียงในชั้นด้วย
 * ค่าเฉลี่ยตำแหน่งเพื่อนบ้าน (barycenter) หลายรอบเพื่อลดเส้นตัดกัน — ชั้นละหลายจุด จึงกะทัดรัดกว่าผังไหลเงิน
 */
export function hierarchyPositions(nodes: LNode[], edges: LEdge[]): Record<string, Pos> {
  const g = graphOf(nodes, edges);
  const imp = byImportance(g);
  const order = flowOrder(g.ids, g.out, imp);
  const idx = new Map(order.map((id, i) => [id, i]));
  const preds = new Map(g.ids.map((id) => [id, [] as string[]]));
  const succs = new Map(g.ids.map((id) => [id, [] as string[]]));
  for (const [u, m] of g.out) {
    for (const [v] of m) {
      const [a, b] = idx.get(u)! < idx.get(v)! ? [u, v] : [v, u];
      if (!succs.get(a)!.includes(b)) { succs.get(a)!.push(b); preds.get(b)!.push(a); }
    }
  }
  const rank = new Map<string, number>();
  for (const v of order) rank.set(v, Math.max(0, ...preds.get(v)!.map((u) => rank.get(u)! + 1)));
  // ต้นทางที่ไม่มีใครส่งเข้า: ขยับลงมาอยู่เหนือปลายทางพอดี (ไม่ให้เส้นยาวข้ามหลายชั้น)
  for (const v of [...order].reverse()) {
    if (preds.get(v)!.length === 0 && succs.get(v)!.length) rank.set(v, Math.min(...succs.get(v)!.map((w) => rank.get(w)!)) - 1);
  }
  const minR = Math.min(...rank.values());
  for (const [k, r] of rank) rank.set(k, r - minR);
  const maxR = Math.max(0, ...rank.values());
  const layers: string[][] = Array.from({ length: maxR + 1 }, () => []);
  for (const v of order) layers[rank.get(v)!]!.push(v);

  const w = (id: string) => nodeBox(g.byId.get(id)!).w;
  const x = new Map<string, number>();
  const pack = (layer: string[]) => {
    const total = layer.reduce((s, id) => s + w(id), 0) + HIER.gapX * Math.max(0, layer.length - 1);
    let cur = -total / 2;
    for (const id of layer) { x.set(id, cur + w(id) / 2); cur += w(id) + HIER.gapX; }
  };
  layers.forEach(pack);
  const bary = (v: string, dir: 'up' | 'down') => {
    let s = 0;
    let c = 0;
    for (const u of g.nb.get(v)!.keys()) {
      const ru = rank.get(u)!;
      if ((dir === 'down' && ru < rank.get(v)!) || (dir === 'up' && ru > rank.get(v)!)) { s += x.get(u)!; c++; }
    }
    return c ? s / c : x.get(v)!;
  };
  for (let it = 0; it < 12; it++) {
    const down = it % 2 === 0;
    const rs = down ? layers.map((_, i) => i) : layers.map((_, i) => layers.length - 1 - i);
    for (const r of rs) {
      const layer = layers[r]!;
      const b = new Map(layer.map((v) => [v, bary(v, down ? 'down' : 'up')]));
      layer.sort((p, q) => b.get(p)! - b.get(q)! || x.get(p)! - x.get(q)!);
      pack(layer);
    }
  }
  // ขยับเข้าหาเพื่อนบ้านโดยคงลำดับและระยะขั้นต่ำ (เส้นตรงขึ้น ไม่เอียงมาก)
  for (let it = 0; it < 4; it++) {
    for (const layer of layers) {
      const want = layer.map((v) => {
        let s = 0, c = 0;
        for (const u of g.nb.get(v)!.keys()) if (Math.abs(rank.get(u)! - rank.get(v)!) === 1) { s += x.get(u)!; c++; }
        return c ? s / c : x.get(v)!;
      });
      const sep = (i: number) => (w(layer[i - 1]!) + w(layer[i]!)) / 2 + HIER.gapX;
      const a = [...want];
      for (let i = 1; i < a.length; i++) a[i] = Math.max(a[i]!, a[i - 1]! + sep(i));
      const b = [...want];
      for (let i = b.length - 2; i >= 0; i--) b[i] = Math.min(b[i]!, b[i + 1]! - sep(i + 1));
      const m = a.map((v, i) => (v + b[i]!) / 2);
      for (let i = 1; i < m.length; i++) m[i] = Math.max(m[i]!, m[i - 1]! + sep(i));
      layer.forEach((v, i) => x.set(v, m[i]!));
    }
  }
  const pos: Record<string, Pos> = {};
  let y = 0;
  layers.forEach((layer, r) => {
    if (r > 0) {
      const prevH = Math.max(0, ...layers[r - 1]!.map((id) => nodeBox(g.byId.get(id)!).h));
      y += Math.max(HIER.minRank, prevH + HIER.rankPad);
    }
    for (const v of layer) pos[v] = { x: x.get(v)!, y };
  });
  return round(pos);
}

// ======================= Organization =======================

export const ORG = { gapX: 28, levelPad: 110, minLevel: 170, treeGap: 140 };

/**
 * Organization: แผนผังแบบองค์กร — เริ่มจากเจ้าของ Statement ที่ยอดสูงสุด (แต่ละกลุ่มที่ไม่เชื่อมกันมีรากของตัวเอง)
 * คู่บัญชีเรียงเป็นชั้นลงมาตามการเชื่อมโยง (เส้นยอดสูงสุดเป็นสายบังคับบัญชา) ลูกเรียงใต้แม่ แม่อยู่กึ่งกลางเหนือลูก
 */
export function orgPositions(nodes: LNode[], edges: LEdge[]): { pos: Record<string, Pos>; parent: Record<string, string> } {
  const g = graphOf(nodes, edges);
  const imp = byImportance(g);
  const parent: Record<string, string> = {};
  const children = new Map(g.ids.map((id) => [id, [] as string[]]));
  const depth = new Map<string, number>();
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const root of [...g.ids].sort(imp)) {
    if (seen.has(root)) continue;
    roots.push(root);
    seen.add(root);
    depth.set(root, 0);
    const q = [root];
    while (q.length) {
      const u = q.shift()!;
      for (const [v] of [...g.nb.get(u)!].sort((a, b) => b[1] - a[1] || imp(a[0], b[0]))) {
        if (seen.has(v)) continue;
        seen.add(v);
        parent[v] = u;
        children.get(u)!.push(v);
        depth.set(v, depth.get(u)! + 1);
        q.push(v);
      }
    }
  }
  // ป้ายยอดเงินของเส้นจากแม่อยู่เหนือลูกแต่ละราย → คอลัมน์ของลูกต้องกว้างพอทั้งจุด+ชื่อ และป้ายยอดเงิน (พี่น้องจึงไม่มีป้ายทับกัน)
  const lw = new Map<string, number>();
  for (const e of edges) {
    if (!e.labelW) continue;
    const child = parent[e.target] === e.source ? e.target : parent[e.source] === e.target ? e.source : undefined;
    if (child) lw.set(child, Math.max(lw.get(child) ?? 0, e.labelW));
  }
  const w = (id: string) => Math.max(nodeBox(g.byId.get(id)!).w, lw.get(id) ?? 0) + ORG.gapX;
  const subW = new Map<string, number>();
  const measure = (u: string): number => {
    const cs = children.get(u)!;
    const s = cs.reduce((acc, c) => acc + measure(c), 0);
    const v = Math.max(w(u), s);
    subW.set(u, v);
    return v;
  };
  const x = new Map<string, number>();
  const place = (u: string, left: number) => {
    const cs = children.get(u)!;
    if (!cs.length) { x.set(u, left + subW.get(u)! / 2); return; }
    const total = cs.reduce((acc, c) => acc + subW.get(c)!, 0);
    let cur = left + (subW.get(u)! - total) / 2;
    for (const c of cs) { place(c, cur); cur += subW.get(c)!; }
    x.set(u, (x.get(cs[0]!)! + x.get(cs[cs.length - 1]!)!) / 2);
  };
  let left = 0;
  for (const r of roots) { measure(r); place(r, left); left += subW.get(r)! + ORG.treeGap; }
  const maxD = Math.max(0, ...depth.values());
  const levelY: number[] = [0];
  for (let d = 1; d <= maxD; d++) {
    const prevH = Math.max(0, ...g.ids.filter((id) => depth.get(id) === d - 1).map((id) => nodeBox(g.byId.get(id)!).h));
    levelY[d] = levelY[d - 1]! + Math.max(ORG.minLevel, prevH + ORG.levelPad);
  }
  const pos: Record<string, Pos> = {};
  for (const id of g.ids) pos[id] = { x: x.get(id)!, y: levelY[depth.get(id)!]! };
  return { pos: round(pos), parent };
}
