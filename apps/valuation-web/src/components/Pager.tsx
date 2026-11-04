interface PagerProps {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
}

export default function Pager({ page, pageSize, total, onChange }: PagerProps) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-ink-soft">
      <span>
        {total} record{total === 1 ? '' : 's'} · page {page} of {lastPage}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= lastPage}
          onClick={() => onChange(page + 1)}
          className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}
