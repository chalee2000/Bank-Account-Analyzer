// ตัวห่อ Worker แบบ promise — ใช้ main thread แทนเมื่อไม่มี Worker (เช่น ตอนทดสอบ)
import type { AnalysisResult, Finding, TraceResult } from '../core/types';
import { analyze, runTrace, buildFindings, type AnalyzeInput, type TraceInput } from './index';
import type { Ctx } from './ctx';
import type { Attribution } from './attribution';

export interface AnalyzeOutput {
  result: AnalysisResult;
  notes: string[];
  ms: number;
}

export interface AnalysisEngine {
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>;
  trace(input: TraceInput): Promise<TraceResult>;
  findings(): Promise<Finding[]>;
  dispose(): void;
}

export function createEngine(): AnalysisEngine {
  if (typeof Worker === 'undefined') return createInlineEngine();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  worker.onmessage = (ev: MessageEvent) => {
    const { id, type, ...rest } = ev.data as { id: number; type: string; [k: string]: unknown };
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (type === 'error') p.reject(new Error(String(rest.message)));
    else p.resolve(rest);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Worker error'));
    pending.clear();
  };
  const call = <T>(msg: Record<string, unknown>): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, ...msg });
    });
  return {
    analyze: (input) => call<AnalyzeOutput>({ type: 'analyze', input }),
    trace: async (input) => (await call<{ result: TraceResult }>({ type: 'trace', input })).result,
    findings: async () => (await call<{ result: Finding[] }>({ type: 'findings' })).result,
    dispose: () => worker.terminate(),
  };
}

export function createInlineEngine(): AnalysisEngine {
  let ctx: Ctx | null = null;
  let attr: Attribution | null = null;
  let last: AnalysisResult | null = null;
  return {
    async analyze(input) {
      const t0 = Date.now();
      const out = analyze(input);
      ctx = out.ctx; attr = out.attr; last = out.result;
      return { result: out.result, notes: out.notes, ms: Date.now() - t0 };
    },
    async trace(input) {
      if (!ctx || !attr) throw new Error('ยังไม่ได้วิเคราะห์ข้อมูล');
      return runTrace(ctx, attr, input);
    },
    async findings() {
      if (!ctx || !last) throw new Error('ยังไม่ได้วิเคราะห์ข้อมูล');
      return buildFindings(ctx, last);
    },
    dispose() {},
  };
}
