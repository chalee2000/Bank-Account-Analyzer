export class PdfPasswordError extends Error {
  constructor(public readonly wrong: boolean) {
    super(wrong ? 'รหัสผ่าน PDF ไม่ถูกต้อง' : 'PDF นี้ต้องใช้รหัสผ่าน');
    this.name = 'PdfPasswordError';
  }
}

export class UnsupportedFileError extends Error {}
