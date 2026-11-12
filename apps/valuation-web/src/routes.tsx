// The eleven screens from the blueprint (section 11). `phase` is when each
// is built; screens not yet built render a placeholder.
export interface ScreenRoute {
  path: string
  label: string
  phase: 1 | 2 | 3
  built: boolean
}

export const SCREENS: ScreenRoute[] = [
  { path: '/', label: 'Command Centre', phase: 1, built: true },
  { path: '/assignments', label: 'Assignment Inbox', phase: 1, built: true },
  { path: '/properties', label: 'Property Identity', phase: 1, built: true },
  { path: '/documents', label: 'Document Desk', phase: 1, built: true },
  { path: '/inspections', label: 'Inspection Workspace', phase: 1, built: true },
  { path: '/valuation', label: 'Valuation Workspace', phase: 1, built: true },
  { path: '/reports', label: 'Report Studio', phase: 1, built: true },
  { path: '/revisions', label: 'Revision / Query Desk', phase: 2, built: true },
  { path: '/accounts', label: 'Accounts', phase: 2, built: true },
  { path: '/rate-bank', label: 'Rate Bank', phase: 2, built: true },
  { path: '/evidence', label: 'Evidence Vault', phase: 3, built: true },
  { path: '/admin', label: 'Administration', phase: 2, built: true },
]
