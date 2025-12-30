import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Requirements from './pages/Requirements'
import Findings from './pages/Findings'
import RiskRegister from './pages/RiskRegister'
import './App.css'

function App() {
  return (
    <Router>
      <div className="app">
        <nav className="navbar">
          <div className="nav-brand">PCI DSS Lifecycle</div>
          <div className="nav-links">
            <NavLink to="/" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Dashboard</NavLink>
            <NavLink to="/requirements" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Requirements</NavLink>
            <NavLink to="/findings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Findings</NavLink>
            <NavLink to="/risk-register" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Risk Register</NavLink>
          </div>
        </nav>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/requirements" element={<Requirements />} />
            <Route path="/findings" element={<Findings />} />
            <Route path="/risk-register" element={<RiskRegister />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App
