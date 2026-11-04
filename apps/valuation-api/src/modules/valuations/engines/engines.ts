import {
  AREA_BASES,
  COMMERCIAL_METHODS,
  PROJECT_USES,
  ENGINE_VERSION,
  EngineInputError,
  TREATMENTS,
  type AdjustmentInput,
  type EngineInput,
  type EngineLine,
  type EngineResult,
  type ExtraItemInput,
  type FloorInput,
  type IncomeInput,
  type PlantItemInput,
  type ProjectComponentInput,
  type RatedArea,
} from './types.js';

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const hasAtMostTwoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

// Collects every problem instead of stopping at the first, so the valuer can
// fix a whole form in one pass.
class Checker {
  readonly problems: string[] = [];

  number(value: unknown, name: string, { min = 0, max = 1e12, exclusiveMin = false } = {}): value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.problems.push(`${name} must be a number`);
      return false;
    }
    if (exclusiveMin ? value <= min : value < min) {
      this.problems.push(`${name} must be ${exclusiveMin ? 'greater than' : 'at least'} ${min}`);
      return false;
    }
    if (value > max) {
      this.problems.push(`${name} must be at most ${max}`);
      return false;
    }
    if (!hasAtMostTwoDecimals(value)) {
      this.problems.push(`${name} must have at most two decimal places`);
      return false;
    }
    return true;
  }

  text(value: unknown, name: string, minLength = 2): value is string {
    if (typeof value !== 'string' || value.trim().length < minLength) {
      this.problems.push(`${name} is required (at least ${minLength} characters)`);
      return false;
    }
    return true;
  }

  ratedArea(area: RatedArea | undefined, name: string): area is RatedArea {
    if (!area) {
      this.problems.push(`${name} is required`);
      return false;
    }
    const before = this.problems.length;
    this.number(area.areaSqm, `${name} area`, { min: 0, exclusiveMin: true });
    this.number(area.ratePerSqm, `${name} rate`, { min: 0, exclusiveMin: true });
    this.text(area.rateSource, `${name} rate source`, 3);
    return this.problems.length === before;
  }

  noDuplicates(names: string[], what: string) {
    const seen = new Set<string>();
    for (const name of names) {
      const key = name.trim().toLowerCase();
      if (seen.has(key)) this.problems.push(`${what} "${name}" appears more than once`);
      seen.add(key);
    }
  }

  throwIfAny() {
    if (this.problems.length > 0) throw new EngineInputError(this.problems);
  }
}

function areaLine(component: string, area: RatedArea): EngineLine {
  return {
    component,
    quantity: area.areaSqm,
    unit: 'sq. m',
    rate: area.ratePerSqm,
    amount: round2(area.areaSqm * area.ratePerSqm),
    treatment: 'SEPARATELY_VALUED',
    sourceNote: area.rateSource,
  };
}

function floorLines(floor: FloorInput): EngineLine[] {
  const gross = round2(floor.areaSqm * floor.constructionRatePerSqm);
  const lines: EngineLine[] = [
    {
      component: floor.label,
      quantity: floor.areaSqm,
      unit: 'sq. m',
      rate: floor.constructionRatePerSqm,
      amount: gross,
      treatment: 'SEPARATELY_VALUED',
      sourceNote: floor.rateSource,
    },
  ];
  // Straight-line depreciation, never below the stated residual share.
  const depreciationPercent = round2(
    Math.min(floor.ageYears / floor.usefulLifeYears, 1 - floor.residualPercent / 100) * 100,
  );
  if (depreciationPercent > 0) {
    lines.push({
      component: `Depreciation – ${floor.label}`,
      // Negative, so amount = rate x quantity / 100 holds for every percentage line.
      quantity: -depreciationPercent,
      unit: '%',
      rate: gross,
      amount: -round2((gross * depreciationPercent) / 100),
      treatment: 'SEPARATELY_VALUED',
      sourceNote: `Straight line: ${floor.ageYears} of ${floor.usefulLifeYears} years, ${floor.residualPercent}% residual`,
    });
  }
  return lines;
}

function checkFloors(floors: FloorInput[] | undefined, check: Checker): floors is FloorInput[] {
  if (!floors || floors.length === 0) {
    check.problems.push('At least one floor is required');
    return false;
  }
  check.noDuplicates(floors.map((f) => f.label ?? ''), 'Floor');
  floors.forEach((floor, i) => {
    const name = `Floor ${i + 1}`;
    check.text(floor.label, `${name} label`);
    check.number(floor.areaSqm, `${name} area`, { min: 0, exclusiveMin: true });
    check.number(floor.constructionRatePerSqm, `${name} construction rate`, { min: 0, exclusiveMin: true });
    check.text(floor.rateSource, `${name} rate source`, 3);
    check.number(floor.ageYears, `${name} age`, { min: 0, max: 200 });
    check.number(floor.usefulLifeYears, `${name} useful life`, { min: 0, max: 200, exclusiveMin: true });
    check.number(floor.residualPercent, `${name} residual percent`, { min: 0, max: 100 });
  });
  return true;
}

function checkAdjustments(adjustments: AdjustmentInput[], check: Checker) {
  check.noDuplicates(adjustments.map((a) => a.label ?? ''), 'Adjustment');
  adjustments.forEach((adjustment, i) => {
    const name = `Adjustment ${i + 1}`;
    check.text(adjustment.label, `${name} label`);
    check.number(adjustment.percent, `${name} percent`, { min: -50, max: 50 });
    check.text(adjustment.reason, `${name} reason`, 5);
  });
}

// Each extra is declared as included in the base rate, separately valued, not
// applicable, or needing review, so the same item cannot be counted twice.
function checkExtras(extras: ExtraItemInput[], check: Checker) {
  check.noDuplicates(extras.map((e) => e.component ?? ''), 'Item');
  extras.forEach((item, i) => {
    const name = `Item ${i + 1}`;
    check.text(item.component, `${name} name`);
    check.text(item.unit, `${name} unit`, 1);
    check.number(item.quantity, `${name} quantity`, { min: 0, exclusiveMin: true });
    check.number(item.rate, `${name} rate`, { min: 0 });
    if (!TREATMENTS.includes(item.treatment)) check.problems.push(`${name} treatment is invalid`);
    if (item.treatment === 'SEPARATELY_VALUED') check.text(item.sourceNote, `${name} source`, 5);
  });
}

function extraLines(extras: ExtraItemInput[]): EngineLine[] {
  return extras.map((item) => ({
    component: item.component,
    quantity: item.quantity,
    unit: item.unit,
    rate: item.rate,
    amount: item.treatment === 'SEPARATELY_VALUED' ? round2(item.quantity * item.rate) : 0,
    treatment: item.treatment,
    sourceNote: item.sourceNote,
    overrideReason: item.overrideReason,
  }));
}

function adjustmentLines(adjustments: AdjustmentInput[], base: number): EngineLine[] {
  return adjustments.map((adjustment) => ({
    component: `Adjustment – ${adjustment.label}`,
    quantity: adjustment.percent,
    unit: '%',
    rate: base,
    amount: round2((base * adjustment.percent) / 100),
    treatment: 'SEPARATELY_VALUED',
    sourceNote: adjustment.reason,
  }));
}

const isCounted = (line: EngineLine) => line.treatment === 'SEPARATELY_VALUED';
const sum = (lines: EngineLine[]) => round2(lines.reduce((total, line) => total + line.amount, 0));

// Shared tail: primary lines -> adjustments on their subtotal -> extras -> total.
function assemble(
  meta: { method: string; areaBasis: string; adoptedAreaSqm: number },
  primary: EngineLine[],
  input: EngineInput,
  check: Checker,
): EngineResult {
  const adjustments = input.adjustments ?? [];
  const extras = input.extraItems ?? [];
  checkAdjustments(adjustments, check);
  checkExtras(extras, check);
  check.throwIfAny();

  const lines = [
    ...primary,
    ...adjustmentLines(adjustments, sum(primary)),
    ...extraLines(extras),
  ];
  const totalValue = sum(lines.filter(isCounted));
  if (totalValue <= 0) throw new EngineInputError(['Total value must be greater than zero']);

  return {
    ...meta,
    engineVersion: ENGINE_VERSION,
    lines,
    totalValue,
    requiresReview: lines.filter((l) => l.treatment === 'REQUIRES_REVIEW').map((l) => l.component),
  };
}

function checkCommon(input: EngineInput, check: Checker) {
  check.text(input.areaSource, 'Area source (why this area is adopted)', 5);
}

export function runFlatEngine(input: EngineInput): EngineResult {
  const check = new Checker();
  checkCommon(input, check);
  check.ratedArea(input.unit, 'Unit');
  if (!input.areaBasis || !AREA_BASES.includes(input.areaBasis)) check.problems.push('Area basis is required');
  if (input.rateBasis !== input.areaBasis) {
    check.problems.push('The rate must be on the same area basis as the area (carpet, built-up or super built-up)');
  }
  check.throwIfAny();

  const unit = input.unit as RatedArea;
  return assemble(
    { method: 'FLAT_SALES_COMPARISON', areaBasis: input.areaBasis as string, adoptedAreaSqm: unit.areaSqm },
    [areaLine(`Unit area (${(input.areaBasis as string).toLowerCase().replace('_', '-')})`, unit)],
    input,
    check,
  );
}

export function runHouseEngine(input: EngineInput): EngineResult {
  const check = new Checker();
  checkCommon(input, check);
  check.ratedArea(input.land, 'Land');
  checkFloors(input.floors, check);
  check.throwIfAny();

  const land = input.land as RatedArea;
  const primary = [areaLine('Land', land), ...(input.floors as FloorInput[]).flatMap(floorLines)];
  return assemble({ method: 'HOUSE_LAND_AND_BUILDING', areaBasis: 'LAND_AREA', adoptedAreaSqm: land.areaSqm }, primary, input, check);
}

export function runLandEngine(input: EngineInput): EngineResult {
  const check = new Checker();
  checkCommon(input, check);
  check.ratedArea(input.land, 'Land');
  check.throwIfAny();

  const land = input.land as RatedArea;
  return assemble({ method: 'LAND_AREA_RATE', areaBasis: 'LAND_AREA', adoptedAreaSqm: land.areaSqm }, [areaLine('Land', land)], input, check);
}

// ---------------------------------------------------------------- commercial

const info = (line: Omit<EngineLine, 'treatment' | 'amount'>): EngineLine => ({ ...line, amount: 0, treatment: 'INCLUDED_IN_BASE_RATE' });

function checkIncome(income: IncomeInput | undefined, check: Checker): income is IncomeInput {
  if (!income) {
    check.problems.push('Income inputs are required for the income method');
    return false;
  }
  const before = check.problems.length;
  check.number(income.monthlyRent, 'Monthly rent', { min: 0, exclusiveMin: true });
  check.text(income.rentSource, 'Rent source', 3);
  check.number(income.vacancyPercent, 'Vacancy percent', { min: 0, max: 100 });
  check.number(income.operatingExpensePercent, 'Operating expense percent', { min: 0, max: 100 });
  check.number(income.capRatePercent, 'Capitalisation rate', { min: 0, max: 100, exclusiveMin: true });
  check.text(income.capRateSource, 'Capitalisation rate source', 3);
  return check.problems.length === before;
}

// Net income / cap rate. The intermediate lines are shown for the workings but
// are not added in; only the capitalised value counts toward the total.
function incomeLines(income: IncomeInput): EngineLine[] {
  const gross = round2(income.monthlyRent * 12);
  const vacancy = round2((gross * income.vacancyPercent) / 100);
  const effective = round2(gross - vacancy);
  const opex = round2((effective * income.operatingExpensePercent) / 100);
  const noi = round2(effective - opex);
  // The multiplier is held to two decimals so the stored line multiplies out exactly.
  const multiplier = round2(100 / income.capRatePercent);
  return [
    info({ component: 'Gross annual rent', quantity: 12, unit: 'months', rate: income.monthlyRent, sourceNote: income.rentSource }),
    info({ component: 'Vacancy allowance', quantity: -income.vacancyPercent, unit: '%', rate: gross, sourceNote: 'Valuer assumption' }),
    info({ component: 'Operating expenses', quantity: -income.operatingExpensePercent, unit: '%', rate: effective, sourceNote: 'Valuer assumption' }),
    info({ component: 'Net annual income', quantity: 1, unit: 'year', rate: noi, sourceNote: 'Rent less vacancy and expenses' }),
    {
      component: `Capitalised value at ${income.capRatePercent}%`,
      quantity: multiplier,
      unit: 'x',
      rate: noi,
      amount: round2(noi * multiplier),
      treatment: 'SEPARATELY_VALUED',
      sourceNote: income.capRateSource,
    },
  ];
}

export function runCommercialEngine(input: EngineInput): EngineResult {
  const check = new Checker();
  checkCommon(input, check);
  const method = input.commercialMethod;
  if (!method || !COMMERCIAL_METHODS.includes(method)) check.problems.push('Choose the method: SALES or INCOME');
  check.ratedArea(input.unit, 'Unit');
  if (!input.areaBasis || !AREA_BASES.includes(input.areaBasis)) check.problems.push('Area basis is required');
  if (method === 'SALES' && input.rateBasis !== input.areaBasis) {
    check.problems.push('The rate must be on the same area basis as the area (carpet, built-up or super built-up)');
  }
  if (method === 'INCOME') checkIncome(input.income, check);
  check.throwIfAny();

  const unit = input.unit as RatedArea;
  const basis = (input.areaBasis as string).toLowerCase().replace('_', '-');
  const primary =
    method === 'INCOME'
      ? incomeLines(input.income as IncomeInput)
      : [areaLine(`Commercial area (${basis})`, unit)];
  return assemble({ method: method === 'INCOME' ? 'COMMERCIAL_INCOME' : 'COMMERCIAL_SALES_COMPARISON', areaBasis: input.areaBasis as string, adoptedAreaSqm: unit.areaSqm }, primary, input, check);
}

// ---------------------------------------------------------------- industrial

function checkPlant(plant: PlantItemInput[] | undefined, check: Checker) {
  if (!plant || plant.length === 0) {
    check.problems.push('List the plant and machinery, or state that it is outside the scope');
    return;
  }
  check.noDuplicates(plant.map((p) => p.item ?? ''), 'Plant item');
  plant.forEach((p, i) => {
    const name = `Plant item ${i + 1}`;
    check.text(p.item, `${name} name`);
    check.number(p.quantity, `${name} quantity`, { min: 0, exclusiveMin: true });
    check.number(p.unitCost, `${name} unit cost`, { min: 0, exclusiveMin: true });
    check.text(p.source, `${name} source`, 3);
    check.number(p.ageYears, `${name} age`, { min: 0, max: 200 });
    check.number(p.usefulLifeYears, `${name} useful life`, { min: 0, max: 200, exclusiveMin: true });
    check.number(p.residualPercent, `${name} residual percent`, { min: 0, max: 100 });
  });
}

function plantLines(item: PlantItemInput): EngineLine[] {
  const gross = round2(item.quantity * item.unitCost);
  const lines: EngineLine[] = [
    { component: `Plant – ${item.item}`, quantity: item.quantity, unit: 'nos', rate: item.unitCost, amount: gross, treatment: 'SEPARATELY_VALUED', sourceNote: item.source },
  ];
  const dep = round2(Math.min(item.ageYears / item.usefulLifeYears, 1 - item.residualPercent / 100) * 100);
  if (dep > 0) {
    lines.push({
      component: `Depreciation – ${item.item}`,
      quantity: -dep,
      unit: '%',
      rate: gross,
      amount: -round2((gross * dep) / 100),
      treatment: 'SEPARATELY_VALUED',
      sourceNote: `Straight line: ${item.ageYears} of ${item.usefulLifeYears} years, ${item.residualPercent}% residual`,
    });
  }
  return lines;
}

// Land and building as for a house, with plant and machinery valued separately
// and only when the assignment's scope says so.
export function runIndustrialEngine(input: EngineInput): EngineResult {
  const check = new Checker();
  checkCommon(input, check);
  check.ratedArea(input.land, 'Land');
  checkFloors(input.floors, check);
  if (typeof input.scopeIncludesPlant !== 'boolean') check.problems.push('State whether plant and machinery are within the scope (true or false)');
  else if (input.scopeIncludesPlant) checkPlant(input.plant, check);
  else if (input.plant && input.plant.length > 0) check.problems.push('Plant is listed but the scope excludes it; remove it or change the scope');
  check.throwIfAny();

  const land = input.land as RatedArea;
  const primary = [
    areaLine('Land', land),
    ...(input.floors as FloorInput[]).flatMap(floorLines),
    ...(input.scopeIncludesPlant ? (input.plant as PlantItemInput[]).flatMap(plantLines) : []),
  ];
  return assemble({ method: input.scopeIncludesPlant ? 'INDUSTRIAL_LAND_BUILDING_PLANT' : 'INDUSTRIAL_LAND_AND_BUILDING', areaBasis: 'LAND_AREA', adoptedAreaSqm: land.areaSqm }, primary, input, check);
}

// ---------------------------------------------------------------- mixed-use / project

function checkComponents(components: ProjectComponentInput[] | undefined, check: Checker) {
  if (!components || components.length === 0) {
    check.problems.push('At least one component is required');
    return;
  }
  check.noDuplicates(components.map((c) => c.label ?? ''), 'Component');
  components.forEach((c, i) => {
    const name = `Component ${i + 1}`;
    check.text(c.label, `${name} label`);
    if (!PROJECT_USES.includes(c.use)) check.problems.push(`${name} use must be one of ${PROJECT_USES.join(', ')}`);
    check.number(c.areaSqm, `${name} area`, { min: 0, exclusiveMin: true });
    check.number(c.ratePerSqm, `${name} rate`, { min: 0, exclusiveMin: true });
    check.text(c.rateSource, `${name} rate source`, 3);
    check.number(c.completionPercent, `${name} completion percent`, { min: 0, max: 100, exclusiveMin: true });
  });
}

function componentLines(c: ProjectComponentInput): EngineLine[] {
  const gross = round2(c.areaSqm * c.ratePerSqm);
  const lines: EngineLine[] = [
    { component: `${c.label} (${c.use.toLowerCase()})`, quantity: c.areaSqm, unit: 'sq. m', rate: c.ratePerSqm, amount: gross, treatment: 'SEPARATELY_VALUED', sourceNote: c.rateSource },
  ];
  if (c.completionPercent < 100) {
    const shortfall = round2(100 - c.completionPercent);
    lines.push({
      component: `Not yet complete – ${c.label}`,
      quantity: -shortfall,
      unit: '%',
      rate: gross,
      amount: -round2((gross * shortfall) / 100),
      treatment: 'SEPARATELY_VALUED',
      sourceNote: `${c.completionPercent}% complete, per the valuer's assessment`,
    });
  }
  return lines;
}

// Each use or phase is valued on its own area and rate, scaled to how much is built.
export function runMixedUseEngine(input: EngineInput): EngineResult {
  const check = new Checker();
  checkCommon(input, check);
  check.text(input.sanctionedPlanRef, 'Sanctioned plan reference', 5);
  checkComponents(input.components, check);
  check.throwIfAny();

  const components = input.components as ProjectComponentInput[];
  const adopted = round2(components.reduce((t, c) => t + c.areaSqm, 0));
  return assemble({ method: 'MIXED_USE_COMPONENTS', areaBasis: 'COMPONENT_AREAS', adoptedAreaSqm: adopted }, components.flatMap(componentLines), input, check);
}

export const SUPPORTED_CLASSES = ['FLAT', 'HOUSE', 'LAND', 'COMMERCIAL', 'INDUSTRIAL', 'MIXED_USE'] as const;

// Returns null for a property class that has no engine yet, rather than
// forcing it through the wrong calculator.
export function engineFor(propertyClass: string): ((input: EngineInput) => EngineResult) | null {
  switch (propertyClass) {
    case 'FLAT':
      return runFlatEngine;
    case 'HOUSE':
      return runHouseEngine;
    case 'LAND':
      return runLandEngine;
    case 'COMMERCIAL':
      return runCommercialEngine;
    case 'INDUSTRIAL':
      return runIndustrialEngine;
    case 'MIXED_USE':
      return runMixedUseEngine;
    default:
      return null;
  }
}
