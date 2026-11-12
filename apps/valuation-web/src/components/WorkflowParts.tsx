import { Link } from 'react-router-dom'
import {
  ASSIGNMENT_STATUS_LABELS,
  type AssignmentPriority, type AssignmentStatus, type IntakeSource, type PropertyClass,
} from '@value-hub/valuation-shared'
import type { ReactNode } from 'react'
import { formatDate } from './ui.tsx'

export interface AssignmentHead {
  id: string; code: string; purpose: string; fee?: string | null; dueDate: string; status: AssignmentStatus; priority: AssignmentPriority; borrowerName: string | null; intakeSource: IntakeSource
  bank: { name: string }; assignedValuer: { fullName: string }; plannedInspector?: { id: string; fullName: string } | null; property: { id: string; code: string; addressLine: string; propertyClass: PropertyClass }
}
export interface ReadinessItem { key: string; label: string; state: 'done' | 'todo' | 'warn'; detail: string; blocking: boolean }
export interface Readiness { items: ReadinessItem[]; done: number; total: number; canProceed: boolean; complete: boolean }

export const FLOW = ['Assignment intake', 'Property & documents', 'Site inspection', 'Valuation workings', 'Quality review', 'Approval & submission']
// Which workflow step an assignment's status puts the work on (0-based).
export const STEP_OF_STATUS: Record<AssignmentStatus, number> = { INTAKE: 1, DOCUMENTS: 1, INSPECTION: 2, VALUATION: 3, QUALITY_REVIEW: 4, APPROVED: 5, SUBMITTED: 5, REVISION: 3, CLOSED: 6, CANCELLED: 0 }
const MODULE_OF_STEP = ['/assignments', '/documents', '/inspections', '/valuation', '/reports', '/reports']

// Where each workflow step lives. Steps 2 and 3 have their own pages per assignment.
export function stepPath(index: number, id: string): string {
  if (index === 0) return `/assignments/${id}`
  if (index === 1) return `/assignments/${id}/documents`
  if (index === 2) return `/assignments/${id}/inspection`
  if (index === 3) return `/assignments/${id}/valuation`
  if (index === 4) return `/assignments/${id}/review`
  if (index === 5) return `/assignments/${id}/submission`
  return `${MODULE_OF_STEP[Math.min(index, 5)]}?assignment=${id}`
}

// What to do next on an assignment in each stage, and which workflow step it belongs to (0-based).
export const NEXT_ACTION: Record<AssignmentStatus, { label: string; step: number } | null> = {
  INTAKE: { label: 'Add property & documents', step: 1 },
  DOCUMENTS: { label: 'Verify the documents', step: 1 },
  INSPECTION: { label: 'Do the site inspection', step: 2 },
  VALUATION: { label: 'Work out the valuation', step: 3 },
  REVISION: { label: 'Revise the valuation', step: 3 },
  QUALITY_REVIEW: { label: 'Review & approve', step: 4 },
  APPROVED: { label: 'Issue & submit to the bank', step: 5 },
  SUBMITTED: { label: 'Track the bank’s response', step: 5 },
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

// The strip every case page opens with, as in the prototype: who and what the case is, where it stands, and who has it.
export function StepHeader({ a, title, subtitle }: { a: AssignmentHead; here?: number; eyebrow?: string; title?: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-border bg-white p-3.5 text-xs shadow-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to={`/assignments/${a.id}`} className="font-mono text-sm font-bold text-brand-navy hover:underline">{a.code}</Link>
        <span className="text-slate-300">|</span>
        <span className="font-semibold text-slate-800">{a.borrowerName ?? 'No borrower recorded'}</span>
        <span className="text-slate-300">|</span>
        <span className="text-slate-600">{a.bank.name}</span>
        <span className="text-slate-300">|</span>
        <span className="text-slate-600" title={a.property.addressLine}>{a.property.addressLine.length > 48 ? `${a.property.addressLine.slice(0, 48)}…` : a.property.addressLine}</span>
      </div>
      <div className="flex items-center space-x-3">
        {title && <span className="hidden text-[11px] font-semibold text-brand-navy lg:inline" title={subtitle}>{title}</span>}
        <span className="rounded border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{ASSIGNMENT_STATUS_LABELS[a.status]}</span>
        <span className="text-[11px] text-slate-500">Valuer: <strong className="text-slate-700">{a.assignedValuer.fullName}</strong></span>
        <span className="text-[11px] text-slate-500">Due: <strong className="text-slate-700">{formatDate(a.dueDate)}</strong></span>
      </div>
    </div>
  )
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

// The navy banner each ValuerPro module opens with: who is working, on which case, and how far along.
export function StageBanner({ icon, title, tag, line, aside, asideLabel, children }: { icon: string; title: string; tag?: string; line: string; aside?: string; asideLabel?: string; children?: React.ReactNode }) {
  return <div className="stage-banner">
    <div className="stage-banner-main"><span className="stage-banner-icon">{icon}</span>
      <div><div className="stage-banner-title"><h2>{title}</h2>{tag && <em>{tag}</em>}</div><p>{line}</p></div></div>
    <div className="stage-banner-right">{aside && <div className="stage-banner-aside"><small>{asideLabel}</small><b>{aside}</b></div>}{children}</div>
  </div>
}
