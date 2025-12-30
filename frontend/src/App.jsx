import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Dashboard from './pages/Dashboard'
import Requirements from './pages/Requirements'
import Findings from './pages/Findings'
import RiskRegister from './pages/RiskRegister'
import Login from './pages/Login'
import Admin from './pages/Admin'
import EvidenceComparison from './pages/EvidenceComparison'
import './App.css'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return <div className="loading-screen">Loading...</div>
  }
  
  if (!user) {
    return <Navigate to="/login" />
  }
  
  return children
}

function AppContent() {
  const { user, logout, loading } = useAuth()

  if (loading) {
    return <div className="loading-screen">Loading...</div>
  }

  const roleLabels = {
    admin: 'Administrator',
    infosec_team: 'Infosec Team',
    qsa_auditor: 'QSA Auditor',
    business_owner: 'Business Owner',
    it_security: 'IT Security'
  }

  return (
    <div className="app">
      {user && (
        <nav className="navbar">
          <div className="nav-brand">PCI DSS Lifecycle</div>
          <div className="nav-links">
            <NavLink to="/" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Dashboard</NavLink>
            <NavLink to="/requirements" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Requirements</NavLink>
            <NavLink to="/evidence" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Evidence</NavLink>
            <NavLink to="/findings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Findings</NavLink>
            <NavLink to="/risk-register" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Risk Register</NavLink>
            {user.role === 'admin' && (
              <NavLink to="/admin" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Admin</NavLink>
            )}
          </div>
          <div className="user-info">
            <span className="user-name">{user.display_name}</span>
            <span className={`user-role ${user.role}`}>{roleLabels[user.role] || user.role}</span>
            <button className="logout-btn" onClick={logout}>Logout</button>
          </div>
        </nav>
      )}
      <main className={user ? "main-content" : "main-content-full"}>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/requirements" element={<ProtectedRoute><Requirements /></ProtectedRoute>} />
          <Route path="/evidence" element={<ProtectedRoute><EvidenceComparison /></ProtectedRoute>} />
          <Route path="/findings" element={<ProtectedRoute><Findings /></ProtectedRoute>} />
          <Route path="/risk-register" element={<ProtectedRoute><RiskRegister /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  )
}

export default App
