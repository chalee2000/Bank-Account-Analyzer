import type {
  Account, AnalysisResult, AnalysisSettings, DataQuality, FileRecord, Txn,
} from '../core/types';
import { computeAttribution } from './attribution';
import { buildCtx } from './ctx';
import { buildNetwork } from './network';
import { detectAllSignals } from './patterns';
import { buildPriority } from './priority';
import { buildPairs, buildProfiles } from './profile';
import { buildRoleHints } from './roles';

export interface AnalyzeInput {
  txns: Txn[];
  accounts: Record<string, Account>;
  files: FileRecord[];
  settings: AnalysisSettings;
  mirrorsMerged?: number;
}

export function buildQuality(input: AnalyzeInput): DataQuality {
  const { txns, files } = input;
  const flows = txns;
  let first: number | undefined;
  let last: number | undefined;
  for (const t of flows) {
    if (first === undefined || t.ts < first) first = t.ts;
    if (last === undefined || t.ts > last) last = t.ts;
  }
  const sumF = (f: (x: FileRecord) => number) => files.reduce((a, x) => a + f(x), 0);
  return {
    totalRows: sumF((f) => f.rowsTotal),
    imported: sumF((f) => f.rowsImported),
    skipped: sumF((f) => f.rowsSkipped),
    duplicatesRemoved: sumF((f) => f.duplicatesRemoved),
    mirrorsMerged: input.mirrorsMerged ?? txns.filter((t) => t.mirrored).length,
    noCounterparty: flows.filter(
      (t) => t.kind === 'transfer' && (t.from.startsWith('unknown:') || t.to.startsWith('unknown:')),
    ).length,
    noTime: flows.filter((t) => !t.hasTime).length,
    inferredCounterparty: flows.filter((t) => t.inferred).length,
    balanceMismatch: sumF((f) => f.balanceChecks?.mismatches ?? 0),
    firstTs: first,
    lastTs: last,
    perFile: files,
  };
}

export function analyze(input: AnalyzeInput) {
  const ctx = buildCtx(input.txns, input.accounts, input.settings);
  const attr = computeAttribution(ctx);
  const profiles = buildProfiles(ctx, attr);
  const pairs = buildPairs(ctx);
  const signals = detectAllSignals(ctx, attr);
  const { metrics, notes } = buildNetwork(ctx, pairs);
  const roleHints = buildRoleHints(ctx, profiles, metrics, signals);
  const priority = buildPriority(profiles, metrics, signals);
  const quality = buildQuality(input);
  const result: AnalysisResult = {
    settings: input.settings,
    generatedAt: Date.now(),
    profiles,
    pairs,
    links: attr.links,
    signals,
    metrics,
    roleHints,
    priority,
    quality,
  };
  return { ctx, attr, result, notes };
}

export { buildCtx, computeAttribution };
export { runTrace } from './trace';
export type { TraceInput } from './trace';
export * from './findings';
export { ROLE_LABEL } from './roles';
export { PRIORITY_DISCLAIMER } from './priority';
