import { useState, useEffect } from 'react'
import axios from 'axios'

function Dashboard() {
  const [phases, setPhases] = useState([])
  const [stats, setStats] = useState(null)
  const [expandedPhase, setExpandedPhase] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [phasesRes, statsRes] = await Promise.all([
        axios.get('/api/phases'),
        axios.get('/api/dashboard/stats')
      ])
      setPhases(phasesRes.data)
      setStats(statsRes.data)
      const currentPhase = phasesRes.data.find(p => p.is_current)
      if (currentPhase) setExpandedPhase(currentPhase.id)
      setLoading(false)
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  const togglePhase = (phaseId) => {
    setExpandedPhase(expandedPhase === phaseId ? null : phaseId)
  }

  if (loading) return <div className="loading">Loading dashboard...</div>

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1 className="page-title">PCI DSS Compliance Dashboard</h1>
        
        {stats && (
          <>
            <div className="stats-row">
              <div className="stat-card main-stat">
                <div className="stat-circle" style={{background: `conic-gradient(#3fb950 ${stats.overall_compliance}%, #21262d ${stats.overall_compliance}%)`}}>
                  <div className="stat-circle-inner">
                    <span className="stat-percent">{stats.overall_compliance}%</span>
                  </div>
                </div>
                <div className="stat-label">Overall Compliance</div>
              </div>
              
              <div className="stat-card">
                <span className="stat-value compliant">{stats.compliant_count}</span>
                <span className="stat-label">Compliant</span>
              </div>
              <div className="stat-card">
                <span className="stat-value partial">{stats.partial_count}</span>
                <span className="stat-label">Partial</span>
              </div>
              <div className="stat-card">
                <span className="stat-value not-started">{stats.not_started_count}</span>
                <span className="stat-label">Not Started</span>
              </div>
            </div>

            <div className="evidence-stats">
              <h3>Evidence Collection Progress</h3>
              <div className="evidence-bar-container">
                <div className="evidence-bar">
                  <div className="evidence-bar-fill accepted" style={{width: `${(stats.total_evidence_accepted / stats.total_evidence_required) * 100}%`}}></div>
                  <div className="evidence-bar-fill pending" style={{width: `${(stats.total_evidence_pending / stats.total_evidence_required) * 100}%`, left: `${(stats.total_evidence_accepted / stats.total_evidence_required) * 100}%`}}></div>
                </div>
                <div className="evidence-legend">
                  <span><span className="legend-dot accepted"></span>Accepted: {stats.total_evidence_accepted}</span>
                  <span><span className="legend-dot pending"></span>Pending Review: {stats.total_evidence_pending}</span>
                  <span><span className="legend-dot rejected"></span>Rejected: {stats.total_evidence_rejected}</span>
                  <span><span className="legend-dot required"></span>Required: {stats.total_evidence_required}</span>
                </div>
              </div>
            </div>

            <div className="workflow-stats">
              <div className="workflow-stat">
                <div className="workflow-stat-icon findings">!</div>
                <div className="workflow-stat-info">
                  <span className="workflow-stat-value">{stats.open_findings}</span>
                  <span className="workflow-stat-label">Open Findings</span>
                </div>
              </div>
              <div className="workflow-stat">
                <div className="workflow-stat-icon closed">&#10003;</div>
                <div className="workflow-stat-info">
                  <span className="workflow-stat-value">{stats.closed_findings}</span>
                  <span className="workflow-stat-label">Closed Findings</span>
                </div>
              </div>
              <div className="workflow-stat">
                <div className="workflow-stat-icon risks">&#9888;</div>
                <div className="workflow-stat-info">
                  <span className="workflow-stat-value">{stats.pending_risks}</span>
                  <span className="workflow-stat-label">Pending Risks</span>
                </div>
              </div>
              <div className="workflow-stat">
                <div className="workflow-stat-icon approved">&#10003;</div>
                <div className="workflow-stat-info">
                  <span className="workflow-stat-value">{stats.approved_risks}</span>
                  <span className="workflow-stat-label">Approved Risks</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <section className="phases-section">
        <h2 className="section-title">Compliance Lifecycle Phases</h2>
        <div className="phases-list">
          {phases.map((phase) => (
            <div key={phase.id} className={`phase-card ${phase.is_current ? 'current' : ''} ${phase.status}`}>
              <div className="phase-header" onClick={() => togglePhase(phase.id)}>
                <div className="phase-number-badge" data-status={phase.status}>
                  {phase.status === 'complete' ? '✓' : phase.phase_number}
                </div>
                <div className="phase-info">
                  <div className="phase-title">
                    Phase {phase.phase_number}: {phase.name}
                    {phase.is_current && <span className="current-badge">Current</span>}
                  </div>
                  <div className="phase-description">{phase.description}</div>
                </div>
                <span className="phase-chevron">{expandedPhase === phase.id ? '▲' : '▼'}</span>
              </div>
              
              {expandedPhase === phase.id && (
                <div className="phase-details">
                  <div className="phase-tasks">
                    <h4>Key Tasks</h4>
                    <ul>
                      {phase.tasks.map((task) => (
                        <li key={task.id} className={task.is_complete ? 'complete' : ''}>
                          <span className="task-bullet">•</span>
                          {task.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="phase-deliverables">
                    <h4>Deliverables</h4>
                    <div className="deliverables-list">
                      {phase.deliverables.map((d) => (
                        <span key={d.id} className="deliverable-tag">{d.name}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default Dashboard
