// สถานะของคดี (สิ่งที่บันทึกลง IndexedDB) และฟังก์ชันสร้างข้อมูลที่ "คำนวณต่อ" จากสถานะนั้น
import type {
  AltHypothesis, AliasGroup, Account, AnalysisSettings, CaseEvent, CaseMeta, FileRecord, Finding,
  ManualLink, ManualNode, Txn,
} from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { defaultAltHypotheses } from '../analysis/findings';
import { consolidate, type AliasSuggestion } from '../ingest/consolidate';
import type { ColumnMapping, OwnerInfo, SkippedRow, StatementRow } from '../ingest/types';

export interface StoredFile {
  record: FileRecord;
  owner: OwnerInfo;
  rows: StatementRow[];
  skipped: SkippedRow[];
  mapping?: ColumnMapping;
}

export interface PinnedTrace {
  id: string;
  label: string;
  direction: 'forward' | 'backward';
  seed: { accountId?: string; txnId?: string };
}

export interface CaseState {
  meta: CaseMeta;
  settings: AnalysisSettings;
  files: StoredFile[];
  findings: Finding[];
  findingsGenerated: boolean;
  /** ลายเซ็นข้อมูล/ค่าตั้งต้นที่ใช้สร้างข้อสรุปอัตโนมัติครั้งล่าสุด */
  findingsSig?: string;
  altHypotheses: AltHypothesis[];
  events: CaseEvent[];
  manualNodes: ManualNode[];
  manualLinks: ManualLink[];
  aliases: AliasGroup[];
  pinnedTraces: PinnedTrace[];
  /** ชื่อ/หมายเหตุที่ผู้สืบสวนกำหนดต่อบัญชี */
  accountNotes: Record<string, { label?: string; note?: string }>;
}

export function newId(prefix = ''): string {
  const r = crypto.getRandomValues(new Uint8Array(6));
  return prefix + [...r].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createCaseState(name: string, extra: Partial<CaseMeta> = {}): CaseState {
  const now = Date.now();
  return {
    meta: { id: newId('case_'), name, createdAt: now, updatedAt: now, ...extra },
    settings: { ...DEFAULT_SETTINGS },
    files: [],
    findings: [],
    findingsGenerated: false,
    altHypotheses: defaultAltHypotheses(),
    events: [],
    manualNodes: [],
    manualLinks: [],
    aliases: [],
    pinnedTraces: [],
    accountNotes: {},
  };
}

export interface Derived {
  txns: Txn[];
  accounts: Record<string, Account>;
  aliasSuggestions: AliasSuggestion[];
  mirrorsMerged: number;
  ambiguousMirrors: number;
  /** FileRecord พร้อมจำนวนรายการซ้ำที่เพิ่งคำนวณ */
  files: FileRecord[];
}

/** สร้าง Master Transaction Table จากไฟล์ทั้งหมดของคดี */
export function deriveCase(state: CaseState): Derived {
  const res = consolidate(
    state.files.map((f) => ({ fileId: f.record.id, owner: f.owner, rows: f.rows })),
    state.aliases,
    state.settings,
  );
  const accounts = res.accounts;
  for (const [id, n] of Object.entries(state.accountNotes)) {
    const a = accounts[id];
    if (a) {
      if (n.label) a.label = n.label;
      if (n.note) a.note = n.note;
    }
  }
  const files = state.files.map((f) => ({ ...f.record, duplicatesRemoved: res.duplicatesByFile[f.record.id] ?? 0 }));
  return {
    txns: res.txns,
    accounts,
    aliasSuggestions: res.aliasSuggestions,
    mirrorsMerged: res.mirrorsMerged,
    ambiguousMirrors: res.ambiguousMirrors,
    files,
  };
}
