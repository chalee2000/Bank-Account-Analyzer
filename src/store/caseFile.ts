// ส่งออก/นำเข้าไฟล์คดีเพื่อสำรองข้อมูลหรือย้ายระหว่างเครื่อง
// รูปแบบ: JSON → (gzip) → เข้ารหัส AES-GCM-256 ด้วยคีย์จาก passphrase (PBKDF2-SHA256 250,000 รอบ)
// ถ้าไม่ตั้ง passphrase ไฟล์จะไม่เข้ารหัส (ผู้ใช้ต้องเลือกโดยตั้งใจ)
import type { CaseState } from './model';

const MAGIC = 'BAA1';
const ITER = 250_000;

function toB64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return data;
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  void w.write(data as BufferSource);
  void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter();
  void w.write(data as BufferSource);
  void w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

async function deriveKey(pass: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('รหัสผ่านไม่ถูกต้อง หรือไฟล์เสียหาย');
  }
}

export async function exportCase(state: CaseState, passphrase?: string): Promise<Blob> {
  const json = new TextEncoder().encode(JSON.stringify({ app: 'bank-account-analyzer', version: 1, state }));
  const compressed = await gzip(json);
  const gz = typeof CompressionStream !== 'undefined';
  let header: Record<string, unknown>;
  let payload: Uint8Array;
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, ITER);
    payload = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, compressed as BufferSource));
    header = { enc: 'aes-gcm', kdf: 'pbkdf2-sha256', iter: ITER, salt: toB64(salt), iv: toB64(iv), gz };
  } else {
    payload = compressed;
    header = { enc: 'none', gz };
  }
  const head = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, head.length);
  const parts: BlobPart[] = [MAGIC, len as BlobPart, head as BlobPart, payload as BlobPart];
  return new Blob(parts, { type: 'application/octet-stream' });
}

export async function inspectCaseFile(buf: ArrayBuffer): Promise<{ encrypted: boolean }> {
  const { header } = parse(buf);
  return { encrypted: header.enc === 'aes-gcm' };
}

function parse(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error('ไม่ใช่ไฟล์คดีของแอปนี้');
  const hl = new DataView(buf, 4, 4).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))) as Record<string, any>;
  return { header, payload: bytes.subarray(8 + hl) };
}

export async function importCase(buf: ArrayBuffer, passphrase?: string): Promise<CaseState> {
  const { header, payload } = parse(buf);
  let data: Uint8Array = payload;
  if (header.enc === 'aes-gcm') {
    if (!passphrase) throw new WrongPassphraseError();
    const key = await deriveKey(passphrase, fromB64(header.salt), header.iter);
    try {
      data = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(header.iv) as BufferSource }, key, payload as BufferSource),
      );
    } catch {
      throw new WrongPassphraseError();
    }
  }
  if (header.gz) data = await gunzip(data);
  const obj = JSON.parse(new TextDecoder().decode(data));
  if (obj.app !== 'bank-account-analyzer' || !obj.state) throw new Error('โครงสร้างไฟล์คดีไม่ถูกต้อง');
  return obj.state as CaseState;
}
