import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.ts'
import { formatDate } from './ui.tsx'

interface Notice {
  id: string
  kind: 'ASSIGNED' | 'REASSIGNED'
  title: string
  body: string
  createdAt: string
  assignment: { id: string; code: string; purpose: string; dueDate: string; priority: string; intakeSource: string; bank: { name: string }; property: { addressLine: string } } | null
}

const SOURCE_LABELS: Record<string, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'Email', MOBILE_APP: 'Mobile app', DASHBOARD: 'Dashboard upload', MANUAL: 'Entered by hand' }
const POLL_MS = 30_000

// When the admin gives someone a case, it appears here as a pop-up the next time they open the
// app (or within half a minute if they are already in it). Opening or dismissing it is recorded
// as the valuer having seen the case, which the admin can see on the case.
export default function AssignmentPopup() {
  const [notices, setNotices] = useState<Notice[]>([])
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(() => {
    api.get<Notice[]>('/notifications/unread').then(setNotices).catch(() => { /* try again on the next poll */ })
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, POLL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const notice = notices[0]
  if (!notice) return null

  const done = async (open: boolean) => {
    setBusy(true)
    try {
      await api.post(`/notifications/${notice.id}/seen`, {})
      setNotices((current) => current.filter((n) => n.id !== notice.id))
      if (open && notice.assignment) navigate(`/assignments/${notice.assignment.id}`)
    } catch { /* it stays on screen and can be tried again */ } finally { setBusy(false) }
  }

  const c = notice.assignment
  return createPortal(
    <div className="pd-drawer-backdrop in-center">
      <div className="in-modal" role="alertdialog" aria-labelledby="assign-popup-title">
        <h3 id="assign-popup-title">{notice.title}</h3>
        {c ? (
          <dl className="assign-popup-facts">
            <div><dt>Case</dt><dd>{c.code}</dd></div>
            <div><dt>Bank</dt><dd>{c.bank.name}</dd></div>
            <div><dt>Purpose</dt><dd>{c.purpose}</dd></div>
            <div><dt>Property</dt><dd>{c.property.addressLine}</dd></div>
            <div><dt>Came from</dt><dd>{SOURCE_LABELS[c.intakeSource] ?? c.intakeSource}</dd></div>
            <div><dt>Due</dt><dd>{formatDate(c.dueDate)}{c.priority !== 'NORMAL' ? ` · ${c.priority.toLowerCase()} priority` : ''}</dd></div>
          </dl>
        ) : <p>{notice.body}</p>}
        <p>{notice.body.split('Assigned by')[1] ? `Assigned by${notice.body.split('Assigned by')[1]}` : ''}{notices.length > 1 ? ` · ${notices.length - 1} more waiting` : ''}</p>
        <div>
          <button type="button" className="pd-btn is-ghost" disabled={busy} onClick={() => void done(false)}>Got it</button>
          {c && <button type="button" className="pd-btn is-primary" disabled={busy} onClick={() => void done(true)}>Open case →</button>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
