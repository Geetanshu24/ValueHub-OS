import { BadRequestException } from '@nestjs/common';

export type AllowedMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

// The client-declared mimetype is spoofable, so the type is decided from the
// file's own leading bytes.
export function sniffMime(buffer: Buffer): AllowedMime | null {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function requireFile(
  file: Express.Multer.File | undefined,
  allowed: readonly AllowedMime[],
): { file: Express.Multer.File; mimeType: AllowedMime } {
  if (!file || file.size === 0) throw new BadRequestException('A non-empty file is required');
  const mimeType = sniffMime(file.buffer);
  if (!mimeType || !allowed.includes(mimeType)) {
    throw new BadRequestException(`Unsupported file type; allowed: ${allowed.join(', ')}`);
  }
  return { file, mimeType };
}

// Strips path separators and control characters from a client-supplied name.
export function safeFileName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^\w.\- ()]/g, '_').trim().slice(0, 200);
  return cleaned || 'file';
}
