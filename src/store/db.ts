// IndexedDB: เก็บคดีและไฟล์ที่นำเข้าไว้ในเครื่องเท่านั้น
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ColumnMapping } from '../ingest/types';
import type { CaseState, StoredFile } from './model';

interface Schema extends DBSchema {
  cases: { key: string; value: Omit<CaseState, 'files'> };
  files: { key: string; value: StoredFile & { key: string; caseId: string }; indexes: { byCase: string } };
  templates: { key: string; value: { key: string; mapping: ColumnMapping; label: string; updatedAt: number } };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB<Schema>('bank-account-analyzer', 1, {
      upgrade(d) {
        d.createObjectStore('cases', { keyPath: 'meta.id' });
        const f = d.createObjectStore('files', { keyPath: 'key' });
        f.createIndex('byCase', 'caseId');
        d.createObjectStore('templates', { keyPath: 'key' });
        d.createObjectStore('kv');
      },
    });
  }
  return dbp;
}

export async function listCases(): Promise<Pick<CaseState['meta'], 'id' | 'name' | 'caseNumber' | 'createdAt' | 'updatedAt'>[]> {
  const all = await (await db()).getAll('cases');
  return all.map((c) => c.meta).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadCase(id: string): Promise<CaseState | null> {
  const d = await db();
  const base = await d.get('cases', id);
  if (!base) return null;
  const files = (await d.getAllFromIndex('files', 'byCase', id)).map(({ key: _k, caseId: _c, ...f }) => f as StoredFile);
  files.sort((a, b) => a.record.importedAt - b.record.importedAt);
  return { ...base, files };
}

export async function saveCaseBase(state: CaseState): Promise<void> {
  const { files: _files, ...base } = state;
  base.meta = { ...base.meta, updatedAt: Date.now() };
  await (await db()).put('cases', base);
}

export async function saveFile(caseId: string, file: StoredFile): Promise<void> {
  await (await db()).put('files', { ...file, key: `${caseId}::${file.record.id}`, caseId });
}

export async function deleteFile(caseId: string, fileId: string): Promise<void> {
  await (await db()).delete('files', `${caseId}::${fileId}`);
}

export async function deleteCase(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['cases', 'files'], 'readwrite');
  await tx.objectStore('cases').delete(id);
  const keys = await tx.objectStore('files').index('byCase').getAllKeys(id);
  for (const k of keys) await tx.objectStore('files').delete(k);
  await tx.done;
}

export async function saveTemplate(key: string, label: string, mapping: ColumnMapping): Promise<void> {
  await (await db()).put('templates', { key, label, mapping, updatedAt: Date.now() });
}
export async function listTemplates() {
  return (await db()).getAll('templates');
}
export async function deleteTemplate(key: string) {
  await (await db()).delete('templates', key);
}

export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined;
}
export async function setKv(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key);
}

/** ลบข้อมูลทุกอย่างที่แอปเก็บไว้ในเครื่อง (คดี ไฟล์ เทมเพลต การตั้งค่า) */
export async function wipeAll(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['cases', 'files', 'templates', 'kv'], 'readwrite');
  await Promise.all([
    tx.objectStore('cases').clear(),
    tx.objectStore('files').clear(),
    tx.objectStore('templates').clear(),
    tx.objectStore('kv').clear(),
  ]);
  await tx.done;
}
