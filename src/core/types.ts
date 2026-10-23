// โครงสร้างข้อมูลกลางของแอป — ทุกโมดูล (ingest / analysis / ui / report) ใช้ร่วมกัน
//
// เวลา: เก็บเป็น "เวลาตามที่ปรากฏใน statement" (wall-clock, สมมติ Asia/Bangkok) แล้วแปลงเป็น epoch ms
// ด้วย Date.UTC(...) เพื่อไม่ให้ผลวิเคราะห์ขึ้นกับ timezone ของเครื่อง ใช้ getUTC* ตอนแสดงผล

export type AccountKind = 'account' | 'cash' | 'unknown';

export interface Account {
  /** คีย์ภายใน: `${bankCode|?}:${normalizedNumber}` หรือ `cash:${ownerId}` / `unknown:${ownerId}` / `name:${name}` */
  id: string;
  /** เลขบัญชีที่ normalize แล้ว (อาจมี X แทนหลักที่ถูกปิดบัง) */
  number: string;
  name?: string;
  /** รหัสธนาคารมาตรฐาน เช่น KBANK, SCB (ดู normalize.ts) */
  bank?: string;
  masked: boolean;
  kind: AccountKind;
  /** มีไฟล์ statement ของบัญชีนี้อยู่ในคดี */
  hasStatement: boolean;
  /** ชื่อ/หมายเหตุที่ผู้สืบสวนกรอกเอง */
  label?: string;
  note?: string;
}

export type TxnKind =
  | 'transfer'
  | 'cash_deposit'
  | 'cash_withdrawal'
  | 'payment'
  | 'fee'
  | 'interest'
  | 'other';

export interface SourceRef {
  fileId: string;
  /** เลขแถวในไฟล์ต้นฉบับ (เริ่มที่ 1 นับรวมแถวหัวตาราง ถ้ามี) */
  row: number;
}

/** ธุรกรรมที่ normalize แล้ว เป็นเส้นทางเงินทิศเดียว from → to */
export interface Txn {
  id: string;
  /** epoch ms ของเวลาตาม statement (ดูหมายเหตุด้านบน) */
  ts: number;
  /** false = statement มีเฉพาะวันที่ ไม่มีเวลา (ts = 00:00) */
  hasTime: boolean;
  /** ลำดับในไฟล์ต้นฉบับ ใช้ตัดสินลำดับเมื่อเวลาเท่ากัน */
  seq: number;
  from: string;
  to: string;
  amount: number;
  kind: TxnKind;
  channel?: string;
  description?: string;
  reference?: string;
  location?: string;
  /** ยอดคงเหลือหลังทำรายการ ในมุมของบัญชีเจ้าของ statement */
  balanceAfter?: number;
  /** บัญชีเจ้าของ statement ที่รายการนี้มาจาก (อาจมีมากกว่า 1 ถ้าเป็น mirror) */
  owners: string[];
  sources: SourceRef[];
  /** ผูกคู่บัญชีจากการเดาข้อความ/เลขที่ปิดบาง — ต้องตรวจสอบ */
  inferred?: boolean;
  /** รายการนี้ถูกรวมจาก 2 statement (mirror) */
  mirrored?: boolean;
  /** ค่าเตือนคุณภาพข้อมูลระดับรายการ */
  flags?: string[];
}

export interface FileRecord {
  id: string;
  name: string;
  size: number;
  sha256: string;
  type: 'csv' | 'xlsx' | 'pdf-text' | 'pdf-ocr' | 'image-ocr';
  importedAt: number;
  /** บัญชีเจ้าของ statement */
  ownerAccountId: string;
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  duplicatesRemoved: number;
  firstTs?: number;
  lastTs?: number;
  /** คำเตือนระดับไฟล์ */
  warnings: string[];
  /** ผลตรวจ running balance */
  balanceChecks?: { checked: number; mismatches: number };
  mappingSummary?: string;
}

export interface CaseMeta {
  id: string;
  name: string;
  caseNumber?: string;
  investigator?: string;
  agency?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------- Analysis ----------

export interface AnalysisSettings {
  /** หน้าต่างเวลาของ Rapid Movement (นาที) */
  rapidWindowMin: number;
  /** สัดส่วนเงินออก/เงินเข้า ขั้นต่ำที่ถือว่า "ไหลผ่านเร็ว" */
  rapidMinRatio: number;
  /** ยอดขั้นต่ำของรายการที่นำมาพิจารณาเป็นสัญญาณ (บาท) */
  minSignalAmount: number;
  /** Structuring/Splitting */
  splitWindowMin: number;
  splitMinCount: number;
  /** ยอดแต่ละรายการต้องอยู่ในช่วง ±สัดส่วนนี้ของค่ามัธยฐาน */
  splitAmountTolerance: number;
  /** ยอดวงเงินที่ผู้ใช้สนใจ — ตรวจรายการที่อยู่ "ใต้" วงเงินเล็กน้อย (ว่างได้) */
  thresholds: number[];
  thresholdBand: number;
  /** Convergence */
  convergeWindowMin: number;
  convergeMinSenders: number;
  /** Layering / Circular */
  chainWindowMin: number;
  chainMinHops: number;
  /** สัดส่วนยอดที่ต้องคงเหลือต่อทอด (เช่น 0.85 = ยอมให้หายไป 15%) */
  chainMinRetain: number;
  circularWindowHours: number;
  /** Cash-out */
  cashOutWindowMin: number;
  /** Repeated pattern: จำนวนวันที่แตกต่างกันขั้นต่ำ */
  repeatedMinDays: number;
  /** Tracing */
  traceMaxGapHours: number;
  /** ความคลาดเคลื่อนของยอด (เช่น ค่าธรรมเนียม) */
  amountTolerance: number;
  /** Mirror matching */
  mirrorToleranceMin: number;
}

export type SignalType =
  | 'rapid_movement'
  | 'structuring'
  | 'convergence'
  | 'layering'
  | 'circular'
  | 'cash_out'
  | 'cross_bank'
  | 'repeated'
  | 'near_threshold';

export interface Signal {
  id: string;
  type: SignalType;
  /** บัญชีที่เป็นศูนย์กลางของสัญญาณ (เช่น จุดรวมเงิน) */
  focus: string[];
  /** ธุรกรรมที่เป็นหลักฐาน (id) */
  txnIds: string[];
  /** ช่วงเวลา */
  startTs: number;
  endTs: number;
  totalAmount: number;
  /** ความเด่นของสัญญาณ 1–3 (ไม่ใช่ระดับความผิด) */
  prominence: 1 | 2 | 3;
  /** รายละเอียดเฉพาะชนิด (แสดงในตาราง/รายงาน) */
  metrics: Record<string, number | string>;
  /** ข้อความบรรยายแบบระมัดระวัง */
  summary: string;
  /** มีรายการที่ไม่มีเวลา ทำให้ช่วงเวลาไม่ละเอียด */
  timeApprox?: boolean;
}

export interface AccountProfile {
  accountId: string;
  totalIn: number;
  totalOut: number;
  net: number;
  inCount: number;
  outCount: number;
  uniqueSenders: number;
  uniqueReceivers: number;
  avgAmount: number;
  medianAmount: number;
  maxAmount: number;
  firstTs?: number;
  lastTs?: number;
  /** เงินออก / เงินเข้า × 100 — เป็นตัวชี้วัดการไหลผ่านเท่านั้น */
  flowThrough: number | null;
  holding: HoldingStats;
}

export interface HoldingStats {
  /** จำนวนจับคู่ที่ใช้คำนวณ */
  pairs: number;
  medianMs: number | null;
  minMs: number | null;
  /** สัดส่วนของยอดเงินเข้าที่ออกภายใน X นาที (0–1) */
  shareWithin: { 5: number; 15: number; 30: number; 60: number };
  /** ยอดเงินออกที่ไม่สามารถจับกับเงินเข้าที่ปรากฏในข้อมูล (ยอดยกมา/ไม่มี statement) */
  unmatchedOut: number;
}

export interface FlowLink {
  /** null = ใช้ยอดที่มีอยู่ก่อนช่วงข้อมูล (ยอดยกมา) */
  inTxn: string | null;
  outTxn: string;
  via: string;
  amount: number;
  holdingMs: number;
}

export interface PairStat {
  from: string;
  to: string;
  total: number;
  count: number;
  firstTs: number;
  lastTs: number;
}

export interface NodeMetrics {
  accountId: string;
  inDegree: number;
  outDegree: number;
  degree: number;
  weightedIn: number;
  weightedOut: number;
  betweenness: number;
  isBridge: boolean;
  component: number;
  community: number;
}

export type RoleHintKey =
  | 'source'
  | 'convergence'
  | 'transit'
  | 'bridge'
  | 'cash_out'
  | 'asset_conversion';

export interface RoleHint {
  role: RoleHintKey;
  /** เหตุผลเชิงข้อมูล */
  reason: string;
}

export interface PriorityComponents {
  volume: number;
  frequency: number;
  flowThrough: number;
  quickHolding: number;
  degree: number;
  betweenness: number;
  signals: number;
}

export interface PriorityRow {
  accountId: string;
  components: PriorityComponents;
  /** ผลรวมเพื่อเรียงลำดับการตรวจเท่านั้น ไม่ใช่คะแนนความผิด */
  orderingScore: number;
}

export interface DataQuality {
  totalRows: number;
  imported: number;
  skipped: number;
  duplicatesRemoved: number;
  mirrorsMerged: number;
  noCounterparty: number;
  noTime: number;
  inferredCounterparty: number;
  balanceMismatch: number;
  firstTs?: number;
  lastTs?: number;
  perFile: FileRecord[];
}

export interface AnalysisResult {
  settings: AnalysisSettings;
  generatedAt: number;
  profiles: Record<string, AccountProfile>;
  pairs: PairStat[];
  links: FlowLink[];
  signals: Signal[];
  metrics: Record<string, NodeMetrics>;
  roleHints: Record<string, RoleHint[]>;
  priority: PriorityRow[];
  quality: DataQuality;
}

// ---------- Trace ----------

export interface TraceEdge {
  txnId: string;
  from: string;
  to: string;
  ts: number;
  amount: number;
  /** ยอดที่ถูกอ้างถึงในเส้นทางนี้ (อาจน้อยกว่า amount) */
  traced: number;
  depth: number;
}

export interface TraceResult {
  direction: 'forward' | 'backward';
  seed: { accountId?: string; txnId?: string };
  edges: TraceEdge[];
  /** เส้นทางแบบลำดับ txn id */
  paths: string[][];
  /** บัญชีปลายทาง (forward) / ต้นทาง (backward) */
  terminals: { accountId: string; amount: number; cash: boolean }[];
  truncated: boolean;
}

// ---------- Findings & notes ----------

export type FindingLevel = 'fact' | 'observation' | 'hypothesis' | 'recommendation';

export interface Finding {
  id: string;
  level: FindingLevel;
  text: string;
  include: boolean;
  source: 'auto' | 'manual';
  /** อ้างอิงสัญญาณ/ธุรกรรมที่เกี่ยวข้อง */
  signalId?: string;
  txnIds?: string[];
  /** กลุ่มที่ให้ hypothesis/recommendation ผูกกับ fact เดียวกัน */
  group?: string;
}

export interface AltHypothesis {
  id: string;
  label: string;
  status: 'open' | 'considered' | 'ruled_out' | 'supported';
  note?: string;
}

export interface CaseEvent {
  id: string;
  ts: number;
  title: string;
  detail?: string;
  accountIds: string[];
  category: 'atm_cctv' | 'arrest' | 'field' | 'communication' | 'other';
  /** แหล่งที่มา/เลขที่เอกสาร */
  source?: string;
}

export interface ManualNode {
  id: string;
  type: 'person' | 'phone' | 'vehicle' | 'device' | 'location' | 'other';
  label: string;
  note?: string;
}

export interface ManualLink {
  id: string;
  a: string;
  b: string;
  label: string;
  note?: string;
}

export interface AliasGroup {
  id: string;
  /** บัญชีที่ผู้ใช้ยืนยันว่าเป็นเจ้าของ/หน่วยเดียวกัน → รวมเป็น id แรก */
  members: string[];
}

export interface CaseData {
  meta: CaseMeta;
  accounts: Record<string, Account>;
  txns: Txn[];
  files: FileRecord[];
  settings: AnalysisSettings;
  findings: Finding[];
  altHypotheses: AltHypothesis[];
  events: CaseEvent[];
  manualNodes: ManualNode[];
  manualLinks: ManualLink[];
  aliases: AliasGroup[];
  /** บัญชี/ธุรกรรมที่ปักหมุดไว้ใส่รายงาน */
  pinnedTraces: { id: string; label: string; direction: 'forward' | 'backward'; seed: { accountId?: string; txnId?: string } }[];
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  rapidWindowMin: 60,
  rapidMinRatio: 0.8,
  minSignalAmount: 10_000,
  splitWindowMin: 60,
  splitMinCount: 3,
  splitAmountTolerance: 0.15,
  thresholds: [50_000, 100_000, 200_000],
  thresholdBand: 0.1,
  convergeWindowMin: 120,
  convergeMinSenders: 3,
  chainWindowMin: 120,
  chainMinHops: 3,
  chainMinRetain: 0.85,
  circularWindowHours: 72,
  cashOutWindowMin: 120,
  repeatedMinDays: 3,
  traceMaxGapHours: 24,
  amountTolerance: 0.02,
  mirrorToleranceMin: 10,
};
