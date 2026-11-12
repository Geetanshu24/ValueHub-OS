import { useState } from 'react'
import { Card } from './ui.tsx'
import { useFetch } from '../lib/useFetch.ts'

interface Item { id: string; action: string; entityType: string; at: string; by: string | null }

const WORDS: Record<string, string> = {
  'document.uploaded': 'Document uploaded', 'document.ocr': 'Document read', 'discrepancy.flagged': 'Difference between documents and site flagged', 'discrepancy.resolved': 'Difference settled by the valuer',
  'bank_report.saved': 'Bank report answers saved', 'bank_report.exported': 'Bank report downloaded', 'assignment.created': 'Assignment created', 'assignment.status_changed': 'Assignment moved to a new stage',
}
const label = (action: string) => WORDS[action] ?? action.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

// What was recorded about this assignment, newest first: who did what, and when.
export default function Timeline({ assignmentId }: { assignmentId: string }) {
  const data = useFetch<{ items: Item[] }>(`/assignments/${assignmentId}/timeline`)
  const [all, setAll] = useState(false)
  const items = data.data?.items ?? []
  return (
    <Card title="Audit trail">
      {data.error ? <p className="pd-muted">The trail could not be loaded.</p> : items.length === 0 ? <p className="pd-muted">Nothing recorded yet.</p> : (
        <>
          <ol className="tl-list">
            {(all ? items : items.slice(0, 8)).map((item) => (
              <li key={item.id}>
                <span className="tl-dot" />
                <div><b>{label(item.action)}</b><small>{item.by ?? 'System'} · {new Date(item.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></div>
              </li>
            ))}
          </ol>
          {items.length > 8 && <button type="button" className="cmp-link" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${items.length}`}</button>}
        </>
      )}
    </Card>
  )
}
