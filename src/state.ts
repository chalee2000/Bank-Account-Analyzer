// สถานะส่วนกลางของแอป (signals) และ action ที่ UI เรียกใช้
import { computed, signal } from '@preact/signals';
import type { AnalysisResult, Account, Finding, Txn } from './core/types';
import { createEngine, type AnalysisEngine } from './analysis/client';
import { accountLabel } from './analysis/ctx';
import {
  deleteCase, deleteFile, listCases, loadCase, saveCaseBase, saveFile, wipeAll, getKv, setKv,
} from './store/db';
import { createCaseState, deriveCase, newId, type AccountNote, type CaseState, type Derived, type StoredFile } from './store/model';

// ---------- Router ----------
export interface Route {
  path: string;
  params: URLSearchParams;
}
function parseHash(): Route {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, q] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(q ?? '') };
}
export const route = signal<Route>(parseHash());
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.value = parseHash();
  });
}
export function go(path: string, params?: Record<string, string>) {
  const q = params ? '?' + new URLSearchParams(params).toString() : '';
  location.hash = path + q;
}

// ---------- UI state ----------
export type ThemeMode = 'auto' | 'light' | 'dark';
function loadTheme(): ThemeMode {
  try {
    const v = localStorage.getItem('baa-theme');
    if (v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  return 'auto';
}
export const theme = signal<ThemeMode>(loadTheme());
export function setTheme(t: ThemeMode) {
  theme.value = t;
  try { localStorage.setItem('baa-theme', t); } catch { /* ignore */ }
  applyTheme();
}
export function applyTheme() {
  const el = document.documentElement;
  if (theme.value === 'auto') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', theme.value);
}

export interface Toast { id: number; text: string; kind: 'ok' | 'err' }
export const toasts = signal<Toast[]>([]);
let toastId = 1;
export function notify(text: string, kind: 'ok' | 'err' = 'ok', ms = 4500) {
  const id = toastId++;
  toasts.value = [...toasts.value, { id, text, kind }].slice(-3); // แสดงสูงสุด 3 รายการ
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), kind === 'err' ? Math.max(ms, 7000) : ms);
}

export const busy = signal<string | null>(null);

export type InspectorTarget =
  | { kind: 'account'; id: string }
  | { kind: 'signal'; id: string }
  | { kind: 'txn'; id: string };
export const inspector = signal<InspectorTarget | null>(null);
export function openInspector(t: InspectorTarget | null) {
  inspector.value = t;
}

// ---------- Case state ----------
export const caseList = signal<Awaited<ReturnType<typeof listCases>>>([]);
export const cs = signal<CaseState | null>(null);
export const derived = signal<Derived | null>(null);
export const analysis = signal<AnalysisResult | null>(null);
export const analysisNotes = signal<string[]>([]);
export const analysisMs = signal(0);
export const analysisError = signal<string | null>(null);

export const txnById = computed(() => {
  const m = new Map<string, Txn>();
  for (const t of derived.value?.txns ?? []) m.set(t.id, t);
  return m;
});
export const accounts = computed<Record<string, Account>>(() => derived.value?.accounts ?? {});

export function labelOf(id: string, withBank = true): string {
  return accountLabel(accounts.value[id], withBank);
}
export function shortLabel(id: string): string {
  const a = accounts.value[id];
  if (!a) return id;
  if (a.kind !== 'account') return a.name ?? id;
  return a.label || a.name || a.number || id;
}

let engine: AnalysisEngine | null = null;
const getEngine = () => (engine ??= createEngine());
export function engineTrace(input: Parameters<AnalysisEngine['trace']>[0]) {
  return getEngine().trace(input);
}

export async function refreshCases() {
  caseList.value = await listCases();
}

export async function createCase(name: string, extra: { caseNumber?: string; investigator?: string; agency?: string } = {}) {
  const st = createCaseState(name, extra);
  await saveCaseBase(st);
  await refreshCases();
  await openCase(st.meta.id);
  return st;
}

export async function openCase(id: string) {
  busy.value = 'กำลังเปิดคดี…';
  try {
    const st = await loadCase(id);
    if (!st) throw new Error('ไม่พบคดี');
    cs.value = st;
    analysis.value = null;
    inspector.value = null;
    try { await setKv('lastCase', id); } catch { /* ignore */ }
    await recompute();
  } finally {
    busy.value = null;
  }
}

export function closeCase() {
  cs.value = null;
  derived.value = null;
  analysis.value = null;
  inspector.value = null;
  go('/');
}

export async function removeCase(id: string) {
  await deleteCase(id);
  if (cs.value?.meta.id === id) closeCase();
  await refreshCases();
}

export async function tryRestoreLastCase() {
  await refreshCases();
  const last = await getKv<string>('lastCase').catch(() => undefined);
  if (last && caseList.value.some((c) => c.id === last)) {
    // เปิดแอปใหม่โดยไม่ระบุหน้า → ไปที่ภาพรวมของคดีล่าสุด; ถ้าระบุหน้า (ลิงก์/รีเฟรช) คงหน้าเดิมไว้
    if (!location.hash || location.hash === '#/' || location.hash === '#') go('/dashboard');
    await openCase(last);
  }
}

let seq = 0;

/** ลายเซ็นของข้อมูลนำเข้า+ค่าตั้งต้นวิเคราะห์ ใช้ตรวจว่าข้อสรุปอัตโนมัติล้าสมัยหรือไม่ */
export function dataSignature(st: CaseState): string {
  return st.files.map((f) => f.record.sha256.slice(0, 12)).sort().join(',') + '|' + JSON.stringify(st.settings) + '|' + JSON.stringify(st.aliases);
}
export const findingsStale = computed(() => {
  const st = cs.value;
  return !!st && st.findingsGenerated && st.findingsSig !== dataSignature(st) && st.files.length > 0;
});

export async function recompute() {
  const st = cs.peek();
  if (!st) return;
  const my = ++seq;
  const d = deriveCase(st);
  derived.value = d;
  analysisError.value = null;
  if (!d.txns.length) {
    analysis.value = null;
    return;
  }
  busy.value = 'กำลังวิเคราะห์ข้อมูล…';
  try {
    const out = await getEngine().analyze({
      txns: d.txns, accounts: d.accounts, files: d.files, settings: st.settings, mirrorsMerged: d.mirrorsMerged,
    });
    if (my !== seq) return;
    analysis.value = out.result;
    analysisNotes.value = out.notes;
    analysisMs.value = out.ms;
    const cur = cs.peek()!;
    const hasManual = cur.findings.some((f) => f.source === 'manual');
    const autoCount = cur.findings.filter((f) => f.source === 'auto').length;
    // สร้างร่างอัตโนมัติครั้งแรก หรือสร้างใหม่เงียบ ๆ เมื่อข้อมูลเปลี่ยนและผู้ใช้ยังไม่ได้แก้/เพิ่มข้อความเอง
    if ((!cur.findingsGenerated && autoCount === 0) || (cur.findingsGenerated && !hasManual && cur.findingsSig !== dataSignature(cur))) {
      await regenerateFindings();
    }
  } catch (e) {
    analysisError.value = e instanceof Error ? e.message : String(e);
    notify('วิเคราะห์ข้อมูลไม่สำเร็จ: ' + analysisError.value, 'err');
  } finally {
    if (my === seq) busy.value = null;
  }
}

export async function patchCase(patch: Partial<CaseState>, opts: { recompute?: boolean } = {}) {
  const cur = cs.peek();
  if (!cur) return;
  const next = { ...cur, ...patch, meta: { ...cur.meta, ...(patch.meta ?? {}), updatedAt: Date.now() } };
  cs.value = next;
  await saveCaseBase(next);
  if (opts.recompute) await recompute();
  void refreshCases();
}

export async function addStoredFile(f: StoredFile) {
  const cur = cs.peek()!;
  await saveFile(cur.meta.id, f);
  cs.value = { ...cur, files: [...cur.files, f], meta: { ...cur.meta, updatedAt: Date.now() } };
  await saveCaseBase(cs.value);
  await recompute();
  void refreshCases();
}

export async function removeStoredFile(fileId: string) {
  const cur = cs.peek()!;
  await deleteFile(cur.meta.id, fileId);
  cs.value = { ...cur, files: cur.files.filter((f) => f.record.id !== fileId) };
  await saveCaseBase(cs.value);
  await recompute();
}

export async function replaceCaseState(st: CaseState) {
  // ใช้ตอนนำเข้าไฟล์คดี: บันทึกทั้งหมดลง IndexedDB
  await saveCaseBase(st);
  for (const f of st.files) await saveFile(st.meta.id, f);
  await refreshCases();
  await openCase(st.meta.id);
}

export async function regenerateFindings() {
  const cur = cs.peek();
  if (!cur) return;
  const auto = await getEngine().findings();
  const manual = cur.findings.filter((f) => f.source === 'manual');
  const next: Finding[] = [...auto, ...manual];
  await patchCase({ findings: next, findingsGenerated: true, findingsSig: dataSignature(cur) });
}

export async function setAccountNote(id: string, note: AccountNote) {
  const cur = cs.peek();
  if (!cur) return;
  const next = { ...(cur.accountNotes[id] ?? {}), ...note };
  for (const k of Object.keys(next) as (keyof AccountNote)[]) if (!next[k]) delete next[k];
  const accountNotes = { ...cur.accountNotes };
  if (Object.keys(next).length) accountNotes[id] = next;
  else delete accountNotes[id];
  await patchCase({ accountNotes });
  // ชื่อ/หมายเหตุแสดงผ่าน Account — แก้เฉพาะบัญชีนี้ ไม่ต้องรวมไฟล์ทั้งคดีใหม่ (รูปอ่านจาก accountNotes โดยตรง)
  const d = derived.peek();
  const acc = d?.accounts[id];
  if (d && acc && (acc.label !== next.label || acc.note !== next.note)) {
    derived.value = { ...d, accounts: { ...d.accounts, [id]: { ...acc, label: next.label, note: next.note } } };
  }
}

/** รวมสองบัญชีเป็นหน่วยเดียว (ผู้ใช้ยืนยัน) — บัญชีที่มี statement/เลขเต็มเป็นตัวหลัก */
export async function mergeAccounts(a: string, b: string) {
  const cur = cs.peek();
  if (!cur) return;
  const acc = accounts.value;
  const rank = (id: string) => (acc[id]?.hasStatement ? 0 : 1) + (acc[id]?.masked ? 2 : 0);
  const aliases = cur.aliases.map((g) => ({ ...g, members: [...g.members] }));
  const ga = aliases.find((g) => g.members.includes(a));
  const gb = aliases.find((g) => g.members.includes(b));
  let group = ga ?? gb;
  if (!group) {
    group = { id: newId('g_'), members: [] };
    aliases.push(group);
  }
  for (const id of [a, b]) if (!group.members.includes(id)) group.members.push(id);
  if (ga && gb && ga !== gb) {
    for (const id of gb.members) if (!group.members.includes(id)) group.members.push(id);
    aliases.splice(aliases.indexOf(gb), 1);
  }
  group.members.sort((x, y) => rank(x) - rank(y));
  await patchCase({ aliases }, { recompute: true });
  notify('รวมบัญชีแล้ว — วิเคราะห์ข้อมูลใหม่');
}

export async function removeAlias(groupId: string) {
  const cur = cs.peek();
  if (!cur) return;
  await patchCase({ aliases: cur.aliases.filter((g) => g.id !== groupId) }, { recompute: true });
}

export async function wipeEverything() {
  await wipeAll();
  cs.value = null;
  derived.value = null;
  analysis.value = null;
  caseList.value = [];
  go('/');
}

export { newId };
