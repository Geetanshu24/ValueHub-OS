import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DOCUMENT_TYPE_LABELS, factLabel, type DocumentType, type Paginated } from '@value-hub/valuation-shared'
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
interface Fact { fieldKey: string; extractedValue: string; verifiedValue: string | null; state: 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED' | 'UNKNOWN'; useInReport: boolean }
type Cell = { value: string; status: 'idle' | 'saving' | 'saved' | 'error' }

// What the drafter reads off each document, in the order the bank formats ask for it.
const ROWS: { title: string; keys: { key: string; long?: boolean }[] }[] = [
  { title: 'Who and where', keys: [{ key: 'property_address', long: true }, { key: 'owner_name' }, { key: 'buyer_name' }, { key: 'seller_name' }, { key: 'plot_number' }, { key: 'registration_number' }, { key: 'document_date' }] },
  { title: 'Areas', keys: [{ key: 'plot_area_sqm' }, { key: 'built_up_area_sqm' }, { key: 'floor_area_sqm' }, { key: 'flat_area_sqm' }, { key: 'shop_area_sqm' }, { key: 'carpet_area_sqm' }, { key: 'dimensions' }] },
  { title: 'Boundaries (who or what is on each side, road width)', keys: [{ key: 'boundary_east', long: true }, { key: 'boundary_west', long: true }, { key: 'boundary_north', long: true }, { key: 'boundary_south', long: true }, { key: 'road_width' }] },
  { title: 'Construction', keys: [{ key: 'year_of_construction' }, { key: 'construction_details', long: true }, { key: 'floor_number' }, { key: 'total_floors' }, { key: 'accommodation', long: true }] },
]

const bestValue = (facts: Fact[], key: string) => {
  const hit = [...facts].reverse().find((f) => f.fieldKey === key && f.state !== 'UNKNOWN')
  return hit ? (hit.state === 'CORRECTED' ? hit.verifiedValue ?? hit.extractedValue : hit.extractedValue) : ''
}

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
  // The instruction letter is the brief, not a source of facts.
  const sources = (docs.data?.items ?? []).filter((d) => d.type !== 'BANK_INSTRUCTION')
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
    for (const [docId, facts] of entries) for (const row of ROWS) for (const { key } of row.keys) next[cellId(docId, key)] = { value: bestValue(facts, key), status: 'idle' }
    setCells(next)
  }, [])
  useEffect(() => {
    if (sources.length === 0) return
    load(sources).catch((c: unknown) => setError(errorMessage(c)))
    setSelected((current) => current ?? sources[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.data, load])

  const edit = (docId: string, key: string, value: string) => setCells((cur) => ({ ...cur, [cellId(docId, key)]: { value, status: 'idle' } }))
  const save = async (docId: string, key: string) => {
    const cell = cells[cellId(docId, key)]
    if (!cell || cell.status === 'saving') return
    setCells((cur) => ({ ...cur, [cellId(docId, key)]: { ...cell, status: 'saving' } }))
    try {
      await api.put(`/documents/${docId}/fields/${key}`, { value: cell.value })
      setCells((cur) => ({ ...cur, [cellId(docId, key)]: { value: cell.value, status: 'saved' } }))
      setError(null)
    } catch (caught) {
      setCells((cur) => ({ ...cur, [cellId(docId, key)]: { value: cell.value, status: 'error' } }))
      setError(`${factLabel(key)}: ${errorMessage(caught)}`)
    }
  }

  // Same fact, different documents: the drafter says which one the report uses.
  const useValue = async (docId: string, key: string) => {
    try { await api.post(`/documents/${docId}/fields/${key}/use`, {}); setChosen((cur) => ({ ...cur, [key]: docId })); setError(null) }
    catch (caught) { setError(`${factLabel(key)}: ${errorMessage(caught)}`) }
  }
  const choice = (key: string) => {
    const filled = sources.map((d) => ({ d, value: (cells[cellId(d.id, key)]?.value ?? '').trim() })).filter((x) => x.value)
    const differs = new Set(filled.map((x) => x.value.toLowerCase())).size > 1
    const pickedDoc = filled.find((x) => x.d.id === chosen[key])?.d.id ?? filled[0]?.d.id
    return { filled, differs, pickedDoc }
  }

  if (assignment.error) return <ErrorText message={assignment.error} />
  if (!a) return <p className="pd-muted">Loading…</p>
  const viewing = sources.find((d) => d.id === selected) ?? sources[0]

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Drafter workbench" title={`${a.code} · read the documents`} subtitle="Left: what each document says. Right: the document. Type what you read; every box saves when you leave it."
        action={<Link to={`/assignments/${id}`} className="pd-btn is-ghost">Back to case</Link>} />
      <div className="wb-brief">
        <span><small>Client</small><b>{a.borrowerName ?? '—'}</b></span>
        <span><small>Phone</small><b>{a.clientPhone ?? '—'}</b></span>
        <span><small>Bank</small><b>{a.bank.name}{a.branch ? ` · ${[a.branch.name, a.branch.city, a.branch.district, a.branch.state].filter(Boolean).join(', ')}` : ''}</b></span>
        <span><small>Purpose</small><b>{a.purpose}</b></span>
        <span><small>Logged in</small><b>{new Date(a.receivedAt).toLocaleDateString('en-IN')}</b></span>
      </div>
      <ErrorText message={error} />
      {sources.length === 0 ? <div className="pd-empty"><b>No documents to read yet</b><p>Upload the deed, plans and other papers under Property &amp; documents.</p><Link to={`/assignments/${id}/documents`} className="pd-btn is-primary">Go to documents</Link></div> : (
        <div className="wb-split">
          <section className="wb-left">
            <div className="wb-scroll">
              <table className="wb-table">
                <thead>
                  <tr>
                    <th>Fact</th>
                    {sources.map((d) => <th key={d.id} className={d.id === viewing?.id ? 'is-on' : ''}><button type="button" onClick={() => setSelected(d.id)} title={d.fileName}>{DOCUMENT_TYPE_LABELS[d.type]}<small>{d.fileName}</small></button></th>)}
                    <th className="wb-uses-head"><span>Report uses</span><small>for the bank format</small></th>
                  </tr>
                </thead>
                {ROWS.map((group) => (
                  <tbody key={group.title}>
                    <tr className="wb-group"><td colSpan={sources.length + 2}>{group.title}</td></tr>
                    {group.keys.map(({ key, long }) => {
                      const pick = choice(key)
                      return (
                      <tr key={key} className={pick.differs ? 'is-differs' : ''}>
                        <th scope="row">{factLabel(key)}</th>
                        {sources.map((d) => {
                          const cell = cells[cellId(d.id, key)] ?? { value: '', status: 'idle' }
                          const props = { value: cell.value, disabled: !canEdit, onFocus: () => setSelected(d.id), onChange: (e: { target: { value: string } }) => edit(d.id, key, e.target.value), onBlur: () => void save(d.id, key), 'aria-label': `${factLabel(key)}, ${DOCUMENT_TYPE_LABELS[d.type]}` }
                          return <td key={d.id} className={`is-${cell.status}`}>{long ? <textarea rows={2} {...props} /> : <input {...props} />}</td>
                        })}
                        <td className="wb-uses">
                          {pick.filled.length === 0 ? <span className="pd-muted">—</span>
                            : !pick.differs ? <span title="All documents agree">{pick.filled[0].value}</span>
                            : <><b className="wb-differs">Documents differ</b>
                              <select aria-label={`Value the report uses for ${factLabel(key)}`} value={pick.pickedDoc} disabled={!canEdit} onChange={(e) => void useValue(e.target.value, key)}>
                                {pick.filled.map((x) => <option key={x.d.id} value={x.d.id}>{DOCUMENT_TYPE_LABELS[x.d.type]}: {x.value.length > 40 ? `${x.value.slice(0, 40)}…` : x.value}</option>)}
                              </select></>}
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                ))}
              </table>
            </div>
            <div className="wb-actions">
              <small className="pd-muted">Same fact in several documents? Fill each column. Differences are checked later.</small>
              <button type="button" className="pd-btn is-primary" onClick={() => navigate(`/assignments/${id}/compare`)}>Done — compare with the site →</button>
            </div>
          </section>
          <aside className="wb-right">
            <div className="wb-viewer-head"><b>{viewing ? DOCUMENT_TYPE_LABELS[viewing.type] : ''}</b><small>{viewing?.fileName}</small></div>
            <Viewer doc={viewing} />
          </aside>
        </div>
      )}
    </div>
  )
}
