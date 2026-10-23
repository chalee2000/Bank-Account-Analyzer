import Papa from 'papaparse';
import { decodeText } from './text';
import type { RawTable } from './types';

export function readCsv(bytes: Uint8Array): RawTable {
  const { text, encoding } = decodeText(bytes);
  const res = Papa.parse<string[]>(text, {
    skipEmptyLines: false,
    delimitersToGuess: [',', '\t', ';', '|'],
  });
  const rows = res.data.map((r) => r.map((c) => (c ?? '').toString().replace(/\s+/g, ' ').trim()));
  while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
  const notes: string[] = [];
  if (encoding !== 'utf-8') notes.push(`ถอดรหัสไฟล์เป็น ${encoding}`);
  return { fileType: 'csv', rows, notes };
}
