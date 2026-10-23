/** ไฟล์ที่ตั้งรหัสผ่าน (PDF หรือ Excel) — wrong=true เมื่อมีรหัสแล้วแต่ไม่ถูกต้อง */
export class FilePasswordError extends Error {
  constructor(public readonly wrong: boolean, public readonly fileKind: 'PDF' | 'Excel' = 'PDF') {
    const what = fileKind === 'PDF' ? 'PDF' : 'ไฟล์ Excel';
    super(wrong ? `รหัสผ่าน ${what} ไม่ถูกต้อง` : `${what} นี้ต้องใช้รหัสผ่าน`);
    this.name = 'FilePasswordError';
  }
}

export class UnsupportedFileError extends Error {}
