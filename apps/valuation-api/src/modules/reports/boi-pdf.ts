import PDFDocument from 'pdfkit';
import type { BoiDocument } from './report-blocks.js';

const MARGIN = 40;
const WIDTH = 595.28 - MARGIN * 2;
const BOTTOM = 841.89 - 60;

// Draws the same report as the Word file. The built-in PDF fonts cannot draw
// every script, so names in Hindi need REPORT_FONT_PATH (see the report PDF).
export function renderBoiPdf(document: BoiDocument, fonts: { regular: string | Buffer; bold: string | Buffer } = { regular: 'Helvetica', bold: 'Helvetica-Bold' }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: 'Valuation report - Bank of India', Author: document.letterhead.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const regular = (size = 9) => doc.font(fonts.regular as string).fontSize(size).fillColor('#000');
    const bold = (size = 9) => doc.font(fonts.bold as string).fontSize(size).fillColor('#000');
    const room = (height: number) => {
      if (doc.y + height > BOTTOM) doc.addPage();
    };

    // Every page starts below the letterhead that is drawn over the top once the pages are known.
    doc.on('pageAdded', () => {
      doc.y = 90;
    });
    doc.y = 90;
    for (const block of document.blocks) {
      switch (block.type) {
        case 'title':
          room(40);
          bold(13).text(block.text, MARGIN, doc.y + 8, { width: WIDTH, align: 'center' });
          doc.moveDown(0.4);
          break;
        case 'heading':
          room(50);
          bold(11).text(block.text, MARGIN, doc.y + 10, { width: WIDTH });
          doc.moveDown(0.3);
          break;
        case 'para': {
          (block.bold ? bold() : regular()).text(block.text, MARGIN, doc.y + 3, { width: WIDTH, align: block.align ?? 'left' });
          break;
        }
        case 'table': {
          const scale = (ws: number[]) => ws.map((w) => (w / ws.reduce((a, b) => a + b, 0)) * WIDTH);
          doc.y += 3;
          block.rows.forEach((row, r) => {
            const rowSet = block.rowWidths?.[r];
            // A row that does not fill the whole table (merged cells) is stretched to the full width.
            const widths = rowSet ? scale(rowSet) : scale(block.widths);
            const header = (block.header === true && r === 0) || (block.shadedRows?.includes(r) ?? false);
            const font = () => (header ? bold(8.5) : regular(8.5));
            const height = Math.max(...row.map((text, c) => (font(), doc.heightOfString(text || ' ', { width: widths[c] - 8 })))) + 8;
            room(height);
            let x = MARGIN;
            const top = doc.y;
            if (block.shadedRows?.includes(r)) doc.rect(MARGIN, top, WIDTH, height).fillColor('#d9d9d9').fill();
            row.forEach((text, c) => {
              doc.rect(x, top, widths[c], height).lineWidth(0.5).strokeColor('#555').stroke();
              font().text(text, x + 4, top + 4, { width: widths[c] - 8 });
              x += widths[c];
            });
            doc.y = top + height;
          });
          doc.y += 4;
          break;
        }
        case 'photos':
          for (const photo of block.photos) {
            const box: [number, number] = block.wide ? [WIDTH * 0.95, 300] : [WIDTH * 0.7, 220];
            room(box[1] + 30);
            try {
              doc.image(photo.data, MARGIN, doc.y + 4, { fit: box });
              doc.y += box[1] + 10;
            } catch {
              regular().text('(photo could not be drawn)', MARGIN, doc.y);
            }
            regular(8).text(photo.caption, MARGIN, doc.y, { width: WIDTH });
          }
          break;
        case 'break':
          doc.addPage();
          break;
      }
    }

    const { start, count } = doc.bufferedPageRange();
    for (let i = start; i < start + count; i += 1) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      bold(12).text(document.letterhead.name, MARGIN, 28, { width: WIDTH, align: 'center', lineBreak: false });
      regular(7).text([document.letterhead.credentials, document.letterhead.address].filter(Boolean).join(' | '), MARGIN, 45, { width: WIDTH, align: 'center', height: 30 });
      regular(7).text(`${document.footer}    Page ${i + 1} of ${count}`, MARGIN, 815, { width: WIDTH, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}
