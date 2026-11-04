export const ENGINE_VERSION = 'property-engines/1.1.0';

export const AREA_BASES = ['CARPET', 'BUILT_UP', 'SUPER_BUILT_UP'] as const;
export type AreaBasis = (typeof AREA_BASES)[number];

export const TREATMENTS = ['INCLUDED_IN_BASE_RATE', 'SEPARATELY_VALUED', 'NOT_APPLICABLE', 'REQUIRES_REVIEW'] as const;
export type Treatment = (typeof TREATMENTS)[number];

// All areas are in square metres and all money in rupees, with at most two
// decimal places, so what is stored reproduces exactly what was calculated.
export interface RatedArea {
  areaSqm: number;
  ratePerSqm: number;
  // Comparable, circle rate or other evidence the rate rests on.
  rateSource: string;
}

export interface FloorInput {
  label: string;
  areaSqm: number;
  constructionRatePerSqm: number;
  rateSource: string;
  ageYears: number;
  usefulLifeYears: number;
  // Share of the gross value retained at end of life. Always stated by the
  // valuer; there is no default.
  residualPercent: number;
}

export interface AdjustmentInput {
  label: string;
  percent: number;
  reason: string;
}

export interface ExtraItemInput {
  component: string;
  quantity: number;
  unit: string;
  rate: number;
  treatment: Treatment;
  sourceNote?: string;
  overrideReason?: string;
}

export const COMMERCIAL_METHODS = ['SALES', 'INCOME'] as const;
export type CommercialMethod = (typeof COMMERCIAL_METHODS)[number];

export const PROJECT_USES = ['RESIDENTIAL', 'COMMERCIAL', 'PARKING', 'OTHER'] as const;
export type ProjectUse = (typeof PROJECT_USES)[number];

// Income approach inputs; every percentage is the valuer's stated assumption.
export interface IncomeInput {
  monthlyRent: number;
  rentSource: string;
  vacancyPercent: number;
  operatingExpensePercent: number;
  capRatePercent: number;
  capRateSource: string;
}

export interface PlantItemInput {
  item: string;
  quantity: number;
  unitCost: number;
  source: string;
  ageYears: number;
  usefulLifeYears: number;
  residualPercent: number;
}

export interface ProjectComponentInput {
  label: string;
  use: ProjectUse;
  areaSqm: number;
  ratePerSqm: number;
  rateSource: string;
  completionPercent: number;
}

// One shape for all engines; each engine reads what it needs and rejects
// what is missing.
export interface EngineInput {
  areaSource: string;
  assumptions?: string;
  comparableIds?: string[];
  areaBasis?: AreaBasis;
  rateBasis?: AreaBasis;
  unit?: RatedArea;
  land?: RatedArea;
  floors?: FloorInput[];
  commercialMethod?: CommercialMethod;
  income?: IncomeInput;
  // Industrial: stated outright so plant is never counted or left out by accident.
  scopeIncludesPlant?: boolean;
  plant?: PlantItemInput[];
  // Mixed-use / project
  sanctionedPlanRef?: string;
  components?: ProjectComponentInput[];
  adjustments?: AdjustmentInput[];
  extraItems?: ExtraItemInput[];
}

export interface EngineLine {
  component: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  treatment: Treatment;
  sourceNote?: string;
  overrideReason?: string;
}

export interface EngineResult {
  method: string;
  engineVersion: string;
  areaBasis: string;
  adoptedAreaSqm: number;
  lines: EngineLine[];
  totalValue: number;
  // Components that must be settled before the valuation can go to review.
  requiresReview: string[];
}

export class EngineInputError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
  }
}
