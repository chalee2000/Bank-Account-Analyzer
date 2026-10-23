// เครือข่ายบัญชี: Degree, Weighted Degree, Betweenness, Bridge (articulation), Component, Community
// ค่าเหล่านี้เป็นตัวชี้วัดโครงสร้างเท่านั้น — Betweenness/Degree สูงไม่ได้หมายความว่ามีความผิดหรือเป็นผู้สั่งการ
import Graph from 'graphology';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness';
import louvain from 'graphology-communities-louvain';
import { connectedComponents } from 'graphology-components';
import type { NodeMetrics, PairStat } from '../core/types';
import { isRealAccount, type Ctx } from './ctx';

export const MAX_BETWEENNESS_NODES = 3000;

export function buildNetwork(ctx: Ctx, pairs: PairStat[]): {
  metrics: Record<string, NodeMetrics>;
  notes: string[];
} {
  const notes: string[] = [];
  const g = new Graph({ type: 'directed', multi: false });
  for (const p of pairs) {
    if (!isRealAccount(ctx.accounts[p.from]) || !isRealAccount(ctx.accounts[p.to])) continue;
    if (p.from === p.to) continue;
    if (!g.hasNode(p.from)) g.addNode(p.from);
    if (!g.hasNode(p.to)) g.addNode(p.to);
    g.addDirectedEdge(p.from, p.to, { weight: p.total, count: p.count });
  }

  const metrics: Record<string, NodeMetrics> = {};
  if (g.order === 0) return { metrics, notes };

  // betweenness (ไม่ถ่วงน้ำหนัก, normalized)
  let bet: Record<string, number> = {};
  if (g.order <= MAX_BETWEENNESS_NODES) {
    bet = betweennessCentrality(g, { normalized: true });
  } else {
    notes.push(`เครือข่ายมี ${g.order} บัญชี — ข้ามการคำนวณ Betweenness เพื่อประสิทธิภาพ`);
  }

  // component
  const comps = connectedComponents(g).sort((a, b) => b.length - a.length);
  const compOf = new Map<string, number>();
  comps.forEach((c, i) => c.forEach((n) => compOf.set(n, i)));

  // undirected เพื่อ community / articulation
  const ug = new Graph({ type: 'undirected', multi: false });
  g.forEachNode((n) => ug.addNode(n));
  g.forEachEdge((_e, attr, s, t) => {
    const w = Math.log10(1 + (attr.weight as number));
    if (ug.hasEdge(s, t)) ug.updateEdgeAttribute(ug.edge(s, t)!, 'weight', (x: number) => x + w);
    else ug.addUndirectedEdge(s, t, { weight: w });
  });
  let comm: Record<string, number> = {};
  if (ug.size > 0) {
    try {
      comm = louvain(ug, { getEdgeWeight: 'weight' }) as Record<string, number>;
    } catch {
      comm = {};
    }
  }
  const art = articulationPoints(ug);

  g.forEachNode((n) => {
    let wIn = 0;
    let wOut = 0;
    g.forEachInEdge(n, (_e, attr) => { wIn += attr.weight as number; });
    g.forEachOutEdge(n, (_e, attr) => { wOut += attr.weight as number; });
    metrics[n] = {
      accountId: n,
      inDegree: g.inDegree(n),
      outDegree: g.outDegree(n),
      degree: ug.degree(n),
      weightedIn: wIn,
      weightedOut: wOut,
      betweenness: bet[n] ?? 0,
      isBridge: art.has(n),
      component: compOf.get(n) ?? 0,
      community: comm[n] ?? 0,
    };
  });
  return { metrics, notes };
}

/** จุดตัด (articulation points) ของกราฟไม่ระบุทิศ — Tarjan แบบ iterative */
export function articulationPoints(g: Graph): Set<string> {
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const result = new Set<string>();
  let time = 0;
  g.forEachNode((root) => {
    if (disc.has(root)) return;
    let rootChildren = 0;
    const stack: { node: string; parent: string | null; neighbors: string[]; idx: number }[] = [];
    disc.set(root, ++time);
    low.set(root, time);
    stack.push({ node: root, parent: null, neighbors: g.neighbors(root), idx: 0 });
    while (stack.length) {
      const f = stack[stack.length - 1]!;
      if (f.idx < f.neighbors.length) {
        const nb = f.neighbors[f.idx++]!;
        if (nb === f.parent) continue;
        if (disc.has(nb)) {
          low.set(f.node, Math.min(low.get(f.node)!, disc.get(nb)!));
        } else {
          disc.set(nb, ++time);
          low.set(nb, time);
          if (f.node === root) rootChildren++;
          stack.push({ node: nb, parent: f.node, neighbors: g.neighbors(nb), idx: 0 });
        }
      } else {
        stack.pop();
        const p = stack[stack.length - 1];
        if (p) {
          low.set(p.node, Math.min(low.get(p.node)!, low.get(f.node)!));
          if (p.node !== root && low.get(f.node)! >= disc.get(p.node)!) result.add(p.node);
        }
      }
    }
    if (rootChildren > 1) result.add(root);
  });
  return result;
}
