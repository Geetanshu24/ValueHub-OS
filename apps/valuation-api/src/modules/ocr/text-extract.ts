import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ExtractedText {
  pages: string[];
  // Why there is no text, when there is none.
  note?: string;
}

const OCR_TIMEOUT_MS = 90_000;
// pdf.js decodes JBIG2 and JPEG2000 scans with wasm files it must be told where to find;
// without them those images are silently dropped and a scan renders as blank paper.
const WASM_URL = pathToFileURL(join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'wasm') + '/').href;
// Deeds are often in Hindi or mixed; the language data downloads on first use.
const OCR_LANGS = process.env.OCR_LANGS ?? 'eng+hin';

const withTimeout = <T>(work: Promise<T>): Promise<T> =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('OCR timed out')), OCR_TIMEOUT_MS))]);

async function newWorker() {
  const { createWorker } = await import('tesseract.js');
  // Language data is cached outside the project folder.
  return createWorker(OCR_LANGS, 1, { cachePath: process.env.OCR_CACHE_DIR ?? tmpdir() });
}

// Reads the text layer of a PDF. A scanned PDF has none, so its pages are
// drawn to images and read with OCR instead.
export async function textFromPdf(bytes: Buffer): Promise<ExtractedText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: false, wasmUrl: WASM_URL });
  const document = await task.promise;
  const pages: string[] = [];
  try {
    for (let n = 1; n <= Math.min(document.numPages, 200); n += 1) {
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '')).join('').trim());
    }
  } finally {
    await task.destroy();
  }
  const total = pages.reduce((t, p) => t + p.length, 0);
  if (total >= 20) return { pages };
  return scannedPdf(bytes, pages.length);
}

const MAX_SCAN_PAGES = 40;
const RENDER_SCALE = 2;

// A scan has no text layer, so each page is drawn to an image and read with OCR.
async function scannedPdf(bytes: Buffer, pageCount: number): Promise<ExtractedText> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: false, wasmUrl: WASM_URL });
  const document = await task.promise;
  const worker = await newWorker();
  const pages: string[] = [];
  try {
    for (let n = 1; n <= Math.min(pageCount, MAX_SCAN_PAGES); n += 1) {
      const page = await document.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport }).promise;
      const result = await withTimeout(worker.recognize(canvas.toBuffer('image/png')));
      pages.push(result.data.text.trim());
    }
  } finally {
    await worker.terminate();
    await task.destroy();
  }
  const total = pages.reduce((t, p) => t + p.length, 0);
  return total < 20 ? { pages, note: 'No text could be read from the scanned PDF' } : { pages };
}

// The pages of a PDF as pictures (PNG), for reading by the AI where OCR is not good enough.
export async function renderPdfPages(bytes: Buffer, maxPages: number, scale = 1.6): Promise<Buffer[]> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, useSystemFonts: false, wasmUrl: WASM_URL });
  const document = await task.promise;
  const out: Buffer[] = [];
  try {
    for (let n = 1; n <= Math.min(document.numPages, maxPages); n += 1) {
      const page = await document.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport }).promise;
      out.push(canvas.toBuffer('image/png'));
    }
  } finally {
    await task.destroy();
  }
  return out;
}

// Optical character recognition for a photographed or scanned page. The first
// run downloads the language data, so it needs network access.
export async function textFromImage(bytes: Buffer): Promise<ExtractedText> {
  const worker = await newWorker();
  try {
    const result = await withTimeout(worker.recognize(bytes));
    const text = result.data.text.trim();
    return text.length < 5 ? { pages: [text], note: 'No text could be read from the image' } : { pages: [text] };
  } finally {
    await worker.terminate();
  }
}

export function extractText(bytes: Buffer, mime: string): Promise<ExtractedText> {
  return mime === 'application/pdf' ? textFromPdf(bytes) : textFromImage(bytes);
}
