import type { ReactNode } from 'react'

// One look for every screen: these classes live in index.css next to the workflow pages' styles.
export const inputClass = 'ui-input'
export const buttonClass = 'pd-btn is-primary'
export const ghostButtonClass = 'pd-btn is-ghost'

export function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="ui-error">
      {message}
    </p>
  ) : null
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="pd-card mb-4">
      {title && <h2 className="ui-card-title">{title}</h2>}
      {children}
    </section>
  )
}

// The heading every screen opens with, matching the workflow pages.
export function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="pd-heading">
      <div>
        {eyebrow && <p className="pd-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold">{label}</span>
      {children}
    </label>
  )
}

export const errorMessage = (caught: unknown) => (caught instanceof Error ? caught.message : 'Something went wrong')
export const formatInr = (value: string | number) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })
export const formatDate = (value: string) => new Date(value).toLocaleDateString('en-IN')
