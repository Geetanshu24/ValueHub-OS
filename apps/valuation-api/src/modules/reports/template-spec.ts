import { DOCUMENT_TYPES, type DocumentType } from '@value-hub/valuation-shared';
import { isKnownSource } from './report-fields.js';

export const FIELD_KINDS = ['required', 'conditional', 'optional'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface TemplateField {
  label: string;
  source: string;
  kind: FieldKind;
  // For conditional fields: the source path that, when it has a value, makes
  // this field required.
  when?: string;
}

export interface TemplateSpec {
  title: string;
  sections: { heading: string; fields: TemplateField[] }[];
  // Controlled wording for assumptions and limitations. Assignment-specific
  // judgement is added separately, never overwritten by these.
  limitations: string[];
  requiredAnnexures: DocumentType[];
  requirePhotos: boolean;
}

const MAX_SECTIONS = 30;
const MAX_FIELDS = 60;

// Validates an untrusted template body. Returns the typed spec or every
// problem found.
export function parseTemplateSpec(raw: unknown): { spec?: TemplateSpec; problems: string[] } {
  const problems: string[] = [];
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 3) problems.push('title is required');

  const sectionsRaw = Array.isArray(body.sections) ? body.sections : [];
  if (sectionsRaw.length === 0) problems.push('at least one section is required');
  if (sectionsRaw.length > MAX_SECTIONS) problems.push(`at most ${MAX_SECTIONS} sections`);

  const sections: TemplateSpec['sections'] = sectionsRaw.slice(0, MAX_SECTIONS).map((section, i) => {
    const s = (section ?? {}) as Record<string, unknown>;
    const heading = typeof s.heading === 'string' ? s.heading.trim() : '';
    if (!heading) problems.push(`section ${i + 1} needs a heading`);
    const fieldsRaw = Array.isArray(s.fields) ? s.fields : [];
    if (fieldsRaw.length > MAX_FIELDS) problems.push(`section ${i + 1} has too many fields`);

    const fields = fieldsRaw.slice(0, MAX_FIELDS).map((field, j): TemplateField => {
      const f = (field ?? {}) as Record<string, unknown>;
      const where = `section ${i + 1}, field ${j + 1}`;
      const label = typeof f.label === 'string' ? f.label.trim() : '';
      const source = typeof f.source === 'string' ? f.source : '';
      const kind = f.kind as FieldKind;
      const when = typeof f.when === 'string' ? f.when : undefined;
      if (!label) problems.push(`${where}: label is required`);
      if (!isKnownSource(source)) problems.push(`${where}: "${source}" is not an approved source field`);
      if (!FIELD_KINDS.includes(kind)) problems.push(`${where}: kind must be required, conditional or optional`);
      if (kind === 'conditional' && (!when || !isKnownSource(when))) problems.push(`${where}: a conditional field needs a valid "when" source`);
      return { label, source, kind, when };
    });
    return { heading, fields };
  });

  const limitations = Array.isArray(body.limitations) ? body.limitations.filter((l): l is string => typeof l === 'string' && l.trim() !== '') : [];
  if (limitations.length > 40) problems.push('too many limitations');

  const annexuresRaw = Array.isArray(body.requiredAnnexures) ? body.requiredAnnexures : [];
  const requiredAnnexures = annexuresRaw.filter((t): t is DocumentType => DOCUMENT_TYPES.includes(t as DocumentType));
  if (requiredAnnexures.length !== annexuresRaw.length) problems.push('requiredAnnexures contains an unknown document type');

  const spec: TemplateSpec = { title, sections, limitations, requiredAnnexures, requirePhotos: body.requirePhotos === true };
  return { spec: problems.length === 0 ? spec : undefined, problems };
}
