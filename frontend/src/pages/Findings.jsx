import { useState, useEffect } from 'react'
import api from '../config/api'
import { useAuth } from '../context/AuthContext'

function Findings() {
  const { user } = useAuth()
  const [findings, setFindings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newFinding, setNewFinding] = useState({ title: '', description: '', severity: 'medium' })
  
  const canManageFindings = user?.role === 'admin' || user?.role === 'infosec_team'

  useEffect(() => {
    fetchFindings()
  }, [])

  const fetchFindings = async () => {
    try {
      const response = await api.get('/findings')
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

  const createFinding = async () => {
    if (!newFinding.title || !newFinding.description) {
      alert('Please fill in title and description')
      return
    }
    try {
      await axios.post('/api/findings', newFinding)
      setShowCreateModal(false)
      setNewFinding({ title: '', description: '', severity: 'medium' })
      await fetchFindings()
    } catch (err) {
      console.error(err)
      alert('Failed to create finding')
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
        <div className="findings-header-actions">
          <div className="findings-summary">
            <span className="summary-item open">{openCount} Open</span>
            <span className="summary-item in-remediation">{inRemediationCount} In Remediation</span>
            <span className="summary-item closed">{closedCount} Closed</span>
          </div>
          {canManageFindings && (
            <button className="btn-create-finding" onClick={() => setShowCreateModal(true)}>
              + Create Finding
            </button>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Create New Finding</h3>
            <p className="modal-hint">Findings are usually auto-created when evidence is rejected, but you can create one manually for other compliance gaps.</p>
            <div className="form-group">
              <label>Title</label>
              <input 
                type="text" 
                value={newFinding.title}
                onChange={(e) => setNewFinding({...newFinding, title: e.target.value})}
                placeholder="e.g., Missing firewall documentation"
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea 
                value={newFinding.description}
                onChange={(e) => setNewFinding({...newFinding, description: e.target.value})}
                placeholder="Describe the compliance gap and what needs to be fixed"
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Severity</label>
              <select 
                value={newFinding.severity}
                onChange={(e) => setNewFinding({...newFinding, severity: e.target.value})}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button className="btn-create" onClick={createFinding}>Create Finding</button>
            </div>
          </div>
        </div>
      )}

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

              <div className="finding-actions">
                {finding.status === 'open' && (
                  <>
                    <button 
                      className="btn-remediate"
                      onClick={() => {
                        const notes = prompt('Enter remediation plan:')
                        if (notes) updateFinding(finding.id, 'in_remediation', notes)
                      }}
                    >
                      Start Remediation
                    </button>
                    {canManageFindings && (
                      <button 
                        className="btn-close-finding"
                        onClick={() => {
                          if (confirm('Mark this finding as closed?')) {
                            updateFinding(finding.id, 'closed')
                          }
                        }}
                      >
                        Close Finding
                      </button>
                    )}
                  </>
                )}
                {finding.status === 'in_remediation' && (
                  <>
                    <p className="remediation-hint">
                      Upload corrected evidence in Requirements page, then the auditor will re-review.
                    </p>
                    {canManageFindings && (
                      <button 
                        className="btn-close-finding"
                        onClick={() => {
                          if (confirm('Mark this finding as closed?')) {
                            updateFinding(finding.id, 'closed')
                          }
                        }}
                      >
                        Close Finding
                      </button>
                    )}
                  </>
                )}
                {finding.status === 'closed' && canManageFindings && (
                  <button 
                    className="btn-reopen"
                    onClick={() => {
                      if (confirm('Reopen this finding?')) {
                        updateFinding(finding.id, 'open')
                      }
                    }}
                  >
                    Reopen Finding
                  </button>
                )}
              </div>

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
