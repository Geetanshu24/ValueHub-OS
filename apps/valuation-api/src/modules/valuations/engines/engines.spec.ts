import { describe, expect, it } from 'vitest';
import { engineFor, runCommercialEngine, runFlatEngine, runHouseEngine, runIndustrialEngine, runLandEngine, runMixedUseEngine } from './engines.js';
import { EngineInputError, type EngineInput } from './types.js';

const land = { areaSqm: 100, ratePerSqm: 50000, rateSource: 'Comparables A, B' };

describe('flat engine', () => {
  const base: EngineInput = {
    areaSource: 'Builder agreement',
    areaBasis: 'CARPET',
    rateBasis: 'CARPET',
    unit: { areaSqm: 80, ratePerSqm: 60000, rateSource: 'Society sale 2026' },
  };

  it('values area x rate', () => {
    const result = runFlatEngine(base);
    expect(result.totalValue).toBe(4_800_000);
    expect(result.adoptedAreaSqm).toBe(80);
  });

  it('rejects a rate on a different area basis than the area', () => {
    expect(() => runFlatEngine({ ...base, rateBasis: 'SUPER_BUILT_UP' })).toThrow(/same area basis/);
  });

  it('counts parking only when separately valued, and does not count it twice', () => {
    const extra = { component: 'Covered parking', quantity: 1, unit: 'slot', rate: 300000 };
    const included = runFlatEngine({ ...base, extraItems: [{ ...extra, treatment: 'INCLUDED_IN_BASE_RATE' }] });
    expect(included.totalValue).toBe(4_800_000);

    const separate = runFlatEngine({ ...base, extraItems: [{ ...extra, treatment: 'SEPARATELY_VALUED', sourceNote: 'Parking sale deed' }] });
    expect(separate.totalValue).toBe(5_100_000);

    expect(() =>
      runFlatEngine({ ...base, extraItems: [{ ...extra, treatment: 'SEPARATELY_VALUED', sourceNote: 'a note' }, { ...extra, treatment: 'SEPARATELY_VALUED', sourceNote: 'a note' }] }),
    ).toThrow(/more than once/);
  });

  it('requires a source for any separately valued item', () => {
    expect(() =>
      runFlatEngine({ ...base, extraItems: [{ component: 'Lift', quantity: 1, unit: 'nos', rate: 1000, treatment: 'SEPARATELY_VALUED' }] }),
    ).toThrow(EngineInputError);
  });

  it('flags REQUIRES_REVIEW items without counting them', () => {
    const result = runFlatEngine({ ...base, extraItems: [{ component: 'Solar', quantity: 1, unit: 'nos', rate: 50000, treatment: 'REQUIRES_REVIEW' }] });
    expect(result.requiresReview).toEqual(['Solar']);
    expect(result.totalValue).toBe(4_800_000);
  });
});

describe('house engine', () => {
  const floor = { label: 'Ground floor', areaSqm: 100, constructionRatePerSqm: 20000, rateSource: 'PWD schedule', ageYears: 10, usefulLifeYears: 50, residualPercent: 10 };
  const input: EngineInput = { areaSource: 'Deed and site agree', land, floors: [floor] };

  it('adds land and depreciated building value', () => {
    const result = runHouseEngine(input);
    // land 5,000,000 + building 2,000,000 - 20% depreciation 400,000
    expect(result.totalValue).toBe(6_600_000);
    expect(result.lines.map((l) => l.component)).toContain('Depreciation – Ground floor');
  });

  it('never depreciates below the stated residual', () => {
    const result = runHouseEngine({ ...input, floors: [{ ...floor, ageYears: 90 }] });
    const dep = result.lines.find((l) => l.component.startsWith('Depreciation'));
    expect(dep?.quantity).toBe(-90);
    expect(result.totalValue).toBe(5_200_000);
  });

  it('rejects two floors with the same label (double counting)', () => {
    expect(() => runHouseEngine({ ...input, floors: [floor, { ...floor }] })).toThrow(/more than once/);
  });

  it('requires at least one floor', () => {
    expect(() => runHouseEngine({ ...input, floors: [] })).toThrow(/floor/i);
  });

  it('line amounts reconcile to the total', () => {
    const result = runHouseEngine({ ...input, adjustments: [{ label: 'Corner plot', percent: 5, reason: 'Two road frontage' }] });
    const sum = result.lines.reduce((t, l) => t + l.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(result.totalValue);
  });
});

describe('land engine', () => {
  it('applies a supported adjustment to the land value', () => {
    const result = runLandEngine({ areaSource: 'Revenue record', land, adjustments: [{ label: 'No road access', percent: -10, reason: 'Landlocked parcel' }] });
    expect(result.totalValue).toBe(4_500_000);
  });

  it('rejects adjustments without a reason and absurd percentages', () => {
    expect(() => runLandEngine({ areaSource: 'Revenue record', land, adjustments: [{ label: 'x1', percent: 80, reason: '' }] })).toThrow(EngineInputError);
  });

  it('rejects zero, negative and over-precise inputs', () => {
    expect(() => runLandEngine({ areaSource: 'Revenue record', land: { ...land, areaSqm: 0 } })).toThrow();
    expect(() => runLandEngine({ areaSource: 'Revenue record', land: { ...land, ratePerSqm: -5 } })).toThrow();
    expect(() => runLandEngine({ areaSource: 'Revenue record', land: { ...land, areaSqm: 10.123 } })).toThrow(/two decimal/);
  });

  it('reports every problem at once', () => {
    try {
      runLandEngine({ areaSource: '', land: { areaSqm: 0, ratePerSqm: 0, rateSource: '' } });
      expect.unreachable();
    } catch (error) {
      expect((error as EngineInputError).problems.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('commercial engine', () => {
  const base: EngineInput = { areaSource: 'Sale deed', areaBasis: 'BUILT_UP', rateBasis: 'BUILT_UP', unit: { areaSqm: 50, ratePerSqm: 100000, rateSource: 'Shops in the same row' } };

  it('values by sales comparison like a flat', () => {
    const result = runCommercialEngine({ ...base, commercialMethod: 'SALES' });
    expect(result.totalValue).toBe(5_000_000);
    expect(result.method).toBe('COMMERCIAL_SALES_COMPARISON');
  });

  it('capitalises net income, showing the workings without adding them in', () => {
    const result = runCommercialEngine({
      ...base,
      commercialMethod: 'INCOME',
      income: { monthlyRent: 50000, rentSource: 'Lease dated Jan 2026', vacancyPercent: 10, operatingExpensePercent: 20, capRatePercent: 8, capRateSource: 'Market yield survey' },
    });
    // 600,000 gross - 10% - 20% = 432,000 NOI; / 8% = 5,400,000 (multiplier 12.5)
    expect(result.totalValue).toBe(5_400_000);
    expect(result.lines.filter((l) => l.treatment === 'SEPARATELY_VALUED')).toHaveLength(1);
    expect(result.lines.find((l) => l.component === 'Net annual income')?.rate).toBe(432_000);
  });

  it('needs a method, and the income inputs for the income method', () => {
    expect(() => runCommercialEngine(base)).toThrow(/method/i);
    expect(() => runCommercialEngine({ ...base, commercialMethod: 'INCOME' })).toThrow(/Income inputs/);
    expect(() => runCommercialEngine({ ...base, commercialMethod: 'INCOME', income: { monthlyRent: 1, rentSource: 'x', vacancyPercent: 0, operatingExpensePercent: 0, capRatePercent: 0, capRateSource: 'y' } })).toThrow(EngineInputError);
  });
});

describe('industrial engine', () => {
  const floor = { label: 'Main shed', areaSqm: 500, constructionRatePerSqm: 15000, rateSource: 'PWD schedule', ageYears: 10, usefulLifeYears: 50, residualPercent: 10 };
  const plant = { item: 'CNC lathe', quantity: 2, unitCost: 1_000_000, source: 'Supplier invoices', ageYears: 5, usefulLifeYears: 20, residualPercent: 10 };
  const base: EngineInput = { areaSource: 'Lease deed', land: { areaSqm: 1000, ratePerSqm: 10000, rateSource: 'Industrial plots nearby' }, floors: [floor] };

  it('values land and building, leaving plant out when the scope excludes it', () => {
    const result = runIndustrialEngine({ ...base, scopeIncludesPlant: false });
    // land 10,000,000 + shed 7,500,000 less 20% depreciation (1,500,000) = 16,000,000
    expect(result.totalValue).toBe(16_000_000);
  });

  it('adds depreciated plant when the scope includes it', () => {
    const result = runIndustrialEngine({ ...base, scopeIncludesPlant: true, plant: [plant] });
    // plant 2,000,000 - 25% = 1,500,000
    expect(result.totalValue).toBe(17_500_000);
    expect(result.method).toBe('INDUSTRIAL_LAND_BUILDING_PLANT');
  });

  it('refuses to guess the scope, or to count plant that the scope excludes', () => {
    expect(() => runIndustrialEngine(base)).toThrow(/scope/);
    expect(() => runIndustrialEngine({ ...base, scopeIncludesPlant: false, plant: [plant] })).toThrow(/excludes/);
    expect(() => runIndustrialEngine({ ...base, scopeIncludesPlant: true })).toThrow(/plant/i);
  });
});

describe('mixed-use engine', () => {
  const input: EngineInput = {
    areaSource: 'Sanctioned plan',
    sanctionedPlanRef: 'Plan 114/2025 dated 3 Mar 2025',
    components: [
      { label: 'Tower A flats', use: 'RESIDENTIAL', areaSqm: 1000, ratePerSqm: 50000, rateSource: 'Launch price list', completionPercent: 60 },
      { label: 'Retail podium', use: 'COMMERCIAL', areaSqm: 200, ratePerSqm: 100000, rateSource: 'Nearby shops', completionPercent: 100 },
    ],
  };

  it('scales each component to how much is built and adds them', () => {
    const result = runMixedUseEngine(input);
    // 50,000,000 - 40% + 20,000,000 = 50,000,000
    expect(result.totalValue).toBe(50_000_000);
    expect(result.adoptedAreaSqm).toBe(1200);
  });

  it('needs the sanctioned plan reference, components and valid completion', () => {
    expect(() => runMixedUseEngine({ ...input, sanctionedPlanRef: '' })).toThrow(/Sanctioned plan/);
    expect(() => runMixedUseEngine({ ...input, components: [] })).toThrow(/component/i);
    expect(() => runMixedUseEngine({ ...input, components: [{ ...input.components![0], completionPercent: 0 }] })).toThrow(EngineInputError);
  });
});

describe('engineFor', () => {
  it('covers every property class', () => {
    for (const c of ['FLAT', 'HOUSE', 'LAND', 'COMMERCIAL', 'INDUSTRIAL', 'MIXED_USE']) expect(engineFor(c)).not.toBeNull();
    expect(engineFor('SPACESHIP')).toBeNull();
  });
});
