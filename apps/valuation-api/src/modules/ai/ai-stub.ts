// A local stand-in for the AI, for trying every AI feature without an account (AI_MODE=stub).
// It answers in the same shape the real model is asked for, from simple rules over the text it is
// given. Every answer says it is a demo answer, so nobody takes it for a real reading.
const DEMO = 'Demo answer (no AI account connected)';

interface Schema { properties?: Record<string, { items?: { properties?: Record<string, { enum?: string[] }> } }> }

const text = (content: unknown): string =>
  (Array.isArray(content) ? content : [])
    .map((block) => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : ''))
    .join('\n');

const grab = (source: string, pattern: RegExp): string | undefined => pattern.exec(source)?.[1]?.trim();

function facts(source: string) {
  const body = source.split('Document text:')[1] ?? source;
  const found: [string, string | undefined][] = [
    ['plot_number', grab(body, /plot\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Z]?-?\d+[A-Z]?)/i)],
    ['registration_number', grab(body, /(?:registration|reg\.?|vasika)\s*(?:no\.?|number)?\s*[:\-]?\s*([\w\/-]{3,20})/i)],
    ['plot_area_sqm', grab(body, /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*m(?:etres?|eters?)?|sqm)/i)],
    ['plot_area_sqyd', grab(body, /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*y(?:ar)?ds?|gaj)/i)],
    ['owner_name', grab(body, /(?:owner|vendee|buyer|purchaser)\s*[:\-]?\s*((?:Mr\.?|Mrs\.?|Smt\.?|Shri)?\s*[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3})/)],
    ['district', grab(body, /[Dd]istrict\s*[:\-]?\s*([A-Z][A-Za-z ]{2,20})/)],
    ['pin_code', grab(body, /\b(\d{6})\b/)],
  ];
  return { facts: found.filter(([, v]) => v).map(([field_key, value]) => ({ field_key, value, page_number: 1, confidence: 0.55 })) };
}

export function stubAnswer(schema: object, content: unknown): unknown {
  const props = (schema as Schema).properties ?? {};
  const source = text(content);
  if ('facts' in props) return facts(source);
  if ('drafts' in props) {
    const keys = props.drafts.items?.properties?.key?.enum ?? [];
    return { drafts: keys.map((key) => ({ key, text: `[${DEMO}] Standard wording for ${key.replaceAll('_', ' ')}, to be reviewed and edited by the valuer.`, basis: 'Written from the facts already in the report.' })) };
  }
  if ('observations' in props) {
    const p = props.observations.items?.properties ?? {};
    if (p.key) return { observations: [], measurements: [] };
    const items = p.item?.enum ?? [];
    return { observations: items.slice(0, 3).map((item) => ({ item, value: 'As visible in photographs', evidence: `${DEMO}: no photograph was actually analysed.` })) };
  }
  if ('rows' in props) {
    const keys = props.rows.items?.properties?.key?.enum ?? [];
    return { rows: keys.map((key) => ({ key, explanation: `${DEMO}: check the documents and the site measurement for ${key.replaceAll('_', ' ')}.`, suggested_note: 'The difference was noted and is disclosed in the report.' })) };
  }
  if ('found' in props) return { found: false, area_name: '', category: '', rate_text: '', rate_per_sqm: null, effective: '', source_url: '', source_title: '', quote: '', notes: `${DEMO}: the web is not searched in demo mode.` };
  if ('items' in props) return { items: [] };
  if ('assumptions' in props) return { assumptions: `${DEMO}: Title is assumed clear on the documents seen; area is taken as measured on site.`, needs_input: [] };
  if ('issues' in props) return { issues: [{ message: `${DEMO}: check that the owner name and the area in the report match the documents.`, severity: 'info' }] };
  if ('reply' in props) {
    const question = grab(source, /Query from the bank[^\n]*\n([^\n]+)/) ?? 'your query';
    return { reply: `Dear Sir/Madam,\n\nWith reference to your query ("${question.slice(0, 140)}"), we confirm that the details are as stated in the valuation report and its annexures. [${DEMO}]\n\nRegards`, needs_input: ['Attach the supporting document the bank refers to'] };
  }
  return {};
}
