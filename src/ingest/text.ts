import { thaiDigitsToArabic } from '../core/thai';
// ถอดรหัสไฟล์ข้อความ — CSV จากระบบธนาคาร/โปรแกรมเก่าของไทยมักเป็น TIS-620 / Windows-874

export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // ไม่ใช่ UTF-8 ที่ถูกต้อง → ลอง Windows-874 (ซูเปอร์เซ็ตของ TIS-620)
    try {
      return { text: new TextDecoder('windows-874').decode(bytes), encoding: 'windows-874' };
    } catch {
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8 (lossy)' };
    }
  }
}

/** ทำให้ข้อความหัวคอลัมน์เทียบกันได้: เลขไทย→อารบิก ตัวพิมพ์เล็ก ตัดช่องว่างและเครื่องหมาย */
export function normalizeHeader(s: string): string {
  return thaiDigitsToArabic(s).toLowerCase().replace(/[\s._\-()[\]/\\:*]/g, '');
}
