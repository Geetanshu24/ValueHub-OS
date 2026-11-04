import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout.tsx'
import Placeholder from './components/Placeholder.tsx'
import { useAuth } from './lib/auth.tsx'
import Accounts from './pages/Accounts.tsx'
import Admin from './pages/Admin.tsx'
import AssignmentDetail from './pages/AssignmentDetail.tsx'
import Assignments from './pages/Assignments.tsx'
import NewAssignment from './pages/NewAssignment.tsx'
import PropertyDocuments from './pages/PropertyDocuments.tsx'
import InspectionStep from './pages/InspectionStep.tsx'
import ValuationStep from './pages/ValuationStep.tsx'
import QualityReview from './pages/QualityReview.tsx'
import SubmissionStep from './pages/SubmissionStep.tsx'
import CommandCentre from './pages/CommandCentre.tsx'
import DocumentDesk from './pages/DocumentDesk.tsx'
import EvidenceVault from './pages/EvidenceVault.tsx'
import InspectionWorkspace from './pages/InspectionWorkspace.tsx'
import Login from './pages/Login.tsx'
import RevisionDesk from './pages/RevisionDesk.tsx'
import BankReport from './pages/BankReport.tsx'
import ReportStudio from './pages/ReportStudio.tsx'
import ValuationWorkspace from './pages/ValuationWorkspace.tsx'
import ResetPassword from './pages/ResetPassword.tsx'
import Properties from './pages/Properties.tsx'
import { SCREENS } from './routes.tsx'

export default function App() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <p className="p-8 text-base text-ink-soft">Loading…</p>
  if (!user) return location.pathname === '/reset-password' ? <ResetPassword /> : <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CommandCentre />} />
        <Route path="assignments" element={<Assignments />} />
        <Route path="assignments/new" element={<NewAssignment />} />
        <Route path="assignments/:id" element={<AssignmentDetail />} />
        <Route path="assignments/:id/documents" element={<PropertyDocuments />} />
        <Route path="assignments/:id/inspection" element={<InspectionStep />} />
        <Route path="assignments/:id/valuation" element={<ValuationStep />} />
        <Route path="assignments/:id/bank-report" element={<BankReport />} />
        <Route path="assignments/:id/review" element={<QualityReview />} />
        <Route path="assignments/:id/submission" element={<SubmissionStep />} />
        <Route path="admin" element={<Admin />} />
        <Route path="properties" element={<Properties />} />
        <Route path="documents" element={<DocumentDesk />} />
        <Route path="inspections" element={<InspectionWorkspace />} />
        <Route path="valuation" element={<ValuationWorkspace />} />
        <Route path="reports" element={<ReportStudio />} />
        <Route path="revisions" element={<RevisionDesk />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="evidence" element={<EvidenceVault />} />
        {SCREENS.filter((screen) => !screen.built).map((screen) => (
          <Route key={screen.path} path={screen.path.slice(1)} element={<Placeholder screen={screen} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
