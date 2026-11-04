import type { PropertyClass } from '@value-hub/valuation-shared'

export const AREA_BASES = ['CARPET', 'BUILT_UP', 'SUPER_BUILT_UP'] as const
export const TREATMENTS = ['SEPARATELY_VALUED', 'INCLUDED_IN_BASE_RATE', 'NOT_APPLICABLE', 'REQUIRES_REVIEW'] as const
export const USES = ['RESIDENTIAL', 'COMMERCIAL', 'PARKING', 'OTHER'] as const
export type Basis = (typeof AREA_BASES)[number]

export interface RatedForm { area: string; rate: string; source: string }
export interface FloorForm { label: string; area: string; rate: string; source: string; age: string; life: string; residual: string }
export interface IncomeForm { monthlyRent: string; rentSource: string; vacancyPercent: string; operatingExpensePercent: string; capRatePercent: string; capRateSource: string }
export interface PlantForm { item: string; quantity: string; unitCost: string; source: string; age: string; life: string; residual: string }
export interface ComponentForm { label: string; use: (typeof USES)[number]; area: string; rate: string; source: string; completion: string }
export interface AdjustmentForm { label: string; percent: string; reason: string }
export interface ExtraForm { component: string; quantity: string; unit: string; rate: string; treatment: (typeof TREATMENTS)[number]; sourceNote: string }

export interface FormState {
  areaSource: string; assumptions: string; changeReason: string
  areaBasis: Basis; rateBasis: Basis
  unit: RatedForm; land: RatedForm; floors: FloorForm[]
  method: 'SALES' | 'INCOME'; income: IncomeForm
  scopePlant: '' | 'yes' | 'no'; plant: PlantForm[]
  planRef: string; components: ComponentForm[]
  adjustments: AdjustmentForm[]; extras: ExtraForm[]
  cited: string[]
}

export const emptyRated: RatedForm = { area: '', rate: '', source: '' }
export const emptyFloor: FloorForm = { label: '', area: '', rate: '', source: '', age: '', life: '', residual: '' }
export const emptyIncome: IncomeForm = { monthlyRent: '', rentSource: '', vacancyPercent: '', operatingExpensePercent: '', capRatePercent: '', capRateSource: '' }
export const emptyPlant: PlantForm = { item: '', quantity: '1', unitCost: '', source: '', age: '', life: '', residual: '' }
export const emptyComponent: ComponentForm = { label: '', use: 'RESIDENTIAL', area: '', rate: '', source: '', completion: '100' }
export const emptyAdjustment: AdjustmentForm = { label: '', percent: '', reason: '' }
export const emptyExtra: ExtraForm = { component: '', quantity: '1', unit: 'nos', rate: '', treatment: 'REQUIRES_REVIEW', sourceNote: '' }

export const emptyState = (): FormState => ({
  areaSource: '', assumptions: '', changeReason: '', areaBasis: 'CARPET', rateBasis: 'CARPET',
  unit: { ...emptyRated }, land: { ...emptyRated }, floors: [], method: 'SALES', income: { ...emptyIncome },
  scopePlant: '', plant: [], planRef: '', components: [], adjustments: [], extras: [], cited: [],
})

const num = (value: string) => (value.trim() === '' ? undefined : Number(value))
const rated = (f: RatedForm) => ({ areaSqm: num(f.area), ratePerSqm: num(f.rate), rateSource: f.source })

// The API input for the property class. Blank numbers are left out so the
// engine reports each missing field by name.
export function toPayload(cls: PropertyClass, s: FormState): Record<string, unknown> {
  return {
    areaSource: s.areaSource,
    ...(s.cited.length > 0 && { comparableIds: s.cited }),
    ...(s.assumptions.trim() && { assumptions: s.assumptions }),
    ...(cls === 'FLAT' && { areaBasis: s.areaBasis, rateBasis: s.rateBasis, unit: rated(s.unit) }),
    ...(cls === 'COMMERCIAL' && {
      commercialMethod: s.method, areaBasis: s.areaBasis, rateBasis: s.rateBasis, unit: rated(s.unit),
      ...(s.method === 'INCOME' && { income: { monthlyRent: num(s.income.monthlyRent), rentSource: s.income.rentSource, vacancyPercent: num(s.income.vacancyPercent), operatingExpensePercent: num(s.income.operatingExpensePercent), capRatePercent: num(s.income.capRatePercent), capRateSource: s.income.capRateSource } }),
    }),
    ...(['HOUSE', 'LAND', 'INDUSTRIAL'].includes(cls) && { land: rated(s.land) }),
    ...(['HOUSE', 'INDUSTRIAL'].includes(cls) && {
      floors: s.floors.map((f) => ({ label: f.label, areaSqm: num(f.area), constructionRatePerSqm: num(f.rate), rateSource: f.source, ageYears: num(f.age), usefulLifeYears: num(f.life), residualPercent: num(f.residual) })),
    }),
    ...(cls === 'INDUSTRIAL' && {
      ...(s.scopePlant && { scopeIncludesPlant: s.scopePlant === 'yes' }),
      ...(s.scopePlant === 'yes' && { plant: s.plant.map((p) => ({ item: p.item, quantity: num(p.quantity), unitCost: num(p.unitCost), source: p.source, ageYears: num(p.age), usefulLifeYears: num(p.life), residualPercent: num(p.residual) })) }),
    }),
    ...(cls === 'MIXED_USE' && {
      sanctionedPlanRef: s.planRef,
      components: s.components.map((c) => ({ label: c.label, use: c.use, areaSqm: num(c.area), ratePerSqm: num(c.rate), rateSource: c.source, completionPercent: num(c.completion) })),
    }),
    adjustments: s.adjustments.map((a) => ({ label: a.label, percent: num(a.percent), reason: a.reason })),
    extraItems: s.extras.map((x) => ({ component: x.component, quantity: num(x.quantity), unit: x.unit, rate: num(x.rate), treatment: x.treatment, ...(x.sourceNote && { sourceNote: x.sourceNote }) })),
  }
}

type Json = Record<string, unknown>
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))
const ratedFrom = (v: unknown): RatedForm => { const o = (v ?? {}) as Json; return { area: str(o.areaSqm), rate: str(o.ratePerSqm), source: str(o.rateSource) } }
const list = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : [])

// The reverse of toPayload, so an earlier version can be revised.
export function fromInputs(inputs: unknown): FormState {
  const i = (inputs ?? {}) as Json
  const income = (i.income ?? {}) as Json
  const base = emptyState()
  return {
    ...base,
    areaSource: str(i.areaSource), assumptions: str(i.assumptions),
    areaBasis: (AREA_BASES as readonly string[]).includes(str(i.areaBasis)) ? (i.areaBasis as Basis) : 'CARPET',
    rateBasis: (AREA_BASES as readonly string[]).includes(str(i.rateBasis)) ? (i.rateBasis as Basis) : 'CARPET',
    unit: ratedFrom(i.unit), land: ratedFrom(i.land),
    floors: list(i.floors).map((f) => ({ label: str(f.label), area: str(f.areaSqm), rate: str(f.constructionRatePerSqm), source: str(f.rateSource), age: str(f.ageYears), life: str(f.usefulLifeYears), residual: str(f.residualPercent) })),
    method: i.commercialMethod === 'INCOME' ? 'INCOME' : 'SALES',
    income: { monthlyRent: str(income.monthlyRent), rentSource: str(income.rentSource), vacancyPercent: str(income.vacancyPercent), operatingExpensePercent: str(income.operatingExpensePercent), capRatePercent: str(income.capRatePercent), capRateSource: str(income.capRateSource) },
    scopePlant: i.scopeIncludesPlant === true ? 'yes' : i.scopeIncludesPlant === false ? 'no' : '',
    plant: list(i.plant).map((p) => ({ item: str(p.item), quantity: str(p.quantity), unitCost: str(p.unitCost), source: str(p.source), age: str(p.ageYears), life: str(p.usefulLifeYears), residual: str(p.residualPercent) })),
    planRef: str(i.sanctionedPlanRef),
    components: list(i.components).map((c) => ({ label: str(c.label), use: ((USES as readonly string[]).includes(str(c.use)) ? c.use : 'OTHER') as ComponentForm['use'], area: str(c.areaSqm), rate: str(c.ratePerSqm), source: str(c.rateSource), completion: str(c.completionPercent) })),
    adjustments: list(i.adjustments).map((a) => ({ label: str(a.label), percent: str(a.percent), reason: str(a.reason) })),
    extras: list(i.extraItems).map((x) => ({ component: str(x.component), quantity: str(x.quantity), unit: str(x.unit), rate: str(x.rate), treatment: ((TREATMENTS as readonly string[]).includes(str(x.treatment)) ? x.treatment : 'REQUIRES_REVIEW') as ExtraForm['treatment'], sourceNote: str(x.sourceNote) })),
    cited: Array.isArray(i.comparableIds) ? (i.comparableIds as string[]) : [],
  }
}
