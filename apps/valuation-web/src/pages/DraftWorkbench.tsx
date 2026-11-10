import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, factLabel, type DocumentType, type Paginated } from '@value-hub/valuation-shared'
import { ErrorText, errorMessage, PageHeader } from '../components/ui.tsx'
import { api, fileBlobUrl } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Assignment {
  id: string; code: string; purpose: string; borrowerName: string | null; clientPhone: string | null; receivedAt: string
  bank: { name: string }; branch: { name: string; city: string | null; district: string | null; state: string | null } | null
  property: { id: string; addressLine: string }
}
interface Doc { id: string; type: DocumentType; fileName: string; mimeType: string }
interface Fact { fieldKey: string; extractedValue: string; verifiedValue: string | null; state: 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED' | 'UNKNOWN'; useInReport: boolean; source?: string; unit?: string | null; pageNumber?: number; note?: string | null }
type Cell = { value: string; unit: string; page: string; note: string; showNote?: boolean; status: 'idle' | 'saving' | 'saved' | 'error' }
const UNITS = [['SQM', 'sq m'], ['SQYD', 'sq yd'], ['SQFT', 'sq ft']] as const
const isAreaKey = (key: string) => /_sqm$/.test(key)
const FACTOR: Record<string, number> = { SQM: 1, SQYD: 0.83612736, SQFT: 1 / 10.7639104 }
// The same value in square metres, so 200 sq yd and 167.23 sq m are not shown as a difference.
const normalised = (key: string, cell: { value: string; unit: string }) => { const v = cell.value.trim(); const n = Number(v.replace(/,/g, '')); return isAreaKey(key) && Number.isFinite(n) ? String(Number((n * (FACTOR[cell.unit] ?? 1)).toFixed(2))) : v.toLowerCase() }

// What the drafter reads off each document, in the order the bank formats ask for it.
const ROWS: { title: string; keys: { key: string; long?: boolean }[] }[] = [
  { title: 'Who and where', keys: [{ key: 'property_address', long: true }, { key: 'owner_name' }, { key: 'buyer_name' }, { key: 'seller_name' }, { key: 'plot_number' }, { key: 'registration_number' }, { key: 'document_date' }] },
  { title: 'Areas', keys: [{ key: 'plot_area_sqm' }, { key: 'built_up_area_sqm' }, { key: 'floor_area_sqm' }, { key: 'flat_area_sqm' }, { key: 'shop_area_sqm' }, { key: 'carpet_area_sqm' }, { key: 'dimensions' }] },
  { title: 'Boundaries (who or what is on each side, road width)', keys: [{ key: 'boundary_east', long: true }, { key: 'boundary_west', long: true }, { key: 'boundary_north', long: true }, { key: 'boundary_south', long: true }, { key: 'road_width' }] },
  { title: 'Construction', keys: [{ key: 'year_of_construction' }, { key: 'construction_details', long: true }, { key: 'floor_number' }, { key: 'total_floors' }, { key: 'accommodation', long: true }] },
]

const bestFact = (facts: Fact[], key: string) => [...facts].reverse().find((f) => f.fieldKey === key && f.state !== 'UNKNOWN')
const factValue = (f?: Fact) => (f ? (f.state === 'CORRECTED' ? f.verifiedValue ?? f.extractedValue : f.extractedValue) : '')

// The document on the right: images show directly, PDFs in the browser's viewer.
function Viewer({ doc }: { doc: Doc | undefined }) {
  const [src, setSrc] = useState<{ url: string; type: string } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    let made: string | null = null
    setSrc(null); setFailed(null)
    fileBlobUrl(`/documents/${doc.id}/file`)
      .then((f) => { if (cancelled) URL.revokeObjectURL(f.url); else { made = f.url; setSrc(f) } })
      .catch((c: unknown) => { if (!cancelled) setFailed(errorMessage(c)) })
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made) }
  }, [doc])
  if (!doc) return <div className="pd-empty"><b>No document</b><p>Upload the papers under Property &amp; documents first.</p></div>
  if (failed) return <div className="pd-empty"><b>Could not open the file</b><p>{failed}</p></div>
  if (!src) return <p className="pd-muted">Loading…</p>
  return src.type.startsWith('image/') ? <img className="wb-viewer-img" src={src.url} alt={doc.fileName} /> : <iframe className="wb-viewer-frame" src={src.url} title={doc.fileName} />
}

export default function DraftWorkbench() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canEdit = user?.role === 'FIRM_ADMIN' || user?.role === 'VALUER' || user?.role === 'DRAFTER'
  const assignment = useFetch<Assignment>(`/assignments/${id}`)
  const a = assignment.data
  const docs = useFetch<Paginated<Doc>>(a ? `/documents?propertyId=${a.property.id}&pageSize=100` : null)
  // Every file on the case can be read; a wrongly typed file is fixed right here.
  const sources = docs.data?.items ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const [cells, setCells] = useState<Record<string, Cell>>({})
  const [error, setError] = useState<string | null>(null)
  // Which document's value the report uses for each fact, when the documents disagree.
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const cellId = (docId: string, key: string) => `${docId}:${key}`

  const load = useCallback(async (list: Doc[]) => {
    const entries = await Promise.all(list.map(async (d) => [d.id, await api.get<Fact[]>(`/documents/${d.id}/fields`)] as const))
    const next: Record<string, Cell> = {}
    const picked: Record<string, string> = {}
    for (const [docId, facts] of entries) for (const f of facts) if (f.useInReport && f.state !== 'UNKNOWN') picked[f.fieldKey] = docId
    setChosen(picked)
    for (const [docId, facts] of entries) for (const row of ROWS) for (const { key } of row.keys) { const f = bestFact(facts, key); next[cellId(docId, key)] = { value: factValue(f), unit: f?.unit ?? 'SQM', page: f?.pageNumber && f.source !== 'OCR' ? String(f.pageNumber) : '', note: f?.note ?? '', status: 'idle' } }
    setCells(next)
  }, [])
  useEffect(() => {
    if (sources.length === 0) return
    load(sources).catch((c: unknown) => setError(errorMessage(c)))
    setSelected((current) => current ?? sources[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.data, load])

  const blank: Cell = { value: '', unit: 'SQM', page: '', note: '', status: 'idle' }
  const edit = (docId: string, key: string, patch: Partial<Cell>) => setCells((cur) => ({ ...cur, [cellId(docId, key)]: { ...(cur[cellId(docId, key)] ?? blank), ...patch, status: 'idle' } }))
  const save = async (docId: string, key: string) => {
    const cell = cells[cellId(docId, key)]
    if (!cell || cell.status === 'saving') return
    setCells((cur) => ({ ...cur, [cellId(docId, key)]: { ...cell, status: 'saving' } }))
    try {
      await api.put(`/documents/${docId}/fields/${key}`, { value: cell.value, ...(isAreaKey(key) && { unit: cell.unit }), ...(cell.page && { page: Number(cell.page) }), note: cell.note })
      setCells((cur) => ({ ...cur, [cellId(docId, key)]: { ...cell, status: 'saved' } }))
      setError(null)
    } catch (caught) {
      setCells((cur) => ({ ...cur, [cellId(docId, key)]: { ...cell, status: 'error' } }))
      setError(`${factLabel(key)}: ${errorMessage(caught)}`)
    }
  }

  // Same fact, different documents: the drafter says which one the report uses.
  const useValue = async (docId: string, key: string) => {
    try { await api.post(`/documents/${docId}/fields/${key}/use`, {}); setChosen((cur) => ({ ...cur, [key]: docId })); setError(null) }
    catch (caught) { setError(`${factLabel(key)}: ${errorMessage(caught)}`) }
  }
  const choice = (key: string) => {
    const filled = sources.map((d) => ({ d, value: (cells[cellId(d.id, key)]?.value ?? '').trim(), norm: normalised(key, cells[cellId(d.id, key)] ?? blank) })).filter((x) => x.value)
    const differs = new Set(filled.map((x) => x.norm)).size > 1
    const pickedDoc = filled.find((x) => x.d.id === chosen[key])?.d.id ?? filled[0]?.d.id
    return { filled, differs, pickedDoc }
  }

  if (assignment.error) return <ErrorText message={assignment.error} />
  if (!a) return <p className="pd-muted">Loading…</p>
  const viewing = sources.find((d) => d.id === selected) ?? sources[0]
  const filledIn = (docId: string) => ROWS.flatMap((g) => g.keys).filter(({ key }) => (cells[cellId(docId, key)]?.value ?? '').trim()).length
  const changeType = async (doc: Doc, type: DocumentType) => {
    try { await api.patch(`/documents/${doc.id}`, { type }); docs.reload(); setError(null) } catch (caught) { setError(errorMessage(caught)) }
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Drafter" title={`${a.code} · read the documents`} subtitle="Open a document and type what it says. Every box saves by itself."
        action={<Link to={`/assignments/${id}`} className="pd-btn is-ghost">Back to case</Link>} />
      <div className="wb-brief">
        <span><small>Client</small><b>{a.borrowerName ?? '—'}</b></span>
        <span><small>Phone</small><b>{a.clientPhone ?? '—'}</b></span>
        <span><small>Bank</small><b>{a.bank.name}{a.branch ? ` · ${[a.branch.name, a.branch.city, a.branch.district, a.branch.state].filter(Boolean).join(', ')}` : ''}</b></span>
        <span><small>Purpose</small><b>{a.purpose}</b></span>
      </div>
      <ErrorText message={error} />
      {sources.length === 0 ? <div className="pd-empty"><b>No documents on this case yet</b><p>Upload the deed, plans and other papers first.</p><Link to={`/assignments/${id}/documents`} className="pd-btn is-primary">Upload documents</Link></div> : <>
        <div className="wb-tabs" role="tablist" aria-label="Documents">
          {sources.map((d) => (
            <button key={d.id} type="button" role="tab" aria-selected={d.id === viewing?.id} className={`wb-tab ${d.id === viewing?.id ? 'is-on' : ''}`} onClick={() => setSelected(d.id)} title={d.fileName}>
              <b>{DOCUMENT_TYPE_LABELS[d.type]}</b><small>{d.fileName}</small><em>{filledIn(d.id) > 0 ? `${filledIn(d.id)} filled` : 'not started'}</em>
            </button>
          ))}
        </div>
        <div className="wb-split">
          <section className="wb-left">
            <div className="wb-typebar">
              <label>This document is a
                <select className="ui-input" value={viewing?.type} disabled={!canEdit} onChange={(e) => viewing && void changeType(viewing, e.target.value as DocumentType)}>
                  {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}
                </select>
              </label>
            </div>
            <div className="wb-scroll wb-form">
              {viewing && ROWS.map((group) => (
                <div key={group.title} className="wb-sec">
                  <h3>{group.title}</h3>
                  {group.keys.map(({ key, long }) => {
                    const cell = cells[cellId(viewing.id, key)] ?? blank
                    const pick = choice(key)
                    const props = { value: cell.value, disabled: !canEdit, onChange: (e: { target: { value: string } }) => edit(viewing.id, key, { value: e.target.value }), onBlur: () => void save(viewing.id, key) }
                    return (
                      <label key={key} className={`wb-field is-${cell.status}`}>
                        <span className="wb-labelrow">
                          <span>{factLabel(key).replace(/\s*\(sq\. ?m\)/i, '')}</span>
                          <span className="wb-meta">
                            p.<input type="number" min={1} className="wb-page" aria-label={`Page of ${factLabel(key)}`} placeholder="–" value={cell.page} disabled={!canEdit} onChange={(e) => edit(viewing.id, key, { page: e.target.value })} onBlur={() => void save(viewing.id, key)} />
                            {canEdit && <button type="button" className="chk-link" onClick={() => edit(viewing.id, key, { showNote: !cell.showNote })}>{cell.note ? 'note ✓' : '+ note'}</button>}
                          </span>
                        </span>
                        <span className="wb-inputrow">
                          {long ? <textarea rows={2} {...props} /> : <input {...props} />}
                          {isAreaKey(key) && <select className="wb-unit" aria-label={`Unit of ${factLabel(key)}`} value={cell.unit} disabled={!canEdit} onChange={(e) => { edit(viewing.id, key, { unit: e.target.value }); window.setTimeout(() => void save(viewing.id, key), 0) }}>{UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}</select>}
                        </span>
                        {(cell.showNote || cell.note) && <input className="wb-note" placeholder="Note (where exactly, or anything to remember)" value={cell.note} disabled={!canEdit} onChange={(e) => edit(viewing.id, key, { note: e.target.value })} onBlur={() => void save(viewing.id, key)} />}
                        {pick.differs && cell.value.trim() && (
                          <span className="wb-differ">
                            The documents say different things here. The report uses:
                            <select aria-label={`Value the report uses for ${factLabel(key)}`} value={pick.pickedDoc} disabled={!canEdit} onChange={(e) => void useValue(e.target.value, key)}>
                              {pick.filled.map((x) => <option key={x.d.id} value={x.d.id}>{DOCUMENT_TYPE_LABELS[x.d.type]}: {x.value.length > 40 ? `${x.value.slice(0, 40)}…` : x.value}</option>)}
                            </select>
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="wb-actions">
              <small className="pd-muted">Do the same for each document above. Leave a box empty if the document does not say.</small>
              <button type="button" className="pd-btn is-primary" onClick={() => navigate(`/assignments/${id}/compare`)}>Done →</button>
            </div>
          </section>
          <aside className="wb-right">
            <div className="wb-viewer-head"><b>{viewing ? DOCUMENT_TYPE_LABELS[viewing.type] : ''}</b><small>{viewing?.fileName}</small></div>
            <Viewer doc={viewing} />
          </aside>
        </div>
      </>}
    </div>
  )
}
