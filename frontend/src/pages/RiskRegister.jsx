import { useState, useEffect } from 'react'
import axios from 'axios'

function RiskRegister() {
  const [risks, setRisks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchRisks()
  }, [])

  const fetchRisks = async () => {
    try {
      const response = await axios.get('/api/risks')
      setRisks(response.data)
      setLoading(false)
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  if (loading) return <div className="loading">Loading risk register...</div>

  return (
    <div className="risk-register-page">
      <h1 className="page-title">Risk Register</h1>
      <p className="page-subtitle">Manage residual risks and track approvals</p>

      {risks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">&#128202;</div>
          <h3>No Risks Registered</h3>
          <p>Risks will appear here when residual compliance risks are identified and documented.</p>
        </div>
      ) : (
        <div className="risks-list">
          {risks.map((risk) => (
            <div key={risk.id} className={`risk-card ${risk.status}`}>
              <div className="risk-header">
                <span className={`status-badge ${risk.status}`}>{risk.status}</span>
                {risk.owner && <span className="owner-badge">Owner: {risk.owner}</span>}
              </div>
              <h3 className="risk-title">{risk.title}</h3>
              <p className="risk-description">{risk.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default RiskRegister
