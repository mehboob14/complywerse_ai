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

  const getPhaseIcon = (status, isCurrent) => {
    if (status === 'complete') return <span className="phase-icon complete">&#10003;</span>
    if (isCurrent) return <span className="phase-icon current">{phases.find(p => p.is_current)?.phase_number}</span>
    return <span className="phase-icon pending">{phases.find(p => p.status === status)?.phase_number || '?'}</span>
  }

  if (loading) return <div className="loading">Loading dashboard...</div>

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1 className="page-title">PCI DSS Compliance Dashboard</h1>
        {stats && (
          <div className="stats-bar">
            <div className="stat-item">
              <span className="stat-value">{stats.overall_compliance}%</span>
              <span className="stat-label">Overall Compliance</span>
            </div>
            <div className="stat-item compliant">
              <span className="stat-value">{stats.compliant_requirements}</span>
              <span className="stat-label">Compliant</span>
            </div>
            <div className="stat-item partial">
              <span className="stat-value">{stats.partial_requirements}</span>
              <span className="stat-label">Partial</span>
            </div>
            <div className="stat-item not-started">
              <span className="stat-value">{stats.not_started_requirements}</span>
              <span className="stat-label">Not Started</span>
            </div>
          </div>
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
