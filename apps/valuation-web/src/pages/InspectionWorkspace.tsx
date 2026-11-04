import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { AREA_FIELD_KEYS, DISCREPANCY_RESOLUTIONS, type DiscrepancyStatus, type InspectionStatus } from '@value-hub/valuation-shared'
import { buttonClass, Card, ErrorText, errorMessage, ghostButtonClass, inputClass, PageHeader } from '../components/ui.tsx'
import { api, openFile, type Paginated } from '../lib/api.ts'
import InspectionCalendar from '../components/InspectionCalendar.tsx'
import { useAssignmentParam } from '../lib/useAssignmentParam.ts'
import { useFetch } from '../lib/useFetch.ts'

interface AssignmentOption {
  id: string
  code: string
  property: { addressLine: string }
}
interface Staff {
  id: string
  fullName: string
  role: string
}
interface Measurement {
  id: string
  label: string
  fieldKey: string | null
  areaSqm: string
  method: string
}
interface Inspection {
  id: string
  visitedAt: string
  status: InspectionStatus
  inspector: { fullName: string }
  measurements: Measurement[]
  photos: { id: string; caption: string | null; captionConfirmed: boolean }[]
}
interface Discrepancy {
  id: string
  description: string
  sourceA: string
  sourceB: string
  status: DiscrepancyStatus
  resolutionNote: string | null
}

const isLocked = (status: InspectionStatus) => status === 'SUBMITTED' || status === 'REVIEWED'

function Photos({ inspection, locked, onChange, onError }: { inspection: Inspection; locked: boolean; onChange: () => void; onError: (m: string) => void }) {
  const [caption, setCaption] = useState('')

  async function upload(file: File | undefined) {
    if (!file) return
    const form = new FormData()
    form.set('file', file)
    if (caption) form.set('caption', caption)
    try {
      await api.upload(`/inspections/${inspection.id}/photos`, form)
      setCaption('')
      onChange()
    } catch (caught) {
      onError(errorMessage(caught))
    }
  }

  async function confirm(photo: { id: string; caption: string | null }) {
    const next = window.prompt('Confirm or edit the caption', photo.caption ?? '')
    if (next === null) return
    try {
      await api.patch(`/inspection-photos/${photo.id}`, { caption: next, captionConfirmed: true })
      onChange()
    } catch (caught) {
      onError(errorMessage(caught))
    }
  }

  return (
    <div className="mt-3">
      <p className="mb-1 text-sm font-semibold">Photos</p>
      {inspection.photos.map((photo) => (
        <div key={photo.id} className="flex items-center justify-between border-t border-slate-100 py-1 text-sm">
          <span>{photo.caption ?? '(no caption)'} {photo.captionConfirmed ? '✓' : <span className="text-amber-700">unconfirmed</span>}</span>
          <span className="flex gap-2">
            <button type="button" className={ghostButtonClass} onClick={() => void openFile(`/inspection-photos/${photo.id}/file`).catch((c: unknown) => onError(errorMessage(c)))}>View</button>
            {!locked && <button type="button" className={ghostButtonClass} onClick={() => void confirm(photo)}>Confirm caption</button>}
          </span>
        </div>
      ))}
      {!locked && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input className={inputClass} placeholder="Caption" aria-label="Photo caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Photo file" onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
      )}
    </div>
  )
}

function MeasurementForm({ inspectionId, onDone, onError }: { inspectionId: string; onDone: () => void; onError: (m: string) => void }) {
  const [label, setLabel] = useState('Plot')
  const [fieldKey, setFieldKey] = useState('plot_area_sqm')
  const [area, setArea] = useState('')
  const [method, setMethod] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await api.post(`/inspections/${inspectionId}/measurements`, {
        label,
        areaSqm: Number(area),
        method,
        ...(fieldKey && { fieldKey }),
      })
      setArea('')
      onDone()
    } catch (caught) {
      onError(errorMessage(caught))
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
      <input className={`${inputClass} w-32`} aria-label="Label" value={label} onChange={(e) => setLabel(e.target.value)} required />
      <select className={inputClass} aria-label="Documented fact" value={fieldKey} onChange={(e) => setFieldKey(e.target.value)}>
        <option value="">Not compared</option>
        {AREA_FIELD_KEYS.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
      <input className={`${inputClass} w-28`} aria-label="Area sq m" type="number" step="0.01" min="0.01" placeholder="Sq. m" value={area} onChange={(e) => setArea(e.target.value)} required />
      <input className={inputClass} aria-label="Method" placeholder="Method (tape, laser…)" value={method} onChange={(e) => setMethod(e.target.value)} required minLength={2} />
      <button type="submit" className={buttonClass}>
        Add measurement
      </button>
    </form>
  )
}

export default function InspectionWorkspace() {
  const assignments = useFetch<Paginated<AssignmentOption>>('/assignments?pageSize=100')
  const staff = useFetch<Staff[]>('/users/staff')
  const [assignmentId, setAssignmentId] = useAssignmentParam()
  const inspections = useFetch<Inspection[]>(assignmentId ? `/assignments/${assignmentId}/inspections` : null)
  const discrepancies = useFetch<Discrepancy[]>(assignmentId ? `/assignments/${assignmentId}/discrepancies` : null)
  const [inspectorId, setInspectorId] = useState('')
  const [visitedAt, setVisitedAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [view, setView] = useState<'visits' | 'calendar'>('visits')

  // One assignment's visits live on its own Site Inspection page; this screen keeps the firm-wide calendar.
  if (assignmentId) return <Navigate to={`/assignments/${assignmentId}/inspection`} replace />

  const reloadAll = () => {
    inspections.reload()
    discrepancies.reload()
  }

  async function act(action: () => Promise<unknown>) {
    setError(null)
    setNotice(null)
    try {
      await action()
      reloadAll()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  function schedule(event: FormEvent) {
    event.preventDefault()
    void act(() => api.post(`/assignments/${assignmentId}/inspections`, { inspectorId, visitedAt: new Date(visitedAt).toISOString() }))
  }

  function submitInspection(id: string) {
    void act(async () => {
      const result = await api.post<{ discrepanciesFlagged: number }>(`/inspections/${id}/submit`, {})
      setNotice(
        result.discrepanciesFlagged > 0
          ? `Submitted. ${result.discrepanciesFlagged} area discrepancy flagged — review below.`
          : 'Submitted. No area discrepancies found.',
      )
    })
  }

  function resolve(id: string, outcome: (typeof DISCREPANCY_RESOLUTIONS)[number]) {
    const resolutionNote = window.prompt(`Record the basis for marking this ${outcome.toLowerCase()} (min 10 characters)`)?.trim()
    if (resolutionNote) void act(() => api.patch(`/discrepancies/${id}/resolve`, { outcome, resolutionNote }))
  }

  return (
    <div>
      <PageHeader eyebrow="RECORDS" title="Inspection Workspace" subtitle="Record site measurements. Differences from documents are flagged, never overwritten." />

      <div className="mb-3 flex gap-2">
        <button type="button" className={view === 'visits' ? buttonClass : ghostButtonClass} onClick={() => setView('visits')}>Visits</button>
        <button type="button" className={view === 'calendar' ? buttonClass : ghostButtonClass} onClick={() => setView('calendar')}>Calendar</button>
      </div>
      {view === 'calendar' && <InspectionCalendar />}
      {view === 'visits' && (
      <>
      <select className={`${inputClass} mb-4`} value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)} aria-label="Assignment">
        <option value="">Select an assignment…</option>
        {assignments.data?.items.map((assignment) => (
          <option key={assignment.id} value={assignment.id}>
            {assignment.code} — {assignment.property.addressLine}
          </option>
        ))}
      </select>
      <ErrorText message={error ?? assignments.error ?? inspections.error ?? discrepancies.error} />
      {notice && <p role="status" className="mb-3 text-sm text-brand-700">{notice}</p>}

      {assignmentId && (
        <>
          <Card title="Schedule a visit">
            <form onSubmit={schedule} className="flex flex-wrap gap-2">
              <select className={inputClass} value={inspectorId} onChange={(e) => setInspectorId(e.target.value)} required aria-label="Inspector">
                <option value="">Inspector…</option>
                {staff.data
                  ?.filter((person) => person.role === 'INSPECTOR' || person.role === 'VALUER')
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
              </select>
              <input className={inputClass} type="datetime-local" value={visitedAt} onChange={(e) => setVisitedAt(e.target.value)} required aria-label="Visit time" />
              <button type="submit" className={buttonClass}>
                Schedule
              </button>
            </form>
          </Card>

          {inspections.data?.map((inspection) => (
            <Card key={inspection.id} title={`Visit ${new Date(inspection.visitedAt).toLocaleString()}`}>
              <p className="text-sm text-ink-soft">
                {inspection.inspector.fullName} · {inspection.status} · {inspection.photos.length} photo(s)
              </p>
              <table className="mt-2 w-full text-left text-sm">
                <tbody>
                  {inspection.measurements.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100">
                      <td className="py-1 font-semibold">{m.label}</td>
                      <td className="py-1">{m.areaSqm} sq. m</td>
                      <td className="py-1">{m.method}</td>
                      <td className="py-1 text-slate-500">{m.fieldKey ?? 'not compared'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Photos inspection={inspection} locked={isLocked(inspection.status)} onChange={reloadAll} onError={setError} />
              {!isLocked(inspection.status) && (
                <>
                  <MeasurementForm inspectionId={inspection.id} onDone={reloadAll} onError={setError} />
                  <button type="button" className={`${buttonClass} mt-3`} onClick={() => submitInspection(inspection.id)}>
                    Submit inspection
                  </button>
                </>
              )}
              {inspection.status === 'SUBMITTED' && (
                <button type="button" className={`${ghostButtonClass} mt-3`} onClick={() => void act(() => api.post(`/inspections/${inspection.id}/review`, {}))}>
                  Mark field-reviewed
                </button>
              )}
            </Card>
          ))}
          {inspections.data?.length === 0 && <p className="mb-4 text-ink-soft">No visits scheduled yet.</p>}

          <Card title="Discrepancies">
            {discrepancies.data?.length === 0 && <p className="text-ink-soft">None recorded.</p>}
            {discrepancies.data?.map((item) => (
              <div key={item.id} className="border-b border-slate-100 py-2 last:border-0">
                <p className="font-semibold">
                  {item.description} <span className="ml-2 text-xs text-slate-500">{item.status}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {item.sourceA} ↔ {item.sourceB}
                </p>
                {item.resolutionNote && <p className="mt-1 text-sm">Note: {item.resolutionNote}</p>}
                {(item.status === 'UNRESOLVED' || item.status === 'ESCALATED') && (
                  <div className="mt-2 flex gap-2">
                    {DISCREPANCY_RESOLUTIONS.map((outcome) => (
                      <button key={outcome} type="button" className={ghostButtonClass} onClick={() => resolve(item.id, outcome)}>
                        {outcome.toLowerCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Card>
        </>
      )}
      </>
      )}
    </div>
  )
}
