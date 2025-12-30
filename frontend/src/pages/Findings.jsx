import { useState, useEffect } from 'react'
import axios from 'axios'

function Findings() {
  const [findings, setFindings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    fetchFindings()
  }, [])

  const fetchFindings = async () => {
    try {
      const response = await axios.get('/api/findings')
      setFindings(response.data)
      setLoading(false)
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  const updateFinding = async (findingId, status, notes = null) => {
    try {
      const params = new URLSearchParams()
      if (status) params.append('status', status)
      if (notes) params.append('remediation_notes', notes)
      
      await axios.patch(`/api/findings/${findingId}?${params.toString()}`)
      await fetchFindings()
    } catch (err) {
      console.error(err)
    }
  }

  const filteredFindings = findings.filter(f => {
    if (filter === 'all') return true
    if (filter === 'open') return f.status === 'open' || f.status === 'in_remediation'
    return f.status === filter
  })

  const openCount = findings.filter(f => f.status === 'open').length
  const inRemediationCount = findings.filter(f => f.status === 'in_remediation').length
  const closedCount = findings.filter(f => f.status === 'closed').length

  if (loading) return <div className="loading">Loading findings...</div>

  return (
    <div className="findings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Findings</h1>
          <p className="page-subtitle">Track and remediate compliance gaps from rejected evidence</p>
        </div>
        <div className="findings-summary">
          <span className="summary-item open">{openCount} Open</span>
          <span className="summary-item in-remediation">{inRemediationCount} In Remediation</span>
          <span className="summary-item closed">{closedCount} Closed</span>
        </div>
      </div>

      <div className="filter-bar">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
        <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>Open</button>
        <button className={filter === 'in_remediation' ? 'active' : ''} onClick={() => setFilter('in_remediation')}>In Remediation</button>
        <button className={filter === 'closed' ? 'active' : ''} onClick={() => setFilter('closed')}>Closed</button>
      </div>

      {filteredFindings.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">&#128269;</div>
          <h3>No Findings</h3>
          <p>
            {filter === 'all' 
              ? 'No findings yet. Findings are automatically created when evidence is rejected by an auditor.'
              : `No ${filter.replace('_', ' ')} findings.`}
          </p>
        </div>
      ) : (
        <div className="findings-list">
          {filteredFindings.map((finding) => (
            <div key={finding.id} className={`finding-card ${finding.status}`}>
              <div className="finding-header">
                <div className="finding-badges">
                  <span className={`severity-badge ${finding.severity}`}>{finding.severity}</span>
                  <span className={`status-badge ${finding.status}`}>{finding.status.replace('_', ' ')}</span>
                  {finding.sub_req_number && (
                    <span className="req-badge">Req {finding.sub_req_number}</span>
                  )}
                </div>
                <span className="finding-date">
                  {new Date(finding.created_at).toLocaleDateString()}
                </span>
              </div>
              
              <h3 className="finding-title">{finding.title}</h3>
              <p className="finding-description">{finding.description}</p>
              
              {finding.remediation_notes && (
                <div className="remediation-notes">
                  <strong>Remediation Notes:</strong> {finding.remediation_notes}
                </div>
              )}

              {finding.status !== 'closed' && (
                <div className="finding-actions">
                  {finding.status === 'open' && (
                    <button 
                      className="btn-remediate"
                      onClick={() => {
                        const notes = prompt('Enter remediation plan:')
                        if (notes) updateFinding(finding.id, 'in_remediation', notes)
                      }}
                    >
                      Start Remediation
                    </button>
                  )}
                  {finding.status === 'in_remediation' && (
                    <p className="remediation-hint">
                      Upload corrected evidence in the Controls & Evidence page, then the auditor will re-review.
                    </p>
                  )}
                </div>
              )}

              {finding.closed_at && (
                <div className="closed-info">
                  Closed on {new Date(finding.closed_at).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Findings
