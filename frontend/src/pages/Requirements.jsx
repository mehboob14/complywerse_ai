import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

function Requirements() {
  const [requirements, setRequirements] = useState([])
  const [expandedReq, setExpandedReq] = useState(null)
  const [expandedSubReq, setExpandedSubReq] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(null)
  const [userRole, setUserRole] = useState('it_security')
  const fileInputRef = useRef(null)

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
    setExpandedSubReq(null)
  }

  const toggleSubReq = (subReqId) => {
    setExpandedSubReq(expandedSubReq === subReqId ? null : subReqId)
  }

  const handleUpload = async (requiredEvidenceId, file) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('uploaded_by', userRole === 'it_security' ? 'IT Security' : 'Security Team')
    
    setUploading(requiredEvidenceId)
    try {
      await axios.post(`/api/evidence/${requiredEvidenceId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      await fetchRequirements()
    } catch (err) {
      console.error('Upload failed:', err)
      alert('Upload failed. Please try again.')
    }
    setUploading(null)
  }

  const handleReview = async (submissionId, action, notes = '') => {
    try {
      await axios.post(`/api/evidence/${submissionId}/review?action=${action}&reviewer=QSA Auditor&notes=${encodeURIComponent(notes)}`)
      await fetchRequirements()
    } catch (err) {
      console.error('Review failed:', err)
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'compliant': return <span className="status-icon compliant">&#10003;</span>
      case 'partial': return <span className="status-icon partial">&#9711;</span>
      default: return <span className="status-icon not-started">&#9675;</span>
    }
  }

  const getEvidenceStatusBadge = (status) => {
    switch (status) {
      case 'accepted': return <span className="evidence-status accepted">Accepted</span>
      case 'rejected': return <span className="evidence-status rejected">Rejected</span>
      case 'pending_review': return <span className="evidence-status pending">Pending Review</span>
      default: return <span className="evidence-status not-uploaded">Not Uploaded</span>
    }
  }

  if (loading) return <div className="loading">Loading requirements...</div>

  return (
    <div className="requirements-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Controls & Evidence</h1>
          <p className="page-subtitle">Upload evidence against PCI DSS requirements. Evidence is dynamically validated.</p>
        </div>
        <div className="role-selector">
          <label>Viewing as:</label>
          <select value={userRole} onChange={(e) => setUserRole(e.target.value)}>
            <option value="it_security">IT/Security Team</option>
            <option value="auditor">QSA Auditor</option>
            <option value="business_owner">Business Owner</option>
          </select>
        </div>
      </div>

      <div className="requirements-list">
        {requirements.map((req) => (
          <div key={req.id} className="requirement-card">
            <div className="requirement-header" onClick={() => toggleReq(req.id)}>
              <div className="req-number">{req.req_number}</div>
              <div className="req-info">
                <div className="req-title">{req.name}</div>
                <div className="req-progress-bar">
                  <div 
                    className="req-progress-fill" 
                    style={{ width: `${req.compliance_percentage}%` }}
                  ></div>
                </div>
                <div className="req-breakdown">
                  <span className="breakdown-item compliant">{req.compliant_count} compliant</span>
                  <span className="breakdown-item partial">{req.partial_count} partial</span>
                  <span className="breakdown-item not-started">{req.not_started_count} not started</span>
                </div>
              </div>
              <div className="req-stats">
                <span className="compliance-percent">{req.compliance_percentage}%</span>
              </div>
              <span className="req-chevron">{expandedReq === req.id ? '▼' : '›'}</span>
            </div>

            {expandedReq === req.id && (
              <div className="sub-requirements">
                {req.sub_requirements.map((sub) => (
                  <div key={sub.id} className={`sub-req-item ${sub.compliance_status}`}>
                    <div className="sub-req-header" onClick={() => toggleSubReq(sub.id)}>
                      {getStatusIcon(sub.compliance_status)}
                      <div className="sub-req-main">
                        <div className="sub-req-title-row">
                          <span className="sub-req-number">Req {sub.sub_req_number}</span>
                          <span className={`sub-req-status ${sub.compliance_status}`}>
                            {sub.compliance_status === 'compliant' ? 'Compliant' : 
                             sub.compliance_status === 'partial' ? 'Partial' : 'Not Started'}
                          </span>
                          <span className="evidence-count">
                            {sub.total_accepted}/{sub.total_required} evidence accepted
                          </span>
                        </div>
                        <div className="sub-req-name">{sub.name}</div>
                      </div>
                      <span className="sub-req-chevron">{expandedSubReq === sub.id ? '▲' : '▼'}</span>
                    </div>

                    {expandedSubReq === sub.id && (
                      <div className="evidence-section">
                        <h4>Required Evidence</h4>
                        <div className="evidence-list">
                          {sub.required_evidence.map((ev) => (
                            <div key={ev.id} className={`evidence-item ${ev.has_accepted ? 'complete' : ''}`}>
                              <div className="evidence-header">
                                <div className="evidence-info">
                                  <span className="evidence-type-badge">{ev.evidence_type}</span>
                                  <span className="evidence-name">{ev.name}</span>
                                  {ev.description && <p className="evidence-desc">{ev.description}</p>}
                                </div>
                                {getEvidenceStatusBadge(ev.latest_status)}
                              </div>

                              {ev.submissions.length > 0 && (
                                <div className="submissions-list">
                                  {ev.submissions.map((sub) => (
                                    <div key={sub.id} className={`submission ${sub.status}`}>
                                      <div className="submission-info">
                                        <span className="file-name">{sub.file_name}</span>
                                        <span className="upload-info">
                                          by {sub.uploaded_by} on {new Date(sub.uploaded_at).toLocaleDateString()}
                                        </span>
                                        {sub.review_notes && (
                                          <p className="review-notes">Note: {sub.review_notes}</p>
                                        )}
                                      </div>
                                      <div className="submission-status">
                                        {sub.status === 'pending_review' && userRole === 'auditor' && (
                                          <div className="review-actions">
                                            <button 
                                              className="btn-accept"
                                              onClick={() => handleReview(sub.id, 'accept')}
                                            >
                                              Accept
                                            </button>
                                            <button 
                                              className="btn-reject"
                                              onClick={() => {
                                                const notes = prompt('Rejection reason:')
                                                if (notes) handleReview(sub.id, 'reject', notes)
                                              }}
                                            >
                                              Reject
                                            </button>
                                          </div>
                                        )}
                                        {sub.status === 'accepted' && (
                                          <span className="status-badge accepted">&#10003; Accepted</span>
                                        )}
                                        {sub.status === 'rejected' && (
                                          <span className="status-badge rejected">&#10007; Rejected</span>
                                        )}
                                        {sub.status === 'pending_review' && userRole !== 'auditor' && (
                                          <span className="status-badge pending">Pending Review</span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {!ev.has_accepted && (userRole === 'it_security') && (
                                <div className="upload-section">
                                  <input
                                    type="file"
                                    id={`file-${ev.id}`}
                                    style={{display: 'none'}}
                                    onChange={(e) => {
                                      if (e.target.files[0]) {
                                        handleUpload(ev.id, e.target.files[0])
                                      }
                                    }}
                                  />
                                  <button 
                                    className="btn-upload"
                                    disabled={uploading === ev.id}
                                    onClick={() => document.getElementById(`file-${ev.id}`).click()}
                                  >
                                    {uploading === ev.id ? 'Uploading...' : '+ Upload Evidence'}
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
