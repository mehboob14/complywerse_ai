import { useState, useEffect } from 'react'
import axios from 'axios'

function Requirements() {
  const [requirements, setRequirements] = useState([])
  const [expandedReq, setExpandedReq] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchRequirements()
  }, [])

  const fetchRequirements = async () => {
    try {
      const response = await axios.get('/api/requirements')
      setRequirements(response.data)
      setLoading(false)
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  const toggleReq = (reqId) => {
    setExpandedReq(expandedReq === reqId ? null : reqId)
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'compliant': return <span className="status-icon compliant">&#10003;</span>
      case 'partial': return <span className="status-icon partial">&#9711;</span>
      default: return <span className="status-icon not-started">&#9675;</span>
    }
  }

  if (loading) return <div className="loading">Loading requirements...</div>

  return (
    <div className="requirements-page">
      <h1 className="page-title">PCI DSS v4.0 Requirements</h1>
      <p className="page-subtitle">12 core requirements with detailed sub-requirements and evidence tracking</p>

      <div className="requirements-list">
        {requirements.map((req) => (
          <div key={req.id} className="requirement-card">
            <div className="requirement-header" onClick={() => toggleReq(req.id)}>
              <div className="req-number">{req.req_number}</div>
              <div className="req-info">
                <div className="req-title">{req.name}</div>
                <div className="req-description">{req.description?.substring(0, 120)}...</div>
                <div className="req-progress-bar">
                  <div 
                    className="req-progress-fill" 
                    style={{ width: `${req.compliance_percentage}%` }}
                  ></div>
                </div>
              </div>
              <div className="req-stats">
                <span className="compliance-badge">
                  {req.compliant_count}/{req.total_count} compliant
                </span>
                <span className="compliance-percent">{req.compliance_percentage}%</span>
              </div>
              <span className="req-chevron">{expandedReq === req.id ? '▼' : '›'}</span>
            </div>

            {expandedReq === req.id && (
              <div className="sub-requirements">
                {req.sub_requirements.map((sub) => (
                  <div key={sub.id} className={`sub-req-item ${sub.status}`}>
                    {getStatusIcon(sub.status)}
                    <div className="sub-req-info">
                      <span className="sub-req-number">Req {sub.sub_req_number}</span>
                      <span className={`sub-req-status ${sub.status}`}>{sub.status}</span>
                      {sub.evidence_needed > 0 && (
                        <span className="evidence-needed">{sub.evidence_needed} evidence needed</span>
                      )}
                    </div>
                    <div className="sub-req-name">{sub.name}</div>
                    <span className="sub-req-chevron">▼</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default Requirements
