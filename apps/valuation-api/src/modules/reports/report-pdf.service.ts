import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLib, StandardFonts, rgb } from 'pdf-lib';
import { StorageService } from '../../common/storage/storage.service.js';
import { formatMoney } from './report-fields.js';
import type { Snapshot } from './report-snapshot.service.js';

export interface RenderOptions {
  status: 'DRAFT' | 'ISSUED';
  approvedBy?: string;
  issuedAt?: Date;
}

const MARGIN = 50;
const PAGE_WIDTH = 595.28 - MARGIN * 2;

// Optional TTF fonts (e.g. Noto Sans) for names that the built-in fonts cannot
// draw. Without them the standard Helvetica is used.
function fonts() {
  const regularPath = process.env.REPORT_FONT_PATH;
  const boldPath = process.env.REPORT_FONT_BOLD_PATH;
  return {
    regular: regularPath ? readFileSync(regularPath) : 'Helvetica',
    bold: boldPath ? readFileSync(boldPath) : 'Helvetica-Bold',
  };
}

@Injectable()
export class ReportPdfService {
  constructor(private readonly storage: StorageService) {}

  // Draws the report from the frozen snapshot, then appends annexures and
  // photographs. Nothing here reads live records.
  async render(snapshot: Snapshot, options: RenderOptions): Promise<Buffer> {
    const body = await this.drawBody(snapshot, options);
    return this.appendAttachments(body, snapshot);
  }

  private drawBody(s: Snapshot, options: RenderOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const font = fonts();
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: s.template.title, Author: s.firmName, Subject: s.reportCode } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const regular = () => doc.font(font.regular as string);
      const bold = () => doc.font(font.bold as string);
      const ensure = (height: number) => {
        if (doc.y + height > doc.page.height - MARGIN - 20) doc.addPage();
      };
      const heading = (text: string) => {
        ensure(40);
        doc.x = MARGIN;
        doc.moveDown(0.8);
        bold().fontSize(12).fillColor('#00574f').text(text);
        doc.moveTo(MARGIN, doc.y + 2).lineTo(MARGIN + PAGE_WIDTH, doc.y + 2).strokeColor('#abdbd8').stroke();
        doc.moveDown(0.5).fillColor('#0d1a19');
        regular().fontSize(10);
      };
      const row = (cells: string[], widths: number[], isHeader = false, align: ('left' | 'right')[] = []) => {
        const heights = cells.map((cell, i) => doc.heightOfString(cell, { width: widths[i] - 6 }));
        const height = Math.max(...heights) + 4;
        ensure(height);
        const top = doc.y;
        let x = MARGIN;
        cells.forEach((cell, i) => {
          (isHeader ? bold() : regular()).fontSize(9).text(cell, x + 3, top + 2, { width: widths[i] - 6, align: align[i] ?? 'left' });
          x += widths[i];
        });
        doc.y = top + height;
        doc.x = MARGIN; // text() above leaves x at the last column; later plain text needs the full width
        doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + PAGE_WIDTH, doc.y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      };

      // ---- title block
      bold().fontSize(9).fillColor('#5fa7a3').text(s.firmName.toUpperCase());
      bold().fontSize(18).fillColor('#0d1a19').text(s.template.title);
      regular().fontSize(9).fillColor('#475569').text(`Report ${s.reportCode} · template ${s.template.name} v${s.template.version} · valuation V${s.valuation.versionNumber} (${s.valuation.engineVersion})`);
      doc.fillColor('#0d1a19').fontSize(10);

      // ---- template sections
      for (const section of s.sections) {
        heading(section.heading);
        for (const r of section.rows) row([r.label, r.value || (r.missing ? 'MISSING' : 'Not recorded')], [170, PAGE_WIDTH - 170]);
      }

      // ---- workings
      heading('Valuation workings');
      const w = [200, 90, 90, PAGE_WIDTH - 380];
      row(['Component', 'Quantity', 'Rate', 'Amount'], w, true, ['left', 'right', 'right', 'right']);
      for (const l of s.workings.lines) {
        const qty = `${l.quantity.toLocaleString('en-IN')} ${l.unit}`;
        const rate = l.unit === '%' ? formatMoney(l.rate) : l.rate.toLocaleString('en-IN');
        row([`${l.component}${l.sourceNote ? `\n${l.sourceNote}` : ''}`, qty, rate, l.treatment === 'SEPARATELY_VALUED' ? formatMoney(l.amount) : `(${l.treatment.replaceAll('_', ' ').toLowerCase()})`], w, false, ['left', 'right', 'right', 'right']);
      }
      ensure(30);
      bold().fontSize(11).text(`Assessed value: ${formatMoney(s.workings.totalValue)}`, MARGIN, doc.y + 6, { width: PAGE_WIDTH, align: 'right' });
      regular().fontSize(9).text(`Adopted area ${s.workings.adoptedAreaSqm.toLocaleString('en-IN')} sq. m (${s.workings.areaBasis.toLowerCase().replaceAll('_', ' ')}): ${s.workings.adoptedAreaSource}`, MARGIN, doc.y + 4, { width: PAGE_WIDTH });

      if (s.measurements.length > 0) {
        heading('Site measurements');
        for (const m of s.measurements) row([m.label, `${m.areaSqm.toLocaleString('en-IN')} sq. m`, m.method], [170, 100, PAGE_WIDTH - 270]);
      }
      if (s.comparables.length > 0) {
        heading('Market evidence relied upon');
        for (const c of s.comparables) row([c.location, `${formatMoney(c.ratePerSqm)} / sq. m`, `${c.isTransaction ? 'Transaction' : 'Asking'}, ${new Date(c.observedOn).toLocaleDateString('en-IN')}`, c.source], [150, 100, 110, PAGE_WIDTH - 360]);
      }
      if (s.discrepancies.length > 0) {
        heading('Differences between records');
        for (const d of s.discrepancies) row([d.description, d.status.toLowerCase(), `${d.sourceA} / ${d.sourceB}${d.resolutionNote ? `\n${d.resolutionNote}` : ''}`], [190, 70, PAGE_WIDTH - 260]);
      }

      heading('Assumptions and limitations');
      if (s.workings.assumptions) doc.text(`Valuer's assumptions: ${s.workings.assumptions}`, { width: PAGE_WIDTH }).moveDown(0.3);
      s.limitations.forEach((text, i) => doc.fontSize(9).text(`${i + 1}. ${text}`, { width: PAGE_WIDTH }).moveDown(0.2));

      heading('Annexure index');
      if (s.annexures.length === 0 && s.photos.length === 0) doc.text('No annexures.');
      s.annexures.forEach((a) => row([`Annexure ${a.index}`, a.type.replaceAll('_', ' ').toLowerCase(), a.fileName, a.pages ? `${a.pages} p.` : ''], [80, 110, PAGE_WIDTH - 200, 50]));
      if (s.photos.length > 0) row(['Photographs', `${s.photos.filter((p) => p.embedded).length} of ${s.photos.length} embedded`, 'Inspection photographs', ''], [80, 110, PAGE_WIDTH - 200, 50]);

      // ---- sign-off
      ensure(110);
      heading('Sign-off');
      regular().fontSize(10);
      doc.text(`Valuer: ${s.people.valuer}`).text(`Prepared by: ${s.people.preparedBy}`);
      if (options.status === 'ISSUED') {
        doc.text(`Approved by: ${options.approvedBy ?? '—'}`).text(`Issued: ${options.issuedAt ? options.issuedAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}`);
      } else {
        doc.fillColor('#b45309').text('DRAFT — not approved and not for issue.').fillColor('#0d1a19');
      }
      doc.moveDown(2).fontSize(8).fillColor('#64748b').text('This report is an opinion of value. It does not certify title or guarantee any outcome.', { width: PAGE_WIDTH });

      // ---- footers
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(range.start + i);
        const y = doc.page.height - MARGIN + 10;
        doc.page.margins.bottom = 0;
        regular().fontSize(8).fillColor('#64748b').text(`${s.reportCode}${options.status === 'DRAFT' ? ' · DRAFT' : ''}`, MARGIN, y, { width: PAGE_WIDTH / 2, align: 'left', lineBreak: false });
        doc.text(`Page ${i + 1} of ${range.count}`, MARGIN + PAGE_WIDTH / 2, y, { width: PAGE_WIDTH / 2, align: 'right', lineBreak: false });
      }
      doc.end();
    });
  }

  private async appendAttachments(body: Buffer, s: Snapshot): Promise<Buffer> {
    const out = await PdfLib.load(body);
    const helv = await out.embedFont(StandardFonts.Helvetica);
    const helvBold = await out.embedFont(StandardFonts.HelveticaBold);
    const A4: [number, number] = [595.28, 841.89];

    const placeImage = async (bytes: Buffer, mime: string, caption: string, title: string) => {
      const page = out.addPage(A4);
      page.drawText(title, { x: 50, y: 790, size: 12, font: helvBold, color: rgb(0, 0.34, 0.31) });
      const image = mime === 'image/png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      const scale = Math.min(495 / image.width, 650 / image.height, 1);
      page.drawImage(image, { x: 50, y: 770 - image.height * scale, width: image.width * scale, height: image.height * scale });
      if (caption) page.drawText(caption.slice(0, 110), { x: 50, y: 40, size: 9, font: helv, color: rgb(0.28, 0.33, 0.41) });
    };

    for (const a of s.annexures) {
      if (!a.embeddable) continue;
      const bytes = await this.storage.read(a.storageKey);
      const title = `Annexure ${a.index} — ${a.type.replaceAll('_', ' ').toLowerCase()} (${a.fileName})`;
      if (a.mimeType === 'application/pdf') {
        const divider = out.addPage(A4);
        divider.drawText(title.slice(0, 90), { x: 50, y: 790, size: 12, font: helvBold, color: rgb(0, 0.34, 0.31) });
        const source = await PdfLib.load(bytes);
        const copied = await out.copyPages(source, source.getPageIndices());
        copied.forEach((page) => out.addPage(page));
        divider.drawText(`${copied.length} page(s) follow. SHA-256 ${a.sha256.slice(0, 16)}…`, { x: 50, y: 770, size: 9, font: helv });
      } else {
        await placeImage(bytes, a.mimeType, `SHA-256 ${a.sha256.slice(0, 16)}…`, title);
      }
    }
    for (const [i, p] of s.photos.entries()) {
      if (!p.embedded) continue;
      await placeImage(await this.storage.read(p.storageKey), p.mimeType, p.caption ?? '', `Site photograph ${i + 1}`);
    }
    return Buffer.from(await out.save());
  }
}
