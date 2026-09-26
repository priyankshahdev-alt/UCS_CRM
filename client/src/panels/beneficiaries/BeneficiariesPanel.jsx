import { Routes, Route, Navigate } from 'react-router-dom'
import { BnfBaseProvider } from './bnfUi'
import Overview from './pages/Overview'
import AllBeneficiaries from './pages/AllBeneficiaries'
import ImportMembers from './pages/ImportMembers'
import BeneficiaryProfile from './pages/BeneficiaryProfile'
import Programs from './pages/Programs'
import ProgramForm from './pages/ProgramForm'
import ProgramDetail from './pages/ProgramDetail'
import Events from './pages/Events'

export default function BeneficiariesPanel({ base = '/beneficiaries' }) {
  return (
    <BnfBaseProvider value={base}>
      <div style={{ padding: '2px 0 60px' }}>
        <Routes>
          <Route index element={<Overview />} />
          <Route path="all" element={<AllBeneficiaries />} />
          <Route path="import" element={<ImportMembers />} />
          <Route path="programs" element={<Programs />} />
          <Route path="programs/new" element={<ProgramForm />} />
          <Route path="programs/:id" element={<ProgramDetail />} />
          <Route path="events" element={<Events />} />
          <Route path=":id" element={<BeneficiaryProfile />} />
          <Route path="*" element={<Navigate to={base} replace />} />
        </Routes>
      </div>
    </BnfBaseProvider>
  )
}