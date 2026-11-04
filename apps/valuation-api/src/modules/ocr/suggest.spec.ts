import { describe, expect, it } from 'vitest';
import { suggestFields } from './suggest.js';

const get = (list: ReturnType<typeof suggestFields>, key: string) => list.filter((s) => s.fieldKey === key);

describe('suggestFields', () => {
  const deed = [
    `SALE DEED dated 12/03/2018. Sh. Ram Kumar S/o Sh. Mohan Lal sells the plot admeasuring 150 sq. m situated at Khasra No. 44/2, 45.
     East: Road 30 ft wide; West: Plot of Sh. Hari Singh; North: House of Vijay Kumar; South: Street`,
    `The built-up area is 1,614.58 sq ft with a carpet area of 120 square metres. Survey no 17/3.`,
  ];
  const result = suggestFields(deed);

  it('reads the plot area and keeps the page it came from', () => {
    expect(get(result, 'plot_area_sqm')[0]).toMatchObject({ value: '150', pageNumber: 1 });
  });

  it('converts square feet and classifies built-up and carpet areas, with lower confidence when converted', () => {
    const builtUp = get(result, 'built_up_area_sqm')[0];
    expect(Number(builtUp.value)).toBeCloseTo(150, 0);
    expect(builtUp.pageNumber).toBe(2);
    expect(get(result, 'carpet_area_sqm')[0].value).toBe('120');
    expect(builtUp.confidence).toBeLessThan(0.65);
  });

  it('finds khasra and survey references, the deed date and the boundaries', () => {
    expect(get(result, 'khasra_numbers').map((s) => s.value)).toEqual(['44/2,45', '17/3']);
    expect(get(result, 'document_date')[0].value).toBe('2018-03-12');
    expect(get(result, 'boundary_east')[0].value).toContain('Road');
    expect(get(result, 'boundary_south')).toHaveLength(1);
  });

  it('finds party names but marks them as low confidence', () => {
    const names = get(result, 'party_name');
    expect(names.map((n) => n.value)).toContain('Ram Kumar');
    expect(Math.max(...names.map((n) => n.confidence))).toBeLessThan(0.5);
  });

  it('never invents anything from empty or irrelevant text, and rejects impossible dates', () => {
    expect(suggestFields([])).toEqual([]);
    expect(suggestFields(['Lorem ipsum dolor sit amet'])).toEqual([]);
    expect(get(suggestFields(['dated 31/02/2020']), 'document_date')).toEqual([]);
  });

  it('flags an unclassified area as such', () => {
    expect(suggestFields(['Rent of Rs 5000 for 200 sq ft shop'])[0].fieldKey).toBe('area_mentioned_sqm');
  });

  it('keeps full stops inside a boundary and separates sides on one line', () => {
    const out = suggestFields(['East: Plot No. 124 West: Road 30 ft wide.\nNorth: Plot No. 122']);
    const side = (key: string) => out.find((s) => s.fieldKey === key)?.value;
    expect(side('boundary_east')).toBe('Plot No. 124');
    expect(side('boundary_west')).toBe('Road 30 ft wide');
    expect(side('boundary_north')).toBe('Plot No. 122');
  });

  it('reads transaction, registration and property details from a deed', () => {
    const out = suggestFields([`Sh. Ram Kumar S/o Mohan Lal (hereinafter called the Vendor) sells to Smt. Sita Devi (hereinafter called the Vendee) the property situated at Flat 4, Sector 15, Gurgaon, Haryana. For a sale consideration of Rs. 45,00,000/- registered on 12/03/2018, Registration No. 1234/2018 at Sub-Registrar Gurgaon. The flat on second floor of G+4 building, 3 BHK, plot 30 x 50 ft, is under mortgage with SBI.`]);
    const v = (k: string) => out.filter((s) => s.fieldKey === k).map((s) => s.value);
    expect(v('seller_name')).toContain('Ram Kumar');
    expect(v('buyer_name')).toContain('Sita Devi');
    expect(v('property_address')[0]).toContain('Sector 15');
    expect(v('sale_consideration')).toContain('45,00,000');
    expect(v('registration_date')).toContain('2018-03-12');
    expect(v('registration_number')).toContain('1234/2018');
    expect(v('sub_registrar_office')).toContain('Gurgaon');
    expect(v('floor_number')).toContain('second');
    expect(v('total_floors')).toContain('5');
    expect(v('accommodation')).toContain('3 BHK');
    expect(v('dimensions')).toContain('30 x 50 ft');
    expect(v('legal_restriction').join(' ')).toMatch(/mortgage/i);
  });
});
