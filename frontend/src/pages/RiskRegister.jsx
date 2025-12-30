import { useState, useEffect } from 'react'
import axios from 'axios'

function RiskRegister() {
  const [risks, setRisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newRisk, setNewRisk] = useState({
    title: '',
    description: '',
    risk_level: 'medium',
    owner: ''
  })

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

  const createRisk = async () => {
    try {
      const params = new URLSearchParams()
      params.append('title', newRisk.title)
      params.append('description', newRisk.description)
      params.append('risk_level', newRisk.risk_level)
      params.append('owner', newRisk.owner)
      
      await axios.post(`/api/risks?${params.toString()}`)
      setShowAddForm(false)
      setNewRisk({ title: '', description: '', risk_level: 'medium', owner: '' })
      await fetchRisks()
    } catch (err) {
      console.error(err)
    }
  }

  const approveRisk = async (riskId, action) => {
    try {
      const justification = action === 'approve' 
        ? prompt('Business justification for accepting this risk:')
        : prompt('Reason for rejecting risk acceptance:')
      
      if (!justification) return
      
      await axios.patch(
        `/api/risks/${riskId}/approve?action=${action}&approved_by=Business Owner&business_justification=${encodeURIComponent(justification)}`
      )
      await fetchRisks()
    } catch (err) {
      console.error(err)
    }
  }

  const pendingCount = risks.filter(r => r.status === 'pending').length
  const approvedCount = risks.filter(r => r.status === 'approved').length
  const rejectedCount = risks.filter(r => r.status === 'rejected').length

  if (loading) return <div className="loading">Loading risk register...</div>

  return (
    <div className="risk-register-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Risk Register</h1>
          <p className="page-subtitle">Track and manage residual compliance risks requiring business approval</p>
        </div>
        <div className="risk-summary">
          <span className="summary-item pending">{pendingCount} Pending</span>
          <span className="summary-item approved">{approvedCount} Approved</span>
          <span className="summary-item rejected">{rejectedCount} Rejected</span>
        </div>
      </div>

      <div className="risk-actions-bar">
        <button className="btn-add-risk" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : '+ Add Risk'}
        </button>
      </div>

      {showAddForm && (
        <div className="add-risk-form">
          <h3>Register New Risk</h3>
          <div className="form-row">
            <input
              type="text"
              placeholder="Risk Title"
              value={newRisk.title}
              onChange={(e) => setNewRisk({...newRisk, title: e.target.value})}
            />
            <select
              value={newRisk.risk_level}
              onChange={(e) => setNewRisk({...newRisk, risk_level: e.target.value})}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <textarea
            placeholder="Risk Description"
            value={newRisk.description}
            onChange={(e) => setNewRisk({...newRisk, description: e.target.value})}
          />
          <input
            type="text"
            placeholder="Risk Owner"
            value={newRisk.owner}
            onChange={(e) => setNewRisk({...newRisk, owner: e.target.value})}
          />
          <button className="btn-submit" onClick={createRisk} disabled={!newRisk.title}>
            Submit Risk
          </button>
        </div>
      )}

      {risks.length === 0 && !showAddForm ? (
        <div className="empty-state">
          <div className="empty-icon">&#128202;</div>
          <h3>No Risks Registered</h3>
          <p>Register risks when compliance gaps cannot be fully remediated and require business acceptance.</p>
        </div>
      ) : (
        <div className="risks-list">
          {risks.map((risk) => (
            <div key={risk.id} className={`risk-card ${risk.status}`}>
              <div className="risk-header">
                <div className="risk-badges">
                  <span className={`risk-level-badge ${risk.risk_level}`}>{risk.risk_level}</span>
                  <span className={`status-badge ${risk.status}`}>{risk.status}</span>
                  {risk.sub_req_number && (
                    <span className="req-badge">Req {risk.sub_req_number}</span>
                  )}
                </div>
                {risk.owner && <span className="owner-badge">Owner: {risk.owner}</span>}
              </div>
              
              <h3 className="risk-title">{risk.title}</h3>
              <p className="risk-description">{risk.description}</p>
              
              {risk.business_justification && (
                <div className="justification">
                  <strong>Business Justification:</strong> {risk.business_justification}
                </div>
              )}

              {risk.approved_by && (
                <div className="approval-info">
                  {risk.status === 'approved' ? 'Approved' : 'Rejected'} by {risk.approved_by} on {new Date(risk.approved_at).toLocaleDateString()}
                </div>
              )}

              {risk.status === 'pending' && (
                <div className="risk-actions">
                  <button className="btn-approve" onClick={() => approveRisk(risk.id, 'approve')}>
                    Approve Risk
                  </button>
                  <button className="btn-reject" onClick={() => approveRisk(risk.id, 'reject')}>
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default RiskRegister
