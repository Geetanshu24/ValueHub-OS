// A neutral description of a finished report, drawn by the PDF writer.
export type Block =
  | { type: 'title'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'para'; text: string; bold?: boolean; align?: 'left' | 'center' | 'right' }
  | { type: 'table'; widths: number[]; rows: string[][]; header?: boolean; shadedRows?: number[]; rowWidths?: number[][] }
  | { type: 'photos'; photos: { data: Buffer; mime: string; caption: string }[] }
  | { type: 'break' };

export interface Letterhead {
  name: string;
  credentials: string;
  address: string;
}

export interface BoiDocument {
  letterhead: Letterhead;
  footer: string;
  blocks: Block[];
}
