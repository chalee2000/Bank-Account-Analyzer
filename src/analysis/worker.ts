// Web Worker: วิเคราะห์ข้อมูลนอก UI thread — เก็บ ctx/attribution ล่าสุดไว้ให้ trace ใช้ซ้ำโดยไม่ส่งข้อมูลข้ามเธรดอีก
import { analyze, runTrace, buildFindings, type AnalyzeInput, type TraceInput } from './index';
import type { Ctx } from './ctx';
import type { Attribution } from './attribution';
import type { AnalysisResult } from '../core/types';

type Req =
  | { id: number; type: 'analyze'; input: AnalyzeInput }
  | { id: number; type: 'trace'; input: TraceInput }
  | { id: number; type: 'findings' };

let ctx: Ctx | null = null;
let attr: Attribution | null = null;
let last: AnalysisResult | null = null;

const post = (msg: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(msg);

self.onmessage = (ev: MessageEvent<Req>) => {
  const req = ev.data;
  try {
    if (req.type === 'analyze') {
      const t0 = performance.now();
      const out = analyze(req.input);
      ctx = out.ctx;
      attr = out.attr;
      last = out.result;
      post({ id: req.id, type: 'analyzed', result: out.result, notes: out.notes, ms: performance.now() - t0 });
    } else if (req.type === 'trace') {
      if (!ctx || !attr) throw new Error('ยังไม่ได้วิเคราะห์ข้อมูล');
      post({ id: req.id, type: 'traced', result: runTrace(ctx, attr, req.input) });
    } else if (req.type === 'findings') {
      if (!ctx || !last) throw new Error('ยังไม่ได้วิเคราะห์ข้อมูล');
      post({ id: req.id, type: 'findings', result: buildFindings(ctx, last) });
    }
  } catch (e) {
    post({ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
