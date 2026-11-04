import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import type { PropertyClass } from '@value-hub/valuation-shared'
import Collapsible from '../components/Collapsible.tsx'
import { buttonClass, Card, ErrorText, errorMessage, ghostButtonClass, inputClass } from '../components/ui.tsx'
import { api, type Paginated } from '../lib/api.ts'
import { useAssignmentParam } from '../lib/useAssignmentParam.ts'
import { useFetch } from '../lib/useFetch.ts'

interface AssignmentOption {
  id: string
  code: string
  status: string
  property: { addressLine: string; propertyClass: PropertyClass }
}
interface Line {
  component: string
  quantity: string | number
  unit: string
  rate: string | number
  amount: string | number
  treatment: string
  sourceNote?: string | null
}
interface Version {
  id: string
  versionNumber: number
  status: string
  totalValue: string
  method: string
  engineVersion: string
  changeReason: string | null
  lineItems: Line[]
}
interface Comparable {
  id: string
  location: string
  source: string
  isTransaction: boolean
  observedOn: string
  areaBasis: string
  ratePerSqm: string
  verified: boolean
}
interface ComparableSummary {
  areaBasis: string
  count: number
  min: number
  max: number
  median: number
}
interface Preview {
  result: { totalValue: number; lines: Line[]; requiresReview: string[] }
  warnings: string[]
}

const AREA_BASES = ['CARPET', 'BUILT_UP', 'SUPER_BUILT_UP'] as const
const TREATMENTS = ['SEPARATELY_VALUED', 'INCLUDED_IN_BASE_RATE', 'NOT_APPLICABLE', 'REQUIRES_REVIEW'] as const
const SUPPORTED: PropertyClass[] = ['FLAT', 'HOUSE', 'LAND', 'COMMERCIAL', 'INDUSTRIAL', 'MIXED_USE']
const USES = ['RESIDENTIAL', 'COMMERCIAL', 'PARKING', 'OTHER'] as const

const inr = (value: string | number) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const num = (value: string) => (value.trim() === '' ? undefined : Number(value))

interface IncomeForm {
  monthlyRent: string
  rentSource: string
  vacancyPercent: string
  operatingExpensePercent: string
  capRatePercent: string
  capRateSource: string
}
interface PlantForm {
  item: string
  quantity: string
  unitCost: string
  source: string
  age: string
  life: string
  residual: string
}
interface ComponentForm {
  label: string
  use: (typeof USES)[number]
  area: string
  rate: string
  source: string
  completion: string
}

interface RatedForm {
  area: string
  rate: string
  source: string
}
interface FloorForm {
  label: string
  area: string
  rate: string
  source: string
  age: string
  life: string
  residual: string
}
interface AdjustmentForm {
  label: string
  percent: string
  reason: string
}
interface ExtraForm {
  component: string
  quantity: string
  unit: string
  rate: string
  treatment: (typeof TREATMENTS)[number]
  sourceNote: string
}

const emptyRated: RatedForm = { area: '', rate: '', source: '' }
const emptyFloor: FloorForm = { label: '', area: '', rate: '', source: '', age: '', life: '', residual: '' }
const emptyIncome: IncomeForm = { monthlyRent: '', rentSource: '', vacancyPercent: '', operatingExpensePercent: '', capRatePercent: '', capRateSource: '' }
const emptyPlant: PlantForm = { item: '', quantity: '1', unitCost: '', source: '', age: '', life: '', residual: '' }
const emptyComponent: ComponentForm = { label: '', use: 'RESIDENTIAL', area: '', rate: '', source: '', completion: '100' }
const emptyAdjustment: AdjustmentForm = { label: '', percent: '', reason: '' }
const emptyExtra: ExtraForm = { component: '', quantity: '1', unit: 'nos', rate: '', treatment: 'REQUIRES_REVIEW', sourceNote: '' }

function RatedFields({ title, value, onChange }: { title: string; value: RatedForm; onChange: (next: RatedForm) => void }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-sm font-semibold">{title}</p>
      <div className="flex flex-wrap gap-2">
        <input className={`${inputClass} w-32`} type="number" step="0.01" placeholder="Area (sq. m)" aria-label={`${title} area`} value={value.area} onChange={(e) => onChange({ ...value, area: e.target.value })} />
        <input className={`${inputClass} w-36`} type="number" step="0.01" placeholder="Rate / sq. m" aria-label={`${title} rate`} value={value.rate} onChange={(e) => onChange({ ...value, rate: e.target.value })} />
        <input className={`${inputClass} min-w-64 flex-1`} placeholder="Rate source (comparables, circle rate…)" aria-label={`${title} rate source`} value={value.source} onChange={(e) => onChange({ ...value, source: e.target.value })} />
      </div>
    </div>
  )
}

function LinesTable({ lines }: { lines: Line[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-ink-soft">
        <tr>
          <th className="py-1">Component</th>
          <th className="py-1">Qty</th>
          <th className="py-1">Rate</th>
          <th className="py-1 text-right">Amount (₹)</th>
          <th className="py-1">Treatment</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={index} className="border-t border-slate-100">
            <td className="py-1">
              {line.component}
              {line.sourceNote && <span className="block text-xs text-slate-500">{line.sourceNote}</span>}
            </td>
            <td className="py-1">
              {inr(line.quantity)} {line.unit}
            </td>
            <td className="py-1">{inr(line.rate)}</td>
            <td className="py-1 text-right font-semibold">{inr(line.amount)}</td>
            <td className="py-1 text-xs text-slate-500">{line.treatment.replaceAll('_', ' ').toLowerCase()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function ValuationWorkspace() {
  const assignments = useFetch<Paginated<AssignmentOption>>('/assignments?pageSize=100')
  const [assignmentId, setAssignmentId] = useAssignmentParam()
  const versions = useFetch<Version[]>(assignmentId ? `/assignments/${assignmentId}/valuations` : null)
  const comparables = useFetch<Comparable[]>(assignmentId ? `/assignments/${assignmentId}/comparables` : null)
  const summary = useFetch<ComparableSummary[]>(assignmentId ? `/assignments/${assignmentId}/comparables/summary` : null)
  const [cited, setCited] = useState<string[]>([])
  const [evidence, setEvidence] = useState({ location: '', source: '', isTransaction: true, observedOn: '', areaBasis: 'LAND', ratePerSqm: '' })
  const assignment = assignments.data?.items.find((item) => item.id === assignmentId)
  const propertyClass = assignment?.property.propertyClass

  const [areaSource, setAreaSource] = useState('')
  const [assumptions, setAssumptions] = useState('')
  const [changeReason, setChangeReason] = useState('')
  const [areaBasis, setAreaBasis] = useState<(typeof AREA_BASES)[number]>('CARPET')
  const [rateBasis, setRateBasis] = useState<(typeof AREA_BASES)[number]>('CARPET')
  const [unit, setUnit] = useState<RatedForm>(emptyRated)
  const [land, setLand] = useState<RatedForm>(emptyRated)
  const [floors, setFloors] = useState<FloorForm[]>([{ ...emptyFloor }])
  const [method, setMethod] = useState<'SALES' | 'INCOME'>('SALES')
  const [income, setIncome] = useState<IncomeForm>(emptyIncome)
  const [scopePlant, setScopePlant] = useState<'' | 'yes' | 'no'>('')
  const [plant, setPlant] = useState<PlantForm[]>([])
  const [planRef, setPlanRef] = useState('')
  const [components, setComponents] = useState<ComponentForm[]>([{ ...emptyComponent }])
  const [adjustments, setAdjustments] = useState<AdjustmentForm[]>([])
  const [extras, setExtras] = useState<ExtraForm[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)

  // One assignment's valuation lives on its own Valuation Workings page.
  if (assignmentId) return <Navigate to={`/assignments/${assignmentId}/valuation`} replace />

  const rated = (form: RatedForm) => ({ areaSqm: num(form.area), ratePerSqm: num(form.rate), rateSource: form.source })

  function payload() {
    return {
      areaSource,
      ...(cited.length > 0 && { comparableIds: cited }),
      ...(assumptions && { assumptions }),
      ...(propertyClass === 'FLAT' && { areaBasis, rateBasis, unit: rated(unit) }),
      ...(propertyClass === 'COMMERCIAL' && {
        commercialMethod: method,
        areaBasis,
        rateBasis,
        unit: rated(unit),
        ...(method === 'INCOME' && {
          income: {
            monthlyRent: num(income.monthlyRent),
            rentSource: income.rentSource,
            vacancyPercent: num(income.vacancyPercent),
            operatingExpensePercent: num(income.operatingExpensePercent),
            capRatePercent: num(income.capRatePercent),
            capRateSource: income.capRateSource,
          },
        }),
      }),
      ...(['HOUSE', 'LAND', 'INDUSTRIAL'].includes(propertyClass ?? '') && { land: rated(land) }),
      ...(propertyClass === 'INDUSTRIAL' && {
        ...(scopePlant && { scopeIncludesPlant: scopePlant === 'yes' }),
        ...(scopePlant === 'yes' && {
          plant: plant.map((p) => ({ item: p.item, quantity: num(p.quantity), unitCost: num(p.unitCost), source: p.source, ageYears: num(p.age), usefulLifeYears: num(p.life), residualPercent: num(p.residual) })),
        }),
      }),
      ...(propertyClass === 'MIXED_USE' && {
        sanctionedPlanRef: planRef,
        components: components.map((c) => ({ label: c.label, use: c.use, areaSqm: num(c.area), ratePerSqm: num(c.rate), rateSource: c.source, completionPercent: num(c.completion) })),
      }),
      ...(['HOUSE', 'INDUSTRIAL'].includes(propertyClass ?? '') && {
        floors: floors.map((f) => ({
          label: f.label,
          areaSqm: num(f.area),
          constructionRatePerSqm: num(f.rate),
          rateSource: f.source,
          ageYears: num(f.age),
          usefulLifeYears: num(f.life),
          residualPercent: num(f.residual),
        })),
      }),
      adjustments: adjustments.map((a) => ({ label: a.label, percent: num(a.percent), reason: a.reason })),
      extraItems: extras.map((x) => ({
        component: x.component,
        quantity: num(x.quantity),
        unit: x.unit,
        rate: num(x.rate),
        treatment: x.treatment,
        ...(x.sourceNote && { sourceNote: x.sourceNote }),
      })),
    }
  }

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const calculate = () =>
    run(async () => setPreview(await api.post<Preview>(`/assignments/${assignmentId}/valuations/preview`, payload())))

  const saveDraft = () =>
    run(async () => {
      const body = { ...payload(), ...(changeReason && { changeReason }) }
      await api.post(`/assignments/${assignmentId}/valuations`, body)
      setPreview(null)
      setChangeReason('')
      versions.reload()
    })

  const move = (id: string, action: 'submit-for-review' | 'approve') =>
    run(async () => {
      await api.post(`/valuations/${id}/${action}`, {})
      versions.reload()
    })

  const reloadEvidence = () => {
    comparables.reload()
    summary.reload()
  }

  const addEvidence = () =>
    run(async () => {
      await api.post(`/assignments/${assignmentId}/comparables`, { ...evidence, ratePerSqm: Number(evidence.ratePerSqm) })
      setEvidence({ ...evidence, location: '', source: '', ratePerSqm: '' })
      reloadEvidence()
    })

  const verify = (id: string, verified: boolean) =>
    run(async () => {
      await api.patch(`/comparables/${id}/verify`, { verified })
      if (!verified) setCited((list) => list.filter((x) => x !== id))
      reloadEvidence()
    })

  function patch<T>(list: T[], index: number, next: T): T[] {
    return list.map((item, i) => (i === index ? next : item))
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Valuation Workspace</h1>
      <p className="mb-4 mt-1 text-base text-ink-soft">
        Areas in sq. m, money in ₹ (two decimals). Every rate needs a source; every adjustment needs a reason.
      </p>

      <select className={`${inputClass} mb-4`} value={assignmentId} onChange={(e) => { setAssignmentId(e.target.value); setPreview(null) }} aria-label="Assignment">
        <option value="">Select an assignment…</option>
        {assignments.data?.items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.code} — {item.property.propertyClass} — {item.status}
          </option>
        ))}
      </select>
      <ErrorText message={error ?? assignments.error ?? versions.error} />

      {assignment && propertyClass && !SUPPORTED.includes(propertyClass) && (
        <p className="text-ink-soft">No valuation engine for {propertyClass} yet (flat, house and land are available).</p>
      )}

      {assignment && propertyClass && SUPPORTED.includes(propertyClass) && (
        <>
          <Card title="Market evidence">
            {summary.data?.map((row) => (
              <p key={row.areaBasis} className="mb-1 text-sm text-ink-soft">
                Verified {row.areaBasis.toLowerCase().replace('_', '-')} rates: {row.count} · ₹ {inr(row.min)} – {inr(row.max)} · median {inr(row.median)} / sq. m
              </p>
            ))}
            {comparables.data?.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 border-t border-slate-100 py-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" disabled={!c.verified} checked={cited.includes(c.id)} onChange={(e) => setCited(e.target.checked ? [...cited, c.id] : cited.filter((x) => x !== c.id))} aria-label={`Cite ${c.location}`} />
                  <span>
                    {c.location} · ₹ {inr(c.ratePerSqm)} / sq. m ({c.areaBasis.toLowerCase()}, {c.isTransaction ? 'transaction' : 'asking'}, {new Date(c.observedOn).toLocaleDateString('en-IN')})
                    <span className="block text-xs text-slate-500">{c.source}</span>
                  </span>
                </label>
                <button type="button" className={ghostButtonClass} onClick={() => void verify(c.id, !c.verified)}>{c.verified ? 'Unverify' : 'Verify'}</button>
              </div>
            ))}
            <div className="mt-3 flex flex-wrap gap-2">
              <input className={inputClass} placeholder="Location" aria-label="Comparable location" value={evidence.location} onChange={(e) => setEvidence({ ...evidence, location: e.target.value })} />
              <input className={inputClass} placeholder="Source (registry, dealer…)" aria-label="Comparable source" value={evidence.source} onChange={(e) => setEvidence({ ...evidence, source: e.target.value })} />
              <input className={`${inputClass} w-32`} type="number" step="0.01" placeholder="Rate / sq. m" aria-label="Comparable rate" value={evidence.ratePerSqm} onChange={(e) => setEvidence({ ...evidence, ratePerSqm: e.target.value })} />
              <input className={inputClass} type="date" aria-label="Observed on" value={evidence.observedOn} onChange={(e) => setEvidence({ ...evidence, observedOn: e.target.value })} />
              <select className={inputClass} aria-label="Comparable basis" value={evidence.areaBasis} onChange={(e) => setEvidence({ ...evidence, areaBasis: e.target.value })}>
                {['LAND', 'CARPET', 'BUILT_UP', 'SUPER_BUILT_UP'].map((b) => <option key={b}>{b}</option>)}
              </select>
              <label className="text-sm"><input type="checkbox" checked={evidence.isTransaction} onChange={(e) => setEvidence({ ...evidence, isTransaction: e.target.checked })} /> Completed transaction</label>
              <button type="button" className={ghostButtonClass} onClick={() => void addEvidence()}>Add evidence</button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Comparables are entered by people, never generated. Someone other than the recorder verifies each one; only verified ones can be cited.</p>
          </Card>

          <Card title={`New valuation — ${propertyClass.toLowerCase()}`}>
            {propertyClass === 'FLAT' && (
              <>
                <div className="mb-3 flex flex-wrap gap-2">
                  <label className="text-sm">
                    Area basis
                    <select className={`${inputClass} ml-2`} value={areaBasis} onChange={(e) => setAreaBasis(e.target.value as typeof areaBasis)}>
                      {AREA_BASES.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">
                    Rate is on
                    <select className={`${inputClass} ml-2`} value={rateBasis} onChange={(e) => setRateBasis(e.target.value as typeof rateBasis)}>
                      {AREA_BASES.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                </div>
                <RatedFields title="Unit" value={unit} onChange={setUnit} />
              </>
            )}
            {propertyClass === 'COMMERCIAL' && (
              <>
                <div className="mb-3 flex flex-wrap gap-2">
                  <label className="text-sm">Method
                    <select className={`${inputClass} ml-2`} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                      <option value="SALES">Sales comparison</option>
                      <option value="INCOME">Income (capitalise rent)</option>
                    </select>
                  </label>
                  <label className="text-sm">Area basis
                    <select className={`${inputClass} ml-2`} value={areaBasis} onChange={(e) => { setAreaBasis(e.target.value as typeof areaBasis); setRateBasis(e.target.value as typeof rateBasis) }}>
                      {AREA_BASES.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                </div>
                <RatedFields title={method === 'INCOME' ? 'Area (for reference) and comparable rate' : 'Area and rate'} value={unit} onChange={setUnit} />
                {method === 'INCOME' && (
                  <div className="mb-3 grid gap-2 sm:grid-cols-3">
                    {([['monthlyRent', 'Monthly rent ₹'], ['vacancyPercent', 'Vacancy %'], ['operatingExpensePercent', 'Operating expenses %'], ['capRatePercent', 'Capitalisation rate %']] as const).map(([key, label]) => (
                      <input key={key} className={inputClass} type="number" step="0.01" placeholder={label} aria-label={label} value={income[key]} onChange={(e) => setIncome({ ...income, [key]: e.target.value })} />
                    ))}
                    <input className={inputClass} placeholder="Rent source (lease, receipts…)" aria-label="Rent source" value={income.rentSource} onChange={(e) => setIncome({ ...income, rentSource: e.target.value })} />
                    <input className={inputClass} placeholder="Cap-rate source" aria-label="Cap-rate source" value={income.capRateSource} onChange={(e) => setIncome({ ...income, capRateSource: e.target.value })} />
                  </div>
                )}
              </>
            )}
            {['HOUSE', 'LAND', 'INDUSTRIAL'].includes(propertyClass) && <RatedFields title="Land" value={land} onChange={setLand} />}

            {propertyClass === 'MIXED_USE' && (
              <div className="mb-3">
                <input className={`${inputClass} mb-2 w-full`} placeholder="Sanctioned plan reference (number, date, authority)" aria-label="Sanctioned plan reference" value={planRef} onChange={(e) => setPlanRef(e.target.value)} />
                <p className="mb-1 text-sm font-semibold">Components (each use or phase, scaled to how much is built)</p>
                {components.map((c, i) => (
                  <div key={i} className="mb-2 flex flex-wrap gap-2">
                    <input className={`${inputClass} w-36`} placeholder="Label" aria-label="Component label" value={c.label} onChange={(e) => setComponents(patch(components, i, { ...c, label: e.target.value }))} />
                    <select className={inputClass} aria-label="Use" value={c.use} onChange={(e) => setComponents(patch(components, i, { ...c, use: e.target.value as ComponentForm['use'] }))}>{USES.map((u) => <option key={u}>{u}</option>)}</select>
                    <input className={`${inputClass} w-24`} type="number" step="0.01" placeholder="Area" aria-label="Component area" value={c.area} onChange={(e) => setComponents(patch(components, i, { ...c, area: e.target.value }))} />
                    <input className={`${inputClass} w-28`} type="number" step="0.01" placeholder="Rate" aria-label="Component rate" value={c.rate} onChange={(e) => setComponents(patch(components, i, { ...c, rate: e.target.value }))} />
                    <input className={`${inputClass} w-40`} placeholder="Rate source" aria-label="Component rate source" value={c.source} onChange={(e) => setComponents(patch(components, i, { ...c, source: e.target.value }))} />
                    <input className={`${inputClass} w-24`} type="number" placeholder="% built" aria-label="Completion percent" value={c.completion} onChange={(e) => setComponents(patch(components, i, { ...c, completion: e.target.value }))} />
                    <button type="button" className={ghostButtonClass} onClick={() => setComponents(components.filter((_, n) => n !== i))}>Remove</button>
                  </div>
                ))}
                <button type="button" className={ghostButtonClass} onClick={() => setComponents([...components, { ...emptyComponent }])}>Add component</button>
              </div>
            )}

            {propertyClass === 'INDUSTRIAL' && (
              <div className="mb-3">
                <label className="text-sm font-semibold">Are plant and machinery within this assignment&apos;s scope?
                  <select className={`${inputClass} ml-2`} value={scopePlant} onChange={(e) => setScopePlant(e.target.value as typeof scopePlant)}>
                    <option value="">Choose…</option><option value="yes">Yes — value them</option><option value="no">No — land and building only</option>
                  </select>
                </label>
                {scopePlant === 'yes' && (
                  <div className="mt-2">
                    {plant.map((p, i) => (
                      <div key={i} className="mb-2 flex flex-wrap gap-2">
                        <input className={`${inputClass} w-36`} placeholder="Item" aria-label="Plant item" value={p.item} onChange={(e) => setPlant(patch(plant, i, { ...p, item: e.target.value }))} />
                        <input className={`${inputClass} w-20`} type="number" aria-label="Plant quantity" value={p.quantity} onChange={(e) => setPlant(patch(plant, i, { ...p, quantity: e.target.value }))} />
                        <input className={`${inputClass} w-28`} type="number" step="0.01" placeholder="Unit cost" aria-label="Plant unit cost" value={p.unitCost} onChange={(e) => setPlant(patch(plant, i, { ...p, unitCost: e.target.value }))} />
                        <input className={`${inputClass} w-36`} placeholder="Source" aria-label="Plant source" value={p.source} onChange={(e) => setPlant(patch(plant, i, { ...p, source: e.target.value }))} />
                        <input className={`${inputClass} w-20`} type="number" placeholder="Age" aria-label="Plant age" value={p.age} onChange={(e) => setPlant(patch(plant, i, { ...p, age: e.target.value }))} />
                        <input className={`${inputClass} w-20`} type="number" placeholder="Life" aria-label="Plant life" value={p.life} onChange={(e) => setPlant(patch(plant, i, { ...p, life: e.target.value }))} />
                        <input className={`${inputClass} w-24`} type="number" placeholder="Resid. %" aria-label="Plant residual" value={p.residual} onChange={(e) => setPlant(patch(plant, i, { ...p, residual: e.target.value }))} />
                        <button type="button" className={ghostButtonClass} onClick={() => setPlant(plant.filter((_, n) => n !== i))}>Remove</button>
                      </div>
                    ))}
                    <button type="button" className={ghostButtonClass} onClick={() => setPlant([...plant, { ...emptyPlant }])}>Add plant item</button>
                  </div>
                )}
              </div>
            )}

            {(propertyClass === 'HOUSE' || propertyClass === 'INDUSTRIAL') && (
              <div className="mb-3">
                <p className="mb-1 text-sm font-semibold">Floors</p>
                {floors.map((floor, i) => (
                  <div key={i} className="mb-2 flex flex-wrap gap-2">
                    <input className={`${inputClass} w-36`} placeholder="Label" aria-label="Floor label" value={floor.label} onChange={(e) => setFloors(patch(floors, i, { ...floor, label: e.target.value }))} />
                    <input className={`${inputClass} w-28`} type="number" step="0.01" placeholder="Area" aria-label="Floor area" value={floor.area} onChange={(e) => setFloors(patch(floors, i, { ...floor, area: e.target.value }))} />
                    <input className={`${inputClass} w-28`} type="number" step="0.01" placeholder="Rate" aria-label="Construction rate" value={floor.rate} onChange={(e) => setFloors(patch(floors, i, { ...floor, rate: e.target.value }))} />
                    <input className={`${inputClass} w-40`} placeholder="Rate source" aria-label="Floor rate source" value={floor.source} onChange={(e) => setFloors(patch(floors, i, { ...floor, source: e.target.value }))} />
                    <input className={`${inputClass} w-20`} type="number" placeholder="Age" aria-label="Age years" value={floor.age} onChange={(e) => setFloors(patch(floors, i, { ...floor, age: e.target.value }))} />
                    <input className={`${inputClass} w-24`} type="number" placeholder="Life" aria-label="Useful life years" value={floor.life} onChange={(e) => setFloors(patch(floors, i, { ...floor, life: e.target.value }))} />
                    <input className={`${inputClass} w-24`} type="number" placeholder="Resid. %" aria-label="Residual percent" value={floor.residual} onChange={(e) => setFloors(patch(floors, i, { ...floor, residual: e.target.value }))} />
                    <button type="button" className={ghostButtonClass} onClick={() => setFloors(floors.filter((_, n) => n !== i))}>Remove</button>
                  </div>
                ))}
                <button type="button" className={ghostButtonClass} onClick={() => setFloors([...floors, { ...emptyFloor }])}>Add floor</button>
              </div>
            )}

            <div className="mb-3">
              <p className="mb-1 text-sm font-semibold">Adjustments (% of the value above)</p>
              {adjustments.map((a, i) => (
                <div key={i} className="mb-2 flex flex-wrap gap-2">
                  <input className={`${inputClass} w-40`} placeholder="Label" aria-label="Adjustment label" value={a.label} onChange={(e) => setAdjustments(patch(adjustments, i, { ...a, label: e.target.value }))} />
                  <input className={`${inputClass} w-24`} type="number" step="0.01" placeholder="%" aria-label="Adjustment percent" value={a.percent} onChange={(e) => setAdjustments(patch(adjustments, i, { ...a, percent: e.target.value }))} />
                  <input className={`${inputClass} min-w-64 flex-1`} placeholder="Reason" aria-label="Adjustment reason" value={a.reason} onChange={(e) => setAdjustments(patch(adjustments, i, { ...a, reason: e.target.value }))} />
                  <button type="button" className={ghostButtonClass} onClick={() => setAdjustments(adjustments.filter((_, n) => n !== i))}>Remove</button>
                </div>
              ))}
              <button type="button" className={ghostButtonClass} onClick={() => setAdjustments([...adjustments, { ...emptyAdjustment }])}>Add adjustment</button>
            </div>

            <div className="mb-3">
              <p className="mb-1 text-sm font-semibold">Additional items (only if not already in the base rate)</p>
              {extras.map((x, i) => (
                <div key={i} className="mb-2 flex flex-wrap gap-2">
                  <input className={`${inputClass} w-36`} placeholder="Item" aria-label="Item name" value={x.component} onChange={(e) => setExtras(patch(extras, i, { ...x, component: e.target.value }))} />
                  <input className={`${inputClass} w-20`} type="number" step="0.01" aria-label="Item quantity" value={x.quantity} onChange={(e) => setExtras(patch(extras, i, { ...x, quantity: e.target.value }))} />
                  <input className={`${inputClass} w-20`} aria-label="Item unit" value={x.unit} onChange={(e) => setExtras(patch(extras, i, { ...x, unit: e.target.value }))} />
                  <input className={`${inputClass} w-28`} type="number" step="0.01" placeholder="Rate" aria-label="Item rate" value={x.rate} onChange={(e) => setExtras(patch(extras, i, { ...x, rate: e.target.value }))} />
                  <select className={inputClass} aria-label="Item treatment" value={x.treatment} onChange={(e) => setExtras(patch(extras, i, { ...x, treatment: e.target.value as ExtraForm['treatment'] }))}>
                    {TREATMENTS.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ').toLowerCase()}</option>)}
                  </select>
                  <input className={`${inputClass} min-w-48 flex-1`} placeholder="Source (needed if separately valued)" aria-label="Item source" value={x.sourceNote} onChange={(e) => setExtras(patch(extras, i, { ...x, sourceNote: e.target.value }))} />
                  <button type="button" className={ghostButtonClass} onClick={() => setExtras(extras.filter((_, n) => n !== i))}>Remove</button>
                </div>
              ))}
              <button type="button" className={ghostButtonClass} onClick={() => setExtras([...extras, { ...emptyExtra }])}>Add item</button>
            </div>

            <input className={`${inputClass} mb-2 w-full`} placeholder="Why is this area adopted? (deed, plan, site measurement, resolved discrepancy…)" aria-label="Area source" value={areaSource} onChange={(e) => setAreaSource(e.target.value)} />
            <textarea className={`${inputClass} mb-2 w-full`} rows={2} placeholder="Assumptions and limitations (optional)" aria-label="Assumptions" value={assumptions} onChange={(e) => setAssumptions(e.target.value)} />
            {(versions.data?.length ?? 0) > 0 && (
              <input className={`${inputClass} mb-2 w-full`} placeholder="Reason for this revision (required)" aria-label="Change reason" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
            )}

            <div className="flex gap-2">
              <button type="button" className={buttonClass} onClick={() => void calculate()}>Calculate</button>
              <button type="button" className={ghostButtonClass} onClick={() => void saveDraft()}>Save as draft version</button>
            </div>

            {preview && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                {preview.warnings.map((w) => <p key={w} className="mb-2 text-sm text-amber-700">⚠ {w}</p>)}
                {preview.result.requiresReview.length > 0 && (
                  <p className="mb-2 text-sm text-amber-700">Needs a decision before review: {preview.result.requiresReview.join(', ')}</p>
                )}
                <LinesTable lines={preview.result.lines} />
                <p className="mt-2 text-right text-lg font-bold">Total ₹ {inr(preview.result.totalValue)}</p>
              </div>
            )}
          </Card>

          <Card title="Versions">
            {versions.data?.length === 0 && <p className="text-ink-soft">No valuation drafted yet.</p>}
            {versions.data?.map((version) => (
              <div key={version.id} className="mb-2">
                <Collapsible
                  title={
                    <span>
                      <span className="font-semibold">V{version.versionNumber}</span> · {version.status.replace('_', ' ')} · ₹ {inr(version.totalValue)}
                      <span className="ml-2 text-xs text-slate-500">{version.method} · engine {version.engineVersion}</span>
                    </span>
                  }
                  actions={
                    <>
                      {version.status === 'DRAFT' && <button type="button" className={ghostButtonClass} onClick={() => void move(version.id, 'submit-for-review')}>Send for review</button>}
                      {version.status === 'IN_REVIEW' && <button type="button" className={buttonClass} onClick={() => void move(version.id, 'approve')}>Approve</button>}
                    </>
                  }
                >
                  {version.changeReason && <p className="mb-2 text-sm">Revision reason: {version.changeReason}</p>}
                  <LinesTable lines={version.lineItems} />
                </Collapsible>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}
