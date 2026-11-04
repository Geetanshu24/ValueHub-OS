import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, REVIEW_OUTCOMES, type DocumentType, type VerificationState } from '@value-hub/valuation-shared'
import { buttonClass, Card, ErrorText, errorMessage, ghostButtonClass, inputClass, PageHeader } from '../components/ui.tsx'
import { api, openFile, type Paginated } from '../lib/api.ts'
import { useFetch } from '../lib/useFetch.ts'

interface PropertyOption {
  id: string
  code: string
  addressLine: string
}
interface DocumentRow {
  id: string
  type: DocumentType
  fileName: string
  sizeBytes: number
  pageCount: number | null
  uploadedAt: string
}
interface FieldRow {
  id: string
  fieldKey: string
  extractedValue: string
  pageNumber: number
  state: VerificationState
  verifiedValue: string | null
  source: string
  confidence: string | null
}


function FieldsPanel({ documentId }: { documentId: string }) {
  const { data: fields, error, reload } = useFetch<FieldRow[]>(`/documents/${documentId}/fields`)
  const [actionError, setActionError] = useState<string | null>(null)
  const [fieldKey, setFieldKey] = useState('plot_area_sqm')
  const [value, setValue] = useState('')
  const [page, setPage] = useState('1')

  async function run(action: () => Promise<unknown>) {
    setActionError(null)
    try {
      await action()
      reload()
    } catch (caught) {
      setActionError(errorMessage(caught))
    }
  }

  function addField(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      await api.post(`/documents/${documentId}/fields`, { fieldKey, extractedValue: value, pageNumber: Number(page) })
      setValue('')
    })
  }

  function correct(field: FieldRow) {
    const verifiedValue = window.prompt(`Correct value for ${field.fieldKey}`, field.extractedValue)?.trim()
    if (verifiedValue) void run(() => api.patch(`/document-fields/${field.id}/review`, { outcome: 'CORRECTED', verifiedValue }))
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="mb-2 text-sm text-ink-soft">Extracted facts stay unverified until a reviewer confirms them.</p>
      <ErrorText message={error ?? actionError} />
      <table className="mb-3 w-full text-left text-sm">
        <tbody>
          {fields?.map((field) => (
            <tr key={field.id} className="border-b border-slate-100">
              <td className="py-1 font-semibold">{field.fieldKey}</td>
              <td className="py-1">
                {field.verifiedValue ?? field.extractedValue}
                {field.verifiedValue && <span className="ml-1 text-xs text-slate-400">(was {field.extractedValue})</span>}
              </td>
              <td className="py-1">p.{field.pageNumber}</td>
              <td className="py-1">{field.state}{field.source === 'OCR' && field.confidence !== null && <span className="ml-1 text-xs text-slate-400">read {Math.round(Number(field.confidence) * 100)}% sure</span>}</td>
              <td className="py-1 text-right">
                {REVIEW_OUTCOMES.map((outcome) => (
                  <button
                    key={outcome}
                    type="button"
                    className={`${ghostButtonClass} ml-1`}
                    onClick={() => (outcome === 'CORRECTED' ? correct(field) : void run(() => api.patch(`/document-fields/${field.id}/review`, { outcome })))}
                  >
                    {outcome.toLowerCase()}
                  </button>
                ))}
              </td>
            </tr>
          ))}
          {fields?.length === 0 && (
            <tr>
              <td className="py-2 text-ink-soft">No facts recorded yet.</td>
            </tr>
          )}
        </tbody>
      </table>
      <form onSubmit={addField} className="flex flex-wrap gap-2">
        <input className={inputClass} aria-label="Field key" value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} required />
        <input className={inputClass} aria-label="Value" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} required />
        <input className={`${inputClass} w-20`} aria-label="Page" type="number" min={1} value={page} onChange={(e) => setPage(e.target.value)} required />
        <button type="submit" className={buttonClass}>
          Add fact
        </button>
      </form>
    </div>
  )
}

export default function DocumentDesk() {
  const navigate = useNavigate()
  const assignmentList = useFetch<Paginated<{ id: string; code: string; property: { addressLine: string } }>>('/assignments?pageSize=100')
  const properties = useFetch<Paginated<PropertyOption>>('/properties?pageSize=100')
  const [propertyId, setPropertyId] = useState('')
  const docs = useFetch<Paginated<DocumentRow>>(propertyId ? `/documents?propertyId=${propertyId}&pageSize=100` : null)
  const [type, setType] = useState<DocumentType>('SALE_DEED')
  const [pageCount, setPageCount] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || !propertyId) return
    const formElement = event.currentTarget
    const form = new FormData()
    form.set('type', type)
    if (pageCount) form.set('pageCount', pageCount)
    form.set('file', file)
    setUploading(true)
    setError(null)
    try {
      await api.upload(`/properties/${propertyId}/documents`, form)
      setFile(null)
      formElement.reset()
      docs.reload()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <PageHeader eyebrow="RECORDS" title="Document Desk" subtitle="Upload originals, record what they say, and verify each fact." />

      <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm">
        <p className="mb-2 font-semibold">Working on an assignment?</p>
        <select className={`${inputClass} w-full sm:w-auto`} value="" aria-label="Open an assignment's Property & Documents step" onChange={(e) => e.target.value && navigate(`/assignments/${e.target.value}/documents`)}>
          <option value="">Open its Property &amp; Documents step…</option>
          {assignmentList.data?.items.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.property.addressLine}</option>)}
        </select>
        <p className="mt-2 text-xs text-ink-soft">This desk is the property-wide library. An assignment's own step also shows its checklist and readiness.</p>
      </div>

      <select className={`${inputClass} mb-4`} value={propertyId} onChange={(e) => setPropertyId(e.target.value)} aria-label="Property">
        <option value="">Select a property…</option>
        {properties.data?.items.map((property) => (
          <option key={property.id} value={property.id}>
            {property.code} — {property.addressLine}
          </option>
        ))}
      </select>
      <ErrorText message={properties.error ?? docs.error} />

      {propertyId && (
        <>
          <Card title="Upload document">
            <form onSubmit={upload} className="flex flex-wrap items-center gap-2">
              <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as DocumentType)} aria-label="Document type">
                {DOCUMENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {DOCUMENT_TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
              <input className={`${inputClass} w-28`} type="number" min={1} placeholder="Pages" value={pageCount} onChange={(e) => setPageCount(e.target.value)} />
              <input type="file" accept="application/pdf,image/jpeg,image/png" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button type="submit" className={buttonClass} disabled={uploading || !file}>
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </form>
            <ErrorText message={error} />
          </Card>

          <Card title="Documents">
            {docs.data?.items.length === 0 && <p className="text-ink-soft">No documents for this property yet.</p>}
            {docs.data?.items.map((doc) => (
              <div key={doc.id} className="border-b border-slate-100 py-2 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{doc.fileName}</p>
                    <p className="text-xs text-slate-500">
                      {DOCUMENT_TYPE_LABELS[doc.type]} · {(doc.sizeBytes / 1024).toFixed(0)} KB · {new Date(doc.uploadedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={ghostButtonClass} onClick={() => void openFile(`/documents/${doc.id}/file`).catch((c: unknown) => setError(errorMessage(c)))}>
                      Open
                    </button>
                    <button type="button" className={ghostButtonClass} onClick={() => void api.post<{ status: string; suggested: number; error: string | null }>(`/documents/${doc.id}/ocr`, {}).then((r) => { setError(r.status === 'DONE' ? null : `Read: ${r.status.toLowerCase().replace('_', ' ')}${r.error ? ` (${r.error})` : ''}`); setOpenId(doc.id); docs.reload() }).catch((c: unknown) => setError(errorMessage(c)))}>
                      Read text
                    </button>
                    <button type="button" className={ghostButtonClass} onClick={() => setOpenId(openId === doc.id ? null : doc.id)}>
                      Facts
                    </button>
                  </div>
                </div>
                {openId === doc.id && <FieldsPanel documentId={doc.id} />}
              </div>
            ))}
            {docs.data && <p className="mt-2 text-xs text-slate-500">{docs.data.total} document(s)</p>}
          </Card>
        </>
      )}
    </div>
  )
}
