import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import UploadEvidence from './pages/UploadEvidence'
import EvidenceChecklist from './pages/EvidenceChecklist'
import Findings from './pages/Findings'
import RiskRegister from './pages/RiskRegister'
import ControlsEvidence from './pages/ControlsEvidence'
import './App.css'

function App() {
  return (
    <Router>
      <div className="app">
        <nav className="navbar">
          <div className="nav-brand">PCI DSS Lifecycle</div>
          <div className="nav-links">
            <NavLink to="/" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Dashboard</NavLink>
            <NavLink to="/controls" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Controls & Evidence</NavLink>
            <NavLink to="/evidence-checklist" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Evidence Checklist</NavLink>
            <NavLink to="/findings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Findings</NavLink>
            <NavLink to="/risk-register" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Risk Register</NavLink>
            <NavLink to="/upload-evidence" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Upload Evidence</NavLink>
          </div>
        </nav>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/upload-evidence" element={<UploadEvidence />} />
            <Route path="/evidence-checklist" element={<EvidenceChecklist />} />
            <Route path="/findings" element={<Findings />} />
            <Route path="/risk-register" element={<RiskRegister />} />
            <Route path="/controls" element={<ControlsEvidence />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App
