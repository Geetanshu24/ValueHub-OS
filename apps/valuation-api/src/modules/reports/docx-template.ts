import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import type { Block, BoiDocument } from './report-blocks.js';

// A bank's own Word report, kept as a template: the bank's wording, tables, shading and
// letterhead stay exactly as they were, and each answer is a {{key}} where the valuer's
// value goes. The templates are made from the banks' sample reports (see templates/README.md).
export interface TemplateField {
  key: string;
  label: string;
  section: string;
  // Written when the valuer leaves the box empty (e.g. "Nil").
  default: string;
  // The sample says "Vacant Plot" here; used as the default for a plot without a building.
  vacant: boolean;
  // Shown as a larger box in the form.
  long: boolean;
  // Worked out by the system, not asked of the valuer.
  hidden: boolean;
}

export interface Photo {
  data: Buffer;
  mime: string;
  caption: string;
}

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MAX_PHOTO_WIDTH = 4_800_000; // EMU, about 13 cm
const MAX_PHOTO_HEIGHT = 3_300_000;

const escapeXml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const unescapeXml = (text: string) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');

// What goes into a box: what the valuer wrote, else its standard answer.
export function resolveValues(fields: TemplateField[], values: Record<string, string>, vacant: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const given = values[field.key];
    if (given !== undefined && given.trim() !== '') out[field.key] = given;
    else if (field.default) out[field.key] = field.default;
    else if (field.vacant && vacant) out[field.key] = 'Vacant Plot';
    else out[field.key] = '';
  }
  return out;
}

function fillText(xml: string, values: Record<string, string>): string {
  return xml.replace(/<w:t((?:\s[^>]*)?)>([^<]*)<\/w:t>/g, (whole, attrs: string, content: string) => {
    if (!content.includes('{{')) return whole;
    const text = content.replace(/\{\{([a-z0-9_]+)\}\}/g, (_m, key: string) => (key === 'photos' ? '' : escapeXml(values[key] ?? '')));
    // The values were written escaped above; split on line breaks into separate runs of text.
    const lines = text.split('\n');
    const open = `<w:t${attrs.includes('xml:space') ? attrs : `${attrs} xml:space="preserve"`}>`;
    return lines.map((line) => `${open}${line}</w:t>`).join('<w:br/>');
  });
}

function photoSize(data: Buffer): { cx: number; cy: number } {
  const image = (new PDFDocument() as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(data);
  const scale = Math.min(MAX_PHOTO_WIDTH / image.width, MAX_PHOTO_HEIGHT / image.height);
  return { cx: Math.round(image.width * scale), cy: Math.round(image.height * scale) };
}

const photoParagraph = (rId: string, id: number, size: { cx: number; cy: number }, caption: string) =>
  `<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${size.cx}" cy="${size.cy}"/><wp:docPr id="${9000 + id}" name="Photo ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${NS_A}" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="${NS_A}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${9000 + id}" name="photo${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${size.cx}" cy="${size.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
  (caption ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(caption)}</w:t></w:r></w:p>` : '');

// Fills the template. With `photoMarker` the photos are left as that text instead of being embedded.
export async function fillDocx(template: Buffer, values: Record<string, string>, photos: Photo[], photoMarker?: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(template);
  let xml = await zip.file('word/document.xml')!.async('string');
  let rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
  let types = await zip.file('[Content_Types].xml')!.async('string');

  xml = fillText(xml, values);

  // The paragraph holding {{photos}} becomes one paragraph per photo.
  xml = xml.replace(/<w:p(?:\s[^>]*[^/>])?>(?:(?!<\/w:p>)[\s\S])*?\{\{photos\}\}[\s\S]*?<\/w:p>/, () => {
    if (photoMarker) return `<w:p><w:r><w:t>${photoMarker}</w:t></w:r></w:p>`;
    let out = '';
    photos.forEach((photo, i) => {
      const ext = photo.mime === 'image/png' ? 'png' : 'jpeg';
      const rId = `rIdPhoto${i + 1}`;
      zip.file(`word/media/photo${i + 1}.${ext}`, photo.data);
      rels = rels.replace('</Relationships>', `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo${i + 1}.${ext}"/></Relationships>`);
      if (!new RegExp(`Extension="${ext}"`, 'i').test(types)) types = types.replace('<Override', `<Default Extension="${ext}" ContentType="image/${ext}"/><Override`);
      out += photoParagraph(rId, i + 1, photoSize(photo.data), photo.caption);
    });
    return out || '<w:p/>';
  });

  zip.file('word/document.xml', xml);
  zip.file('word/_rels/document.xml.rels', rels);
  zip.file('[Content_Types].xml', types);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---- the PDF is drawn from the same filled report

// Only the words of a piece of Word XML: its text runs, with line breaks, tabs and paragraph ends.
const textOf = (xml: string) => {
  let out = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\/>|<w:cr\/>|<w:tab\/>|<\/w:p>/g)) {
    if (m[1] !== undefined) out += unescapeXml(m[1]);
    else if (m[0] === '</w:p>') out += '\n';
    else out += m[0] === '<w:tab/>' ? '  ' : '\n';
  }
  return out;
};

const paragraphsOf = (xml: string) => xml.match(/<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];

// Turns the filled Word report into the blocks the PDF writer draws: every paragraph and every table cell, in order.
export async function docxToDocument(filled: Buffer, photos: Photo[], footer: string): Promise<BoiDocument> {
  const zip = await JSZip.loadAsync(filled);
  const xml = await zip.file('word/document.xml')!.async('string');
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('</w:body>'));

  const blocks: Block[] = [];
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  for (const match of body.matchAll(re)) {
    const piece = match[0];
    if (piece.startsWith('<w:tbl>')) {
      const grid = [...piece.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
      const rows: string[][] = [];
      const rowWidths: number[][] = [];
      for (const tr of piece.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []) {
        const cells = tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
        let column = 0;
        const widths: number[] = [];
        rows.push(
          cells.map((tc) => {
            const span = Number(/<w:gridSpan w:val="(\d+)"/.exec(tc)?.[1] ?? 1);
            const width = grid.length > 0 ? grid.slice(column, column + span).reduce((a, b) => a + b, 0) || grid[column] || 1 : 100 / cells.length;
            widths.push(Math.max(width, 1));
            column += span;
            return textOf(tc).replace(/\n+$/, '').trim();
          }),
        );
        rowWidths.push(widths);
      }
      blocks.push({ type: 'table', widths: grid.length > 0 ? grid : rowWidths[0] ?? [100], rows, rowWidths });
    } else if (piece.includes('[[PHOTOS]]')) {
      if (photos.length > 0) blocks.push({ type: 'photos', photos });
    } else {
      const text = textOf(piece).replace(/\n+$/, '');
      if (piece.includes('<w:br w:type="page"/>')) blocks.push({ type: 'break' });
      if (text.trim()) blocks.push({ type: 'para', text, bold: /<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(piece.slice(0, piece.indexOf('<w:t'))) });
    }
  }

  const header = async (name: string) => {
    const file = zip.file(name);
    return file ? paragraphsOf(await file.async('string')).map((p) => textOf(p).trim()).filter(Boolean) : [];
  };
  const names = await header('word/header2.xml');
  const details = await header('word/header3.xml');
  return { letterhead: { name: names[0] ?? '', credentials: details.join(' | '), address: '' }, footer, blocks };
}
