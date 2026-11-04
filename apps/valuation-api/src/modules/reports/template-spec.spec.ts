import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES } from './default-templates.js';
import { resolve, formatValue, isKnownSource } from './report-fields.js';
import { parseTemplateSpec } from './template-spec.js';

describe('parseTemplateSpec', () => {
  it('accepts every default template', () => {
    for (const template of DEFAULT_TEMPLATES) expect(parseTemplateSpec(template.spec).problems).toEqual([]);
  });

  it('rejects unknown sources, bad kinds and a conditional without "when"', () => {
    const { problems } = parseTemplateSpec({
      title: 'Report',
      sections: [
        {
          heading: 'A',
          fields: [
            { label: 'x', source: 'secret.password', kind: 'required' },
            { label: 'y', source: 'property.code', kind: 'sometimes' },
            { label: 'z', source: 'property.code', kind: 'conditional' },
          ],
        },
      ],
    });
    expect(problems).toHaveLength(3);
  });

  it('rejects empty templates and unknown annexure types', () => {
    expect(parseTemplateSpec({}).problems.length).toBeGreaterThan(0);
    expect(parseTemplateSpec({ title: 'Report', sections: [{ heading: 'A', fields: [] }], requiredAnnexures: ['PASSPORT'] }).problems).toContain('requiredAnnexures contains an unknown document type');
  });
});

describe('report fields', () => {
  it('allows inspection observations by key but nothing arbitrary', () => {
    expect(isKnownSource('inspection.observations.occupancy')).toBe(true);
    expect(isKnownSource('inspection.observations.Occupancy')).toBe(false);
    expect(isKnownSource('user.passwordHash')).toBe(false);
  });

  it('resolves nested paths and formats values without inventing defaults', () => {
    const ctx = { property: { khasraNumbers: ['44/2', '45'] }, valuation: { totalValue: 6600000 } };
    expect(resolve(ctx, 'property.khasraNumbers')).toEqual(['44/2', '45']);
    expect(resolve(ctx, 'property.missing')).toBeUndefined();
    expect(formatValue(resolve(ctx, 'valuation.totalValue'), 'money')).toBe('Rs. 66,00,000');
    expect(formatValue(undefined, 'text')).toBe('');
  });
});
