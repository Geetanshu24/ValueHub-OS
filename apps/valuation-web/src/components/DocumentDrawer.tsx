import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { DOCUMENT_TYPE_LABELS, FACT_LABELS, factLabel, type DocumentType, type VerificationState } from '@value-hub/valuation-shared'
import { api, fileBlobUrl, openFile } from '../lib/api.ts'
import { useFetch } from '../lib/useFetch.ts'
import { ErrorText, errorMessage } from './ui.tsx'

export interface DocFact {
  id: string
  documentId: string
  fieldKey: string
  extractedValue: string
  verifiedValue: string | null
  pageNumber: number
  confidence: string | null
  source: string
  state: VerificationState
}
interface DocDetail {
  id: string
  type: DocumentType
  fileName: string
  mimeType: string
  ocrStatus: 'NOT_RUN' | 'DONE' | 'NO_TEXT' | 'FAILED'
  ocrError: string | null
  ocrText: string | null
  pageCount: number | null
}

const stateLabel: Record<VerificationState, string> = { UNVERIFIED: 'To review', VERIFIED: 'Verified', CORRECTED: 'Corrected', UNKNOWN: 'Unknown' }

// A document next to its facts: look at the original, then verify, correct
// or mark unknown each fact that was read from it.
export default function DocumentDrawer({ documentId, canEdit, canReview, onClose, onChanged }: { documentId: string; canEdit: boolean; canReview: boolean; onClose: () => void; onChanged: () => void }) {
  const doc = useFetch<DocDetail>(`/documents/${documentId}`)
  const facts = useFetch<DocFact[]>(`/documents/${documentId}/fields`)
  const [preview, setPreview] = useState<{ url: string; type: string } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [tab, setTab] = useState<'facts' | 'text'>('facts')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  const [add, setAdd] = useState({ key: 'plot_area_sqm', custom: '', value: '', page: '1' })

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    setPreview(null); setPreviewError(null)
    fileBlobUrl(`/documents/${documentId}/file`)
      .then((file) => { if (cancelled) URL.revokeObjectURL(file.url); else { url = file.url; setPreview(file) } })
      .catch((caught: unknown) => { if (!cancelled) setPreviewError(errorMessage(caught)) })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [documentId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run(action: () => Promise<unknown>) {
    setError(null); setBusy(true)
    try { await action(); facts.reload(); doc.reload(); onChanged() } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }
  const review = (fact: DocFact, outcome: 'VERIFIED' | 'UNKNOWN') => run(() => api.patch(`/document-fields/${fact.id}/review`, { outcome }))
  const saveCorrection = (fact: DocFact) => run(async () => {
    if (!editing?.value.trim()) throw new Error('Enter the corrected value')
    await api.patch(`/document-fields/${fact.id}/review`, { outcome: 'CORRECTED', verifiedValue: editing.value.trim() })
    setEditing(null)
  })
  const addFact = (event: FormEvent) => {
    event.preventDefault()
    const fieldKey = add.key === '__custom' ? add.custom.trim().toLowerCase().replace(/\s+/g, '_') : add.key
    void run(async () => {
      await api.post(`/documents/${documentId}/fields`, { fieldKey, extractedValue: add.value.trim(), pageNumber: Number(add.page) })
      setAdd({ ...add, value: '' })
    })
  }
  const readText = () => run(async () => {
    const result = await api.post<{ status: string; error: string | null; suggested: number }>(`/documents/${documentId}/ocr`, {})
    if (result.status !== 'DONE') throw new Error(result.error ?? `Could not read this file (${result.status.toLowerCase().replace('_', ' ')})`)
  })

  const d = doc.data
  const pending = facts.data?.filter((fact) => fact.state === 'UNVERIFIED').length ?? 0
  // Rendered on the body so a transformed page container cannot clip the fixed panel.
  return createPortal(<div className="pd-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="pd-drawer" role="dialog" aria-label="Document review">
      <header className="pd-drawer-head">
        <div><span className="pd-pill is-type">{d ? DOCUMENT_TYPE_LABELS[d.type] : 'Document'}</span><h2>{d?.fileName ?? 'Loading…'}</h2></div>
        <div className="pd-drawer-tools"><button type="button" className="pd-btn is-ghost" onClick={() => void openFile(`/documents/${documentId}/file`).catch((c: unknown) => setError(errorMessage(c)))}>Open original ↗</button><button type="button" className="pd-icon-btn" aria-label="Close" onClick={onClose}>×</button></div>
      </header>
      <div className="pd-drawer-body">
        <section className="pd-preview">{previewError ? <p className="pd-muted">{previewError}</p> : !preview ? <p className="pd-muted">Loading preview…</p> : preview.type.startsWith('image/') ? <img src={preview.url} alt={d?.fileName ?? 'Document'} /> : <iframe title={d?.fileName ?? 'Document'} src={preview.url} />}</section>
        <section className="pd-review">
          <div className="pd-tabs" role="tablist"><button role="tab" aria-selected={tab === 'facts'} className={tab === 'facts' ? 'is-on' : ''} onClick={() => setTab('facts')}>Facts{pending > 0 && <em>{pending}</em>}</button><button role="tab" aria-selected={tab === 'text'} className={tab === 'text' ? 'is-on' : ''} onClick={() => setTab('text')}>Text read</button></div>
          <ErrorText message={error ?? facts.error ?? doc.error} />
          {tab === 'facts' ? <>
            <p className="pd-hint">Facts read from a file are suggestions. They count only after a person verifies or corrects them.</p>
            <div className="pd-fact-list">
              {facts.data?.map((fact) => <article key={fact.id} className={`pd-fact is-${fact.state.toLowerCase()}`}>
                <div className="pd-fact-main"><b>{factLabel(fact.fieldKey)}</b><span className="pd-fact-value">{fact.verifiedValue ?? fact.extractedValue}</span>{fact.verifiedValue && <small>read as “{fact.extractedValue}”</small>}<small>Page {fact.pageNumber}{fact.source === 'OCR' && fact.confidence !== null ? ` · read ${Math.round(Number(fact.confidence) * 100)}% sure` : fact.source === 'MANUAL' ? ' · typed in' : ''}</small></div>
                <span className={`pd-pill is-${fact.state.toLowerCase()}`}>{stateLabel[fact.state]}</span>
                {canReview && (editing?.id === fact.id
                  ? <div className="pd-fact-edit"><input autoFocus value={editing.value} onChange={(e) => setEditing({ id: fact.id, value: e.target.value })} aria-label="Corrected value" /><button className="pd-btn" disabled={busy} onClick={() => void saveCorrection(fact)}>Save</button><button className="pd-btn is-ghost" onClick={() => setEditing(null)}>Cancel</button></div>
                  : <div className="pd-fact-actions"><button className="pd-btn is-ok" disabled={busy || fact.state === 'VERIFIED'} onClick={() => void review(fact, 'VERIFIED')}>✓ Verify</button><button className="pd-btn is-ghost" disabled={busy} onClick={() => setEditing({ id: fact.id, value: fact.verifiedValue ?? fact.extractedValue })}>Correct</button><button className="pd-btn is-ghost" disabled={busy || fact.state === 'UNKNOWN'} onClick={() => void review(fact, 'UNKNOWN')}>Unknown</button></div>)}
              </article>)}
              {facts.data?.length === 0 && <div className="pd-empty"><b>No facts recorded yet</b><p>Read the text of this file to get suggestions, or add a fact by hand below.</p></div>}
            </div>
            {canEdit && <div className="pd-actions-row"><button className="pd-btn" disabled={busy} onClick={() => void readText()}>{busy ? 'Working…' : d?.ocrStatus === 'DONE' ? 'Read again' : 'Read text from file'}</button>{d?.ocrStatus === 'NO_TEXT' && <span className="pd-muted">No readable text found. Add facts by hand.</span>}</div>}
            {canEdit && <form className="pd-add-fact" onSubmit={addFact}>
              <h4>Add a fact from this document</h4>
              <div><select value={add.key} onChange={(e) => setAdd({ ...add, key: e.target.value })} aria-label="Fact">{Object.entries(FACT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="__custom">Other…</option></select>{add.key === '__custom' && <input placeholder="e.g. mortgage_status" value={add.custom} onChange={(e) => setAdd({ ...add, custom: e.target.value })} required />}<input placeholder="Value" value={add.value} onChange={(e) => setAdd({ ...add, value: e.target.value })} required aria-label="Value" /><input className="is-narrow" type="number" min={1} value={add.page} onChange={(e) => setAdd({ ...add, page: e.target.value })} aria-label="Page" required /><button className="pd-btn" disabled={busy}>Add</button></div>
            </form>}
          </> : <div className="pd-text">{d?.ocrText ? d.ocrText.split('\f').map((page, index) => <section key={index}><h5>Page {index + 1}</h5><pre>{page || '(blank)'}</pre></section>) : <div className="pd-empty"><b>No text read yet</b><p>{d?.ocrError ?? 'Use “Read text from file” on the Facts tab.'}</p></div>}</div>}
        </section>
      </div>
    </aside>
  </div>, document.body)
}
