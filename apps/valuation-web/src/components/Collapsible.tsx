import { useId, useState, type ReactNode } from 'react'

interface CollapsibleProps {
  title: ReactNode
  // Buttons that sit in the header without toggling it.
  actions?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

// An expandable card section. The header is a solid white bar that stays
// readable whatever is below it; the body opens and closes with a short,
// smooth height change (none if the user prefers reduced motion).
export default function Collapsible({ title, actions, defaultOpen = false, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 bg-white px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span aria-hidden="true" className={`inline-block text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}>
            ▸
          </span>
          <span className="min-w-0 flex-1">{title}</span>
        </button>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      <div
        id={bodyId}
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`border-t border-slate-100 px-3 py-3 transition-opacity duration-200 motion-reduce:transition-none ${open ? 'opacity-100' : 'opacity-0'}`} inert={!open}>
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}
