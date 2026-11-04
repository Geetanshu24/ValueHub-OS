import { describe, expect, it } from 'vitest';
import { safeFileName, sniffMime } from './file-validation.js';

describe('sniffMime', () => {
  it('recognises allowed types from their bytes', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffMime(Buffer.from('RIFF1234WEBPVP8 '))).toBe('image/webp');
  });

  it('rejects everything else, including scripts renamed as images', () => {
    expect(sniffMime(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });
});

describe('safeFileName', () => {
  it('drops directories and unsafe characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\evil\\deed<1>.pdf')).toBe('deed_1_.pdf');
    expect(safeFileName('')).toBe('file');
  });
});
