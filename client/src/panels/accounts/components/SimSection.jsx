import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { SimProvider, useSim } from '../sim/store'
import { SimFormModal, SimViewModal, ReplaceModal, SimHistoryModal, SimBrandHistoryModal } from '../sim/modals'
import { ImportModal, DeleteConfirmModal } from '../sim/ImportModal'
import { deleteSimCard } from '../sim/api'
import { toast } from '../../../components/Toast'
import { exportToCSV, exportToExcel, ANDROID_EXPORT_COLUMNS, androidExportRow, NOKIA_EXPORT_COLUMNS, nokiaExportRow } from '../sim/helpers'
import Dashboard from '../sim/Dashboard'
import Inventory from '../sim/Inventory'
import SimInventory from '../sim/SimInventory'
import Expiring from '../sim/Expiring'
import Reports from '../sim/Reports'
import MobileId from '../sim/MobileId'
import Owner from '../sim/Owner'
import Settings from '../sim/Settings'
import ImportExport from '../sim/ImportExport'
import '../sim/simScope.css'

const PAGE_META = {
  dashboard: ['SIM Management', 'SIM Card Management', 'Manage SIM cards, devices, expiry dates and replacement records.'],
  inventory: ['SIM Management', 'All SIM Cards', 'Complete list of every registered SIM card.'],
  cards: ['SIM Management', 'SIM Inventory', 'Track physical SIM stock, availability and assignment.'],
  expiring: ['SIM Management', 'Expiring SIMs', 'SIMs nearing or past their auto-expiry date.'],
  reports: ['SIM Management', 'SIM Reports', 'Expiry and inventory analytics.'],
  mobileid: ['SIM Management', 'Mobile IDs', 'Manage mobile device IDs and their assigned SIM cards.'],
  owner: ['SIM Management', 'SIM Owners', 'View billing accounts and SIM ownership details.'],
  settings: ['SIM Management', 'Settings', 'Configure SIM expiry reminders and panel defaults.'],
  importexport: ['SIM Management', 'Import / Export', 'Import SIM cards from Excel or export data.'],
}

function SectionInner() {
  const sim = useSim()
  const location = useLocation()
  const isOwner = location.pathname.endsWith('/owner')
  const isDashboard = location.pathname === '/accounts/sim' || location.pathname.endsWith('/sim/dashboard') || location.pathname.endsWith('/sim')
  const isInventory = location.pathname.endsWith('/sim/inventory') || location.pathname.endsWith('/sim/cards')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [formKey, setFormKey] = useState(0)
  const [viewCard, setViewCard] = useState(null)
  const [replaceCard, setReplaceCard] = useState(null)
  const [historyCard, setHistoryCard] = useState(null)
  const [brandHistoryOpen, setBrandHistoryOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteCard, setDeleteCard] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [simName, setSimName] = useState('All')

  useEffect(() => { sim.refresh(); /* eslint-disable-next-line */ }, [])

  function openAdd() { setEditing(null); setFormKey((k) => k + 1); setFormOpen(true) }
  function openEdit(c) { setEditing(c); setFormKey((k) => k + 1); setFormOpen(true) }

  async function doDelete(c) {
    setDeleting(true)
    try {
      await deleteSimCard(c.id)
      sim.refresh()
      toast('SIM Card deleted successfully', 'success')
      setDeleteCard(null)
    } catch (e) {
      toast(e.message || 'Failed to delete SIM Card. Please try again.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function handleSaved() {
    setFormOpen(false); setEditing(null)
    try {
      await sim.refresh()
    } catch {
      // keep current state on error
    }
  }

  function filteredCards() {
    const id = (c) => (c.mobile_id || '').toLowerCase()
    let list
    if (simName === 'Android') list = sim.cards.filter((c) => id(c).startsWith('android ') && !id(c).startsWith('android whatsapp'))
    else if (simName === 'Nokia') list = sim.cards.filter((c) => id(c).startsWith('ufrs'))
    else list = sim.cards.filter((c) => !id(c).startsWith('android whatsapp'))
    if (simName !== 'Nokia') {
      const wmap = {}
      sim.cards.forEach((c) => { const m = String(c.mobile_id || '').match(/^android whatsapp\s+(\d+)/i); if (m) wmap[m[1]] = c })
      list = list.map((c) => {
        const mm = String(c.mobile_id || '').match(/^android\s+(\d+)$/i)
        const w = mm ? wmap[mm[1]] : null
        if (!w) return c
        return { ...c, w1_name: w.w1_name, sim_1: w.sim_1, w2_name: w.w2_name, sim_2: w.sim_2, w3_name: w.w3_name, sim_3: w.sim_3, w4_name: w.w4_name, sim_4: w.sim_4 }
      })
    }
    return list
  }

  return (
    <div className="sim-scope">
      <div className="sim-actions" style={{ marginBottom: 16, justifyContent: 'flex-end' }}>
        {!isOwner && <button className="sim-btn" onClick={() => setBrandHistoryOpen(true)}>
          {simName === 'Nokia' ? 'Nokia History' : simName === 'Android' ? 'Android History' : 'SIM History'}
        </button>}
        {!isOwner && !isDashboard && <>
          {!isInventory && <button className="sim-btn" onClick={() => setImportOpen(true)}>Import</button>}
          {simName === 'Android' ? (
            <>
              <button className="sim-btn" onClick={() => exportToCSV(filteredCards(), ANDROID_EXPORT_COLUMNS, androidExportRow)}>Export CSV</button>
              <button className="sim-btn" onClick={() => exportToExcel(filteredCards(), ANDROID_EXPORT_COLUMNS, androidExportRow)}>Export</button>
            </>
          ) : simName === 'Nokia' ? (
            <>
              <button className="sim-btn" onClick={() => exportToCSV(filteredCards(), NOKIA_EXPORT_COLUMNS, nokiaExportRow)}>Export CSV</button>
              <button className="sim-btn" onClick={() => exportToExcel(filteredCards(), NOKIA_EXPORT_COLUMNS, nokiaExportRow)}>Export</button>
            </>
          ) : (
            <>
              <button className="sim-btn" onClick={() => exportToCSV(filteredCards())}>Export CSV</button>
              <button className="sim-btn" onClick={() => exportToExcel(filteredCards())}>Export</button>
            </>
          )}
        </>}
      </div>

      <Routes>
        <Route index element={<Dashboard onAdd={openAdd} onView={setViewCard} onEdit={openEdit} onReplace={setReplaceCard} />} />
        <Route path="dashboard" element={<Dashboard onAdd={openAdd} onView={setViewCard} onEdit={openEdit} onReplace={setReplaceCard} />} />
        <Route path="inventory" element={<Inventory simName={simName} onSimNameChange={setSimName} onAdd={openAdd} onView={setViewCard} onEdit={openEdit} onReplace={setReplaceCard} onDelete={(c) => setDeleteCard(c)} onHistory={setHistoryCard} />} />
        <Route path="cards" element={<SimInventory />} />
        <Route path="expiring" element={<Expiring onView={setViewCard} onEdit={openEdit} onReplace={setReplaceCard} />} />
        <Route path="reports" element={<Reports />} />
        <Route path="mobileid" element={<MobileId />} />
        <Route path="owner" element={<Owner />} />
        <Route path="settings" element={<Settings />} />
        <Route path="importexport" element={<ImportExport />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>

      <SimFormModal key={formKey} open={formOpen} card={editing} onClose={() => { setFormOpen(false); setEditing(null) }} onSaved={handleSaved} />
      <SimViewModal card={viewCard} open={!!viewCard} onClose={() => setViewCard(null)} onEdit={() => { if (viewCard) openEdit(viewCard) }} onReplace={() => { if (viewCard) { setReplaceCard(viewCard); setViewCard(null) } }} />
      <ReplaceModal card={replaceCard} open={!!replaceCard} onClose={() => setReplaceCard(null)} onDone={() => sim.refresh()} />
      <SimHistoryModal card={historyCard} open={!!historyCard} onClose={() => setHistoryCard(null)} />
      <SimBrandHistoryModal open={brandHistoryOpen} initialBrand={simName} onClose={() => setBrandHistoryOpen(false)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); sim.refresh() }} />
      <DeleteConfirmModal card={deleteCard} deleting={deleting} onClose={() => { if (!deleting) setDeleteCard(null) }} onConfirm={() => deleteCard && doDelete(deleteCard)} />
    </div>
  )
}

export default function SimSection() {
  return (
    <SimProvider>
      <SectionInner />
    </SimProvider>
  )
}

export { PAGE_META }
