// ตัวอ่าน OLE Compound File (CFB) แบบขั้นต่ำ สำหรับดึง stream จากไฟล์ Office ที่เข้ารหัสด้วยรหัสผ่าน
// รองรับ sector 512/4096 ไบต์, FAT + DIFAT และ mini stream — อ่านอย่างเดียว ไม่ตีความโครงสร้างโฟลเดอร์
import { UnsupportedFileError } from './errors';

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const MAX_REGULAR_SECTOR = 0xfffffffa;
const HEADER_DIFAT_ENTRIES = 109;
const DIR_ENTRY_SIZE = 128;
const TYPE_STREAM = 2;
const TYPE_ROOT = 5;

export function isCfb(b: Uint8Array): boolean {
  return b.length >= 8 && SIGNATURE.every((v, i) => b[i] === v);
}

export interface Cfb {
  has(name: string): boolean;
  read(name: string): Uint8Array | undefined;
}

interface DirEntry {
  name: string;
  type: number;
  start: number;
  size: number;
}

const corrupt = () => new UnsupportedFileError('ไฟล์ Office (OLE) เสียหายหรืออ่านโครงสร้างไม่ได้');

export function parseCfb(bytes: Uint8Array): Cfb {
  if (!isCfb(bytes) || bytes.length < 512) throw corrupt();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorSize = 1 << dv.getUint16(30, true);
  const miniSectorSize = 1 << dv.getUint16(32, true);
  if (sectorSize !== 512 && sectorSize !== 4096) throw corrupt();
  const dirStart = dv.getUint32(48, true);
  const miniCutoff = dv.getUint32(56, true);
  const miniFatStart = dv.getUint32(60, true);
  const difStart = dv.getUint32(68, true);
  const difCount = dv.getUint32(72, true);

  // sector 0 อยู่หลังส่วนหัวขนาดเต็ม 1 sector (512 หรือ 4096) เสมอ
  const sector = (i: number): Uint8Array => {
    const off = (i + 1) * sectorSize;
    if (off + sectorSize > bytes.length) throw corrupt();
    return bytes.subarray(off, off + sectorSize);
  };
  const u32s = (s: Uint8Array): number[] => {
    const v = new DataView(s.buffer, s.byteOffset, s.byteLength);
    const out: number[] = [];
    for (let i = 0; i + 4 <= s.length; i += 4) out.push(v.getUint32(i, true));
    return out;
  };

  const fatSectors: number[] = [];
  for (let i = 0; i < HEADER_DIFAT_ENTRIES; i++) {
    const v = dv.getUint32(76 + i * 4, true);
    if (v < MAX_REGULAR_SECTOR) fatSectors.push(v);
  }
  let dif = difStart;
  for (let k = 0; k < difCount && dif < MAX_REGULAR_SECTOR; k++) {
    const entries = u32s(sector(dif));
    for (let i = 0; i < entries.length - 1; i++) if (entries[i]! < MAX_REGULAR_SECTOR) fatSectors.push(entries[i]!);
    dif = entries[entries.length - 1]!;
  }
  const fat = fatSectors.flatMap((s) => u32s(sector(s)));

  const chain = (start: number): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let c = start; c < MAX_REGULAR_SECTOR; c = fat[c] ?? 0xfffffffe) {
      if (seen.has(c)) throw corrupt();
      seen.add(c);
      out.push(c);
    }
    return out;
  };
  const concat = (parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const readChain = (start: number): Uint8Array => concat(chain(start).map(sector));

  const dir = readChain(dirStart);
  const dirView = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries: DirEntry[] = [];
  for (let o = 0; o + DIR_ENTRY_SIZE <= dir.length; o += DIR_ENTRY_SIZE) {
    const nameBytes = dirView.getUint16(o + 64, true);
    if (nameBytes < 2) continue;
    let name = '';
    for (let i = 0; i < nameBytes - 2; i += 2) name += String.fromCharCode(dirView.getUint16(o + i, true));
    entries.push({
      name,
      type: dir[o + 66]!,
      start: dirView.getUint32(o + 116, true),
      size: dirView.getUint32(o + 120, true) + dirView.getUint32(o + 124, true) * 2 ** 32,
    });
  }

  let miniStream: Uint8Array | undefined;
  let miniFat: number[] | undefined;
  const loadMini = () => {
    if (miniStream && miniFat) return { stream: miniStream, fat: miniFat };
    const root = entries.find((e) => e.type === TYPE_ROOT);
    if (!root) throw corrupt();
    miniStream = readChain(root.start);
    miniFat = miniFatStart < MAX_REGULAR_SECTOR ? u32s(readChain(miniFatStart)) : [];
    return { stream: miniStream, fat: miniFat };
  };

  const findStream = (name: string) => entries.find((e) => e.type === TYPE_STREAM && e.name === name);

  return {
    has: (name) => !!findStream(name),
    read(name) {
      const e = findStream(name);
      if (!e) return undefined;
      if (e.size >= miniCutoff) return readChain(e.start).subarray(0, e.size);
      const { stream, fat: mfat } = loadMini();
      const parts: Uint8Array[] = [];
      const seen = new Set<number>();
      for (let c = e.start; c < MAX_REGULAR_SECTOR; c = mfat[c] ?? 0xfffffffe) {
        if (seen.has(c)) throw corrupt();
        seen.add(c);
        parts.push(stream.subarray(c * miniSectorSize, (c + 1) * miniSectorSize));
      }
      return concat(parts).subarray(0, e.size);
    },
  };
}
