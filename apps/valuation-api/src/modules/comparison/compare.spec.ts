import { describe, expect, it } from 'vitest';
import { compareEvidence, floorCount, summarise, textMatch, type CompareInput } from './compare.js';

const doc = (value: string, source = 'deed.pdf p.3') => ({ value, source });
const base: CompareInput = {
  propertyClass: 'HOUSE',
  record: { addressLine: 'House No. 47, Gali No. 3, Sector 15, Rohini, Delhi', unitDetail: '47', khasraNumbers: [], borrowerName: 'Ramesh Gupta' },
  docFacts: {
    property_address: doc('House No. 47, Gali No. 3, Sector 15, Rohini, Delhi - 110085'),
    owner_name: doc('Ramesh Kumar Gupta S/o Late Mahesh Prasad Gupta'),
    plot_area_sqm: doc('167.22'),
    built_up_area_sqm: doc('111.48', 'Approved plan p.2'),
    boundary_north: doc('Gali No. 3 - Road 10m wide'),
    boundary_south: doc('House No. 46 of Ramesh Lal'),
    total_floors: doc('G+1'),
  },
  documents: [{ type: 'SALE_DEED', fileName: 'deed.pdf' }],
  inspection: {
    source: 'Inspection 10 Nov',
    observations: { occupant_name: 'Ramesh Kumar Gupta', boundary_north: 'Road, approx 10-11m wide', boundary_south: 'Plot of Sunil Verma', floors: '2', oc_sighted: 'Not sighted', age_years: '8', charges_seen: 'None seen' },
    measurements: [{ label: 'Plot', areaSqm: 166.72, fieldKey: 'plot_area_sqm' }, { label: 'Ground floor', areaSqm: 81.7, fieldKey: null }, { label: 'First floor', areaSqm: 81.7, fieldKey: null }],
  },
  year: 2026,
};
const find = (rows: ReturnType<typeof compareEvidence>, key: string) => rows.find((r) => r.key === key)!;

describe('textMatch and floorCount', () => {
  it('ignores filler words', () => {
    expect(textMatch('House No. 47, Gali 3', 'house 47 gali 3')).toBe(1);
    expect(textMatch('Plot no F-140', 'Road')).toBe(0);
  });
  it('reads how many floors are meant', () => {
    expect(floorCount('S+4')).toBe(5);
    expect(floorCount('G+1')).toBe(2);
    expect(floorCount('GF+FF')).toBe(2);
    expect(floorCount('3')).toBe(3);
  });
});

describe('compareEvidence', () => {
  const rows = compareEvidence(base);

  it('calls the same owner consistent, whatever the relation text', () => {
    expect(find(rows, 'owner_name').status).toBe('consistent');
    expect(find(rows, 'property_address').status).toBe('consistent');
  });

  it('tells the valuer about a small difference inside tolerance, without blocking', () => {
    const small = find(rows, 'plot_area_sqm');
    expect(small.status).toBe('verify');
    expect(small.needsResolution).toBe(false);
  });

  it('flags an area beyond tolerance as a mismatch that needs a person', () => {
    const area = find(compareEvidence({ ...base, inspection: { ...base.inspection!, measurements: [{ label: 'Plot', areaSqm: 150, fieldKey: 'plot_area_sqm' }] } }), 'plot_area_sqm');
    expect(area.status).toBe('mismatch');
    expect(area.needsResolution).toBe(true);
    expect(area.delta).toContain('%');
  });

  it('adds the floors measured on site and compares with the approved plan', () => {
    const built = find(rows, 'built_up_area_sqm');
    expect(built.status).toBe('mismatch');
    expect(built.site?.source).toContain('Ground floor + First floor');
    expect(find(rows, 'floors').status).toBe('consistent');
  });

  it('gives a boundary that is the same thing a pass and one that differs a mismatch', () => {
    expect(find(rows, 'boundary_north').status).toBe('consistent');
    expect(find(rows, 'boundary_south').status).toBe('mismatch');
  });

  it('needs the occupation certificate settled when it is neither on file nor seen', () => {
    const oc = find(rows, 'occupation_certificate');
    expect(oc.status).toBe('mismatch');
    expect(oc.needsResolution).toBe(true);
    const withDoc = compareEvidence({ ...base, documents: [...base.documents, { type: 'OCCUPATION_CERTIFICATE', fileName: 'oc.pdf' }] });
    expect(find(withDoc, 'occupation_certificate').status).toBe('verify');
  });

  it('says missing, not mismatch, when one side has nothing', () => {
    const empty = compareEvidence({ ...base, inspection: null });
    expect(find(empty, 'plot_area_sqm').status).toBe('missing');
    expect(summarise(empty).mismatch).toBe(0);
  });

  it('leaves out building rows for a plot, and lets documents decide tenure', () => {
    const plot = compareEvidence({ ...base, propertyClass: 'LAND' });
    expect(plot.some((r) => r.key === 'built_up_area_sqm' || r.key === 'occupation_certificate')).toBe(false);
    expect(find(plot, 'tenure').status).toBe('missing');
    const tenured = compareEvidence({ ...base, docFacts: { ...base.docFacts, ownership_type: doc('Freehold') } });
    expect(find(tenured, 'tenure').status).toBe('document');
  });
});
