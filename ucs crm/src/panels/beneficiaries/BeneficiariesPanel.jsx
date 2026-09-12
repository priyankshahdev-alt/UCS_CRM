import { Routes, Route, Navigate } from 'react-router-dom'
import { BnfBaseProvider } from './bnfUi'
import Overview from './pages/Overview'
import AllBeneficiaries from './pages/AllBeneficiaries'
import NewRegistration from './pages/NewRegistration'
import BeneficiaryProfile from './pages/BeneficiaryProfile'
import Programs from './pages/Programs'
import ProgramForm from './pages/ProgramForm'
import ProgramDetail from './pages/ProgramDetail'
import Benefits from './pages/Benefits'
import Distribution from './pages/Distribution'
import VolunteersPage from './pages/Volunteers'
import CardsIdentification from './pages/CardsIdentification'
import Biometric from './pages/Biometric'
import Imports from './pages/Imports'
import Reports from './pages/Reports'

export default function BeneficiariesPanel({ base = '/beneficiaries' }) {
  return (
    <BnfBaseProvider value={base}>
      <div style={{ padding: '2px 0 60px' }}>
        <Routes>
          <Route index element={<Overview />} />
          <Route path="all" element={<AllBeneficiaries />} />
          <Route path="new" element={<NewRegistration />} />
          <Route path="programs" element={<Programs />} />
          <Route path="programs/new" element={<ProgramForm />} />
          <Route path="programs/:id" element={<ProgramDetail />} />
          <Route path="benefits" element={<Benefits />} />
          <Route path="distribution" element={<Distribution />} />
          <Route path="volunteers" element={<VolunteersPage />} />
          <Route path="cards" element={<CardsIdentification />} />
          <Route path="biometric" element={<Biometric />} />
          <Route path="imports" element={<Imports />} />
          <Route path="reports" element={<Reports />} />
          <Route path=":id" element={<BeneficiaryProfile />} />
          <Route path="*" element={<Navigate to={base} replace />} />
        </Routes>
      </div>
    </BnfBaseProvider>
  )
}