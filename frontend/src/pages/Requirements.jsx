import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'

function Requirements() {
  const { user } = useAuth()
  const [requirements, setRequirements] = useState([])
  const [currentPhase, setCurrentPhase] = useState(null)
  const [phaseFilter, setPhaseFilter] = useState('all')
  const [expandedReq, setExpandedReq] = useState(null)
  const [expandedSubReq, setExpandedSubReq] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(null)
  const userRole = user?.role || 'it_security'

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [reqRes, phaseRes] = await Promise.all([
        axios.get('/api/requirements'),
        axios.get('/api/phases')
      ])
      setRequirements(reqRes.data)
      const current = phaseRes.data.find(p => p.is_current)
      setCurrentPhase(current)
      setLoading(false)
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  const fetchRequirements = async () => {
    try {
      const response = await axios.get('/api/requirements')
      setRequirements(response.data)
    } catch (err) {
      console.error(err)
    }
  }

  const getLinkedRequirementIds = () => {
    if (!currentPhase?.phase_requirements) return []
    return currentPhase.phase_requirements.map(pr => pr.requirement_id)
  }

  const filteredRequirements = phaseFilter === 'current' 
    ? requirements.filter(r => getLinkedRequirementIds().includes(r.id))
    : requirements

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

  const getSubReqStatusBadge = (sub) => {
    if (sub.compliance_status === 'compliant') {
      return <span className="sub-status-badge compliant">compliant</span>
    } else if (sub.compliance_status === 'partial') {
      return <span className="sub-status-badge partial">partial</span>
    } else {
      return <span className="sub-status-badge not-compliant">non compliant</span>
    }
  }

  const getEvidenceNeededBadge = (sub) => {
    const needed = sub.total_required - sub.total_accepted
    if (needed > 0 && sub.compliance_status !== 'compliant') {
      return <span className="evidence-needed-badge">{needed} evidence needed</span>
    }
    return null
  }

  const getTestingProcedures = (subReqNumber) => {
    const procedures = {
      '1.1': [
        'Examine documentation to verify policies and procedures are defined',
        'Interview personnel to verify awareness of policies',
        'Examine evidence of policy review and approval'
      ],
      '1.2': [
        'Examine NSC configurations to verify rulesets',
        'Examine network diagrams to confirm NSC placement',
        'Interview personnel responsible for NSC configuration'
      ],
      '1.3': [
        'Examine firewall and router configurations',
        'Examine network diagrams showing CDE boundary',
        'Test network segmentation controls'
      ],
      '1.4': [
        'Examine policies for network connections',
        'Verify trusted and untrusted network controls',
        'Test filtering between network zones'
      ],
      '1.5': [
        'Examine risk assessment documentation',
        'Verify risks are identified and mitigated',
        'Review network device security configurations'
      ]
    }
    return procedures[subReqNumber] || [
      'Examine relevant documentation and configurations',
      'Interview personnel responsible for this control',
      'Verify evidence of implementation'
    ]
  }

  const getEvidenceExamples = (evidenceType, evidenceName) => {
    const examples = {
      'policy': ['Network Security Policy PDF', 'Firewall Management Procedure', 'Access Control Policy'],
      'config': ['Firewall rules export', 'ACL configuration file', 'Security group settings'],
      'log': ['Training attendance logs', 'Signed acknowledgement forms', 'Audit trail records'],
      'screenshot': ['Network topology diagram', 'Data flow diagram', 'System configuration screenshot'],
      'document': ['Change tickets', 'CAB approval records', 'Responsibility Matrix']
    }
    return examples[evidenceType] || [evidenceName]
  }

  const getValidationCriteria = (evidenceType) => {
    const criteria = {
      'policy': [
        'Document must be dated within last 12 months',
        'Must include approval signatures',
        'Must reference PCI DSS 4.0 requirements',
        'Must define roles and responsibilities'
      ],
      'config': [
        'Export must be recent (within 30 days)',
        'Must show explicit deny rules',
        'Must restrict CDE access appropriately',
        'No overly permissive rules (e.g., any-any)'
      ],
      'log': [
        'Must include all relevant personnel',
        'Training date within last 12 months',
        'Must cover policy content'
      ],
      'screenshot': [
        'Must show all network segments',
        'Must indicate CDE boundaries',
        'Must show NSC placement points',
        'Must be dated within last 6 months'
      ],
      'document': [
        'All changes must be documented',
        'Must include approval workflow',
        'Must include rollback procedures'
      ]
    }
    return criteria[evidenceType] || ['Evidence must be current and relevant', 'Must demonstrate control implementation']
  }

  if (loading) return <div className="loading">Loading requirements...</div>

  return (
    <div className="requirements-page-v2">
      <div className="page-header-v2">
        <div className="header-content">
          <h1>PCI DSS v4.0 Requirements</h1>
          <p>12 core requirements with detailed sub-requirements and evidence tracking</p>
        </div>
        <div className="phase-filter-section">
          {currentPhase && (
            <div className="current-phase-info">
              <span className="phase-label">Current Phase:</span>
              <span className="phase-name">{currentPhase.name}</span>
            </div>
          )}
          <div className="filter-buttons">
            <button 
              className={`filter-btn ${phaseFilter === 'all' ? 'active' : ''}`}
              onClick={() => setPhaseFilter('all')}
            >
              All Requirements ({requirements.length})
            </button>
            <button 
              className={`filter-btn ${phaseFilter === 'current' ? 'active' : ''}`}
              onClick={() => setPhaseFilter('current')}
              disabled={getLinkedRequirementIds().length === 0}
            >
              Current Phase ({getLinkedRequirementIds().length})
            </button>
          </div>
        </div>
      </div>

      {phaseFilter === 'current' && getLinkedRequirementIds().length === 0 && (
        <div className="no-linked-requirements">
          <p>No requirements are linked to the current phase. Admin can configure phase requirements in the Admin panel.</p>
        </div>
      )}

      <div className="requirements-list-v2">
        {filteredRequirements.map((req) => (
          <div key={req.id} className="requirement-row">
            <div className="requirement-header-v2" onClick={() => toggleReq(req.id)}>
              <div className="req-number-circle">{req.req_number}</div>
              <div className="req-main-content">
                <div className="req-title-row">
                  <span className="req-title-text">{req.name}</span>
                  <span className="req-compliance-text">
                    {req.compliant_count}/{req.sub_requirements?.length || 0} compliant
                  </span>
                </div>
                <p className="req-description">{req.description}</p>
                <div className="req-progress-bar-v2">
                  <div 
                    className="req-progress-fill-v2" 
                    style={{ width: `${req.compliance_percentage || 0}%` }}
                  ></div>
                </div>
              </div>
              <div className="req-percentage">{req.compliance_percentage || 0}%</div>
              <span className="req-expand-icon">{expandedReq === req.id ? '∧' : '›'}</span>
            </div>

            {expandedReq === req.id && (
              <div className="sub-requirements-list">
                {req.sub_requirements.map((sub) => (
                  <div key={sub.id} className="sub-req-row">
                    <div className="sub-req-header-v2" onClick={() => toggleSubReq(sub.id)}>
                      <div className={`sub-req-indicator ${sub.compliance_status}`}>
                        {sub.compliance_status === 'compliant' ? '●' : '○'}
                      </div>
                      <div className="sub-req-content">
                        <div className="sub-req-title-row-v2">
                          <span className="sub-req-number-v2">Req {sub.sub_req_number}</span>
                          {getSubReqStatusBadge(sub)}
                          {getEvidenceNeededBadge(sub)}
                        </div>
                        <p className="sub-req-name-v2">{sub.name}</p>
                      </div>
                      <span className="sub-req-expand">{expandedSubReq === sub.id ? '∧' : '∨'}</span>
                    </div>

                    {expandedSubReq === sub.id && (
                      <div className="sub-req-detail-panel">
                        <div className="detail-description">
                          <p>All security policies and operational procedures must be documented and known to affected parties.</p>
                        </div>

                        <div className="testing-procedures-section">
                          <h4 className="section-title-icon">
                            <span className="icon-check">✓</span> Testing Procedures
                          </h4>
                          <ul className="testing-list">
                            {getTestingProcedures(sub.sub_req_number).map((proc, idx) => (
                              <li key={idx} className="testing-item">{proc}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="required-evidence-section">
                          <h4 className="section-title-icon">
                            <span className="icon-doc">📄</span> Required Evidence ({sub.required_evidence?.length || 0} types)
                          </h4>
                          
                          <div className="evidence-cards">
                            {sub.required_evidence.map((ev) => (
                              <div key={ev.id} className={`evidence-card ${ev.has_accepted ? 'completed' : ''}`}>
                                <div className="evidence-card-header">
                                  <div className="evidence-icon">📄</div>
                                  <div className="evidence-card-title">
                                    <h5>{ev.name}</h5>
                                    <p className="evidence-card-desc">{ev.description}</p>
                                  </div>
                                  
                                  {!ev.has_accepted && userRole === 'it_security' && (
                                    <div className="upload-btn-container">
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
                                        className="btn-upload-v2"
                                        disabled={uploading === ev.id}
                                        onClick={() => document.getElementById(`file-${ev.id}`).click()}
                                      >
                                        <span className="upload-icon">↑</span>
                                        {uploading === ev.id ? 'Uploading...' : 'Upload'}
                                      </button>
                                    </div>
                                  )}
                                  
                                  {ev.has_accepted && (
                                    <span className="evidence-uploaded-badge">✓ Uploaded</span>
                                  )}
                                </div>

                                <div className="evidence-examples">
                                  <span className="examples-label">◇ Examples:</span>
                                  <div className="example-tags">
                                    {getEvidenceExamples(ev.evidence_type, ev.name).slice(0, 3).map((ex, idx) => (
                                      <span key={idx} className="example-tag">{ex}</span>
                                    ))}
                                  </div>
                                </div>

                                <div className="validation-criteria">
                                  <span className="criteria-label">◎ Validation Criteria:</span>
                                  <ul className="criteria-list">
                                    {getValidationCriteria(ev.evidence_type).map((crit, idx) => (
                                      <li key={idx} className="criteria-item">◎ {crit}</li>
                                    ))}
                                  </ul>
                                </div>

                                {ev.submissions && ev.submissions.length > 0 && (
                                  <div className="submissions-section">
                                    <div className="submissions-header">
                                      <span className="submissions-count">📁 {ev.submissions.length} evidence item(s) uploaded</span>
                                    </div>
                                    {ev.submissions.map((submission) => (
                                      <div key={submission.id} className={`submission-row ${submission.status}`}>
                                        <div className="submission-file">
                                          <span className="file-icon">📎</span>
                                          <span className="file-name">{submission.file_name}</span>
                                          <span className="upload-date">
                                            by {submission.uploaded_by} on {new Date(submission.uploaded_at).toLocaleDateString()}
                                          </span>
                                        </div>
                                        <div className="submission-actions">
                                          {submission.status === 'pending_review' && userRole === 'auditor' && (
                                            <>
                                              <button 
                                                className="btn-accept-sm"
                                                onClick={() => handleReview(submission.id, 'accept')}
                                              >
                                                Accept
                                              </button>
                                              <button 
                                                className="btn-reject-sm"
                                                onClick={() => {
                                                  const notes = prompt('Rejection reason:')
                                                  if (notes) handleReview(submission.id, 'reject', notes)
                                                }}
                                              >
                                                Reject
                                              </button>
                                            </>
                                          )}
                                          {submission.status === 'accepted' && (
                                            <span className="status-accepted">✓ Accepted</span>
                                          )}
                                          {submission.status === 'rejected' && (
                                            <span className="status-rejected">✗ Rejected</span>
                                          )}
                                          {submission.status === 'pending_review' && userRole !== 'auditor' && (
                                            <span className="status-pending">⏳ Pending Review</span>
                                          )}
                                        </div>
                                        {submission.review_notes && (
                                          <div className="review-notes">
                                            <strong>Review Notes:</strong> {submission.review_notes}
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
