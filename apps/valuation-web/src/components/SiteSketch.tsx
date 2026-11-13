import { useEffect, useState } from 'react'
import { fileBlobUrl } from '../lib/api.ts'

// The boundary sketch drawn from the site visit, as it will appear in the bank report.
// `version` changes when the site details are saved, so the picture is drawn again.
export default function SiteSketch({ assignmentId, version = 0, kind = 'sketch' }: { assignmentId: string; version?: string | number; kind?: 'sketch' | 'map' }) {
  const [src, setSrc] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading')
  useEffect(() => {
    let url: string | null = null; let cancelled = false
    setState('loading')
    fileBlobUrl(`/assignments/${assignmentId}/bank-report/${kind}.png`)
      .then((f) => { if (cancelled) URL.revokeObjectURL(f.url); else { url = f.url; setSrc(f.url); setState('ready') } })
      .catch(() => { if (!cancelled) { setSrc(null); setState('none') } })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [assignmentId, version, kind])
  if (state === 'loading') return <p className="pd-muted">Drawing…</p>
  if (state === 'none' || !src) return <p className="pd-muted">{kind === 'map' ? 'No map yet. It is drawn once the site visit (or the property) has coordinates.' : 'No sketch yet. It is drawn once the site visit has the boundaries (north, south, east, west) or the plot sizes.'}</p>
  return <img src={src} alt={kind === 'map' ? 'Location map of the property' : 'Boundary sketch of the property'} style={{ width: '100%', maxWidth: 760, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }} />
}
