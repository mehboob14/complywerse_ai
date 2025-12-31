import { useState, useEffect } from 'react'
import api from '../config/api'

function EvidenceComparison() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedReqs, setExpandedReqs] = useState({})
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    fetchComparison()
  }, [])

  const fetchComparison = async () => {
    try {
      const response = await api.get('/evidence/comparison')
      setData(response.data)
    } catch (error) {
      console.error('Error fetching comparison:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleReq = (reqId) => {
    setExpandedReqs(prev => ({ ...prev, [reqId]: !prev[reqId] }))
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'accepted': return 'green'
      case 'pending': return 'yellow'
      case 'rejected': return 'red'
      default: return 'gray'
    }
  }

  const getStatusLabel = (status) => {
    switch (status) {
      case 'accepted': return 'Accepted'
      case 'pending': return 'Pending Review'
      case 'rejected': return 'Rejected'
      default: return 'Not Uploaded'
    }
  }

  const filterEvidence = (evidence) => {
    if (filter === 'all') return true
    return evidence.status === filter
  }

  if (loading) {
    return <div className="loading">Loading evidence comparison...</div>
  }

  if (!data) {
    return <div className="error">Failed to load evidence data</div>
  }

  const { requirements, summary } = data

  return (
    <div className="evidence-comparison">
      <div className="comparison-header">
        <h1>Evidence Comparison</h1>
        <p>Required vs Uploaded Evidence Status</p>
      </div>

      <div className="comparison-summary">
        <div className="summary-card">
          <span className="summary-number">{summary.total_required}</span>
          <span className="summary-label">Total Required</span>
        </div>
        <div className="summary-card uploaded">
          <span className="summary-number">{summary.total_uploaded}</span>
          <span className="summary-label">Uploaded</span>
        </div>
        <div className="summary-card accepted">
          <span className="summary-number">{summary.total_accepted}</span>
          <span className="summary-label">Accepted</span>
        </div>
        <div className="summary-card pending">
          <span className="summary-number">{summary.total_pending}</span>
          <span className="summary-label">Pending</span>
        </div>
        <div className="summary-card rejected">
          <span className="summary-number">{summary.total_rejected}</span>
          <span className="summary-label">Rejected</span>
        </div>
        <div className="summary-card gap">
          <span className="summary-number">{summary.total_required - summary.total_uploaded}</span>
          <span className="summary-label">Not Uploaded</span>
        </div>
      </div>

      <div className="comparison-progress">
        <div className="progress-bar">
          <div className="progress-fill accepted" style={{ width: `${(summary.total_accepted / summary.total_required) * 100}%` }}></div>
          <div className="progress-fill pending" style={{ width: `${(summary.total_pending / summary.total_required) * 100}%` }}></div>
          <div className="progress-fill rejected" style={{ width: `${(summary.total_rejected / summary.total_required) * 100}%` }}></div>
        </div>
        <div className="progress-labels">
          <span>{Math.round((summary.total_accepted / summary.total_required) * 100)}% Complete</span>
        </div>
      </div>

      <div className="filter-bar">
        <label>Filter:</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All Evidence</option>
          <option value="not_uploaded">Not Uploaded</option>
          <option value="pending">Pending Review</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="requirements-list">
        {requirements.map(req => {
          const filteredSubs = req.sub_requirements.map(sub => ({
            ...sub,
            evidence: sub.evidence.filter(filterEvidence)
          })).filter(sub => sub.evidence.length > 0)

          if (filter !== 'all' && filteredSubs.length === 0) return null

          return (
            <div key={req.id} className="requirement-card">
              <div className="req-header" onClick={() => toggleReq(req.id)}>
                <div className="req-title">
                  <span className="req-number">Requirement {req.req_number}</span>
                  <span className="req-name">{req.name}</span>
                </div>
                <div className="req-stats">
                  <span className="stat accepted">{req.total_accepted} accepted</span>
                  <span className="stat pending">{req.total_pending} pending</span>
                  <span className="stat gap">{req.total_required - req.total_uploaded} missing</span>
                  <span className="expand-icon">{expandedReqs[req.id] ? '▼' : '▶'}</span>
                </div>
              </div>

              {expandedReqs[req.id] && (
                <div className="sub-requirements">
                  {(filter === 'all' ? req.sub_requirements : filteredSubs).map(sub => (
                    <div key={sub.id} className="sub-req">
                      <div className="sub-req-header">
                        <span className="sub-number">{sub.sub_req_number}</span>
                        <span className="sub-name">{sub.name}</span>
                      </div>
                      <div className="evidence-grid">
                        {(filter === 'all' ? sub.evidence : sub.evidence.filter(filterEvidence)).map(ev => (
                          <div key={ev.id} className={`evidence-card status-${ev.status}`}>
                            <div className="ev-header">
                              <span className="ev-name">{ev.name}</span>
                              <span className={`status-badge ${getStatusColor(ev.status)}`}>
                                {getStatusLabel(ev.status)}
                              </span>
                            </div>
                            <div className="ev-type">{ev.evidence_type}</div>
                            {ev.description && <div className="ev-desc">{ev.description}</div>}
                            {ev.latest_submission && (
                              <div className="submission-info">
                                <span>Uploaded: {ev.latest_submission.file_name}</span>
                                <span>By: {ev.latest_submission.uploaded_by}</span>
                                {ev.latest_submission.reviewed_by && (
                                  <span>Reviewed by: {ev.latest_submission.reviewed_by}</span>
                                )}
                                {ev.latest_submission.review_notes && (
                                  <span className="review-notes">Notes: {ev.latest_submission.review_notes}</span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default EvidenceComparison
