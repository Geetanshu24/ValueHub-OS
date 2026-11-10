import { Link } from 'react-router-dom'
import {
  type AssignmentPriority, type AssignmentStatus, type IntakeSource, type PropertyClass,
} from '@value-hub/valuation-shared'
import type { ReactNode } from 'react'

export interface AssignmentHead {
  id: string; code: string; purpose: string; fee?: string | null; dueDate: string; status: AssignmentStatus; priority: AssignmentPriority; borrowerName: string | null; intakeSource: IntakeSource
  bank: { name: string }; assignedValuer: { fullName: string }; assignedInspector?: { id: string; fullName: string } | null; property: { id: string; code: string; addressLine: string; propertyClass: PropertyClass }
}
export interface ReadinessItem { key: string; label: string; state: 'done' | 'todo' | 'warn'; detail: string; blocking: boolean }
export interface Readiness { items: ReadinessItem[]; done: number; total: number; canProceed: boolean; complete: boolean }

// Site inspection, valuation workings, quality review and submission are hidden for now; their pages and routes still exist.
export const FLOW = ['Assignment intake', 'Property & documents', 'Drafter workbench', 'Site inspection', 'Compare', 'Bank report', 'Check & send']
// Which workflow step an assignment's status puts the work on (0-based).
export const STEP_OF_STATUS: Record<AssignmentStatus, number> = { INTAKE: 1, DOCUMENTS: 1, INSPECTION: 2, VALUATION: 2, QUALITY_REVIEW: 2, APPROVED: 2, SUBMITTED: 2, REVISION: 2, CLOSED: 7, CANCELLED: 0 }
const MODULE_OF_STEP = ['/assignments', '/documents', '/reports', '/inspections', '/reports', '/reports', '/reports']

// Where each workflow step lives. Steps 2 and 3 have their own pages per assignment.
export function stepPath(index: number, id: string): string {
  if (index === 0) return `/assignments/${id}`
  if (index === 1) return `/assignments/${id}/documents`
  if (index === 2) return `/assignments/${id}/workbench`
  if (index === 3) return `/assignments/${id}/inspection`
  if (index === 4) return `/assignments/${id}/compare`
  if (index === 5) return `/assignments/${id}/bank-report`
  if (index >= 6) return `/assignments/${id}/check`
  return `${MODULE_OF_STEP[Math.min(index, 6)]}?assignment=${id}`
}

// What to do next on an assignment in each stage, and which workflow step it belongs to (0-based).
export const NEXT_ACTION: Record<AssignmentStatus, { label: string; step: number } | null> = {
  INTAKE: { label: 'Add property & documents', step: 1 },
  DOCUMENTS: { label: 'Verify the documents', step: 1 },
  INSPECTION: { label: 'Read the documents', step: 2 },
  VALUATION: { label: 'Read the documents', step: 2 },
  REVISION: { label: 'Read the documents', step: 2 },
  QUALITY_REVIEW: { label: 'Read the documents', step: 2 },
  APPROVED: { label: 'Read the documents', step: 2 },
  SUBMITTED: { label: 'Read the documents', step: 2 },
  CLOSED: null,
  CANCELLED: null,
}

export function nextActionFor(status: AssignmentStatus, id: string): { label: string; to: string } | null {
  const next = NEXT_ACTION[status]
  return next ? { label: next.label, to: stepPath(next.step, id) } : null
}

// "3 days overdue", "due today", "in 2 days".
export function dueLabel(due: string | Date, now = new Date()): { text: string; tone: 'late' | 'soon' | 'ok' } {
  const days = Math.round((new Date(new Date(due).toDateString()).getTime() - new Date(now.toDateString()).getTime()) / 86400000)
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} overdue`, tone: 'late' }
  if (days === 0) return { text: 'due today', tone: 'soon' }
  return { text: `in ${days} day${days === 1 ? '' : 's'}`, tone: days <= 2 ? 'soon' : 'ok' }
}

// The top of a step page: a way back to the case and the title. Where the case stands is on the case page.
export function StepHeader({ a, eyebrow, title, subtitle }: { a: AssignmentHead; here?: number; eyebrow: string; title: string; subtitle: string }) {
  return <>
    <div className="pd-topline"><Link to={`/assignments/${a.id}`} className="pd-back">← <span>Back to {a.code}</span></Link></div>
    <header className="pd-heading"><div><p className="pd-eyebrow">{eyebrow.replace(/^STEP \d+ · /, '')}</p><h1>{title}</h1><p>{subtitle}</p></div></header>
  </>
}

function Ring({ done, total }: { done: number; total: number }) {
  const r = 34; const c = 2 * Math.PI * r; const share = total ? done / total : 0
  return <svg viewBox="0 0 80 80" className="pd-ring" role="img" aria-label={`${done} of ${total} checks done`}><circle cx="40" cy="40" r={r} className="pd-ring-track" /><circle cx="40" cy="40" r={r} className="pd-ring-fill" strokeDasharray={`${c * share} ${c}`} transform="rotate(-90 40 40)" /><text x="40" y="38" textAnchor="middle" className="pd-ring-num">{done}/{total}</text><text x="40" y="52" textAnchor="middle" className="pd-ring-cap">ready</text></svg>
}

export function ReadyCard({ title, readiness, summary, children }: { title: string; readiness: Readiness | null; summary: string; children?: ReactNode }) {
  return <div className="pd-ready">
    <div className="pd-ready-head">{readiness ? <Ring done={readiness.done} total={readiness.total} /> : <span className="pd-ring-empty" />}<div><h3>{title}</h3><p>{readiness ? summary : 'Checking…'}</p></div></div>
    <ul className="pd-checks">{readiness?.items.map((item) => <li key={item.key} className={`is-${item.state}`}><span className="pd-check-dot">{item.state === 'done' ? '✓' : item.state === 'todo' ? '○' : '!'}</span><div><b>{item.label}</b><small>{item.detail}</small></div></li>)}</ul>
    {children}
  </div>
}
