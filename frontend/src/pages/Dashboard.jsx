import { useState, useEffect } from 'react'
import axios from 'axios'

function Dashboard() {
  const [phases, setPhases] = useState([])
  const [stats, setStats] = useState(null)
  const [requirements, setRequirements] = useState([])
  const [activeTab, setActiveTab] = useState('guided')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [phasesRes, statsRes, reqsRes] = await Promise.all([
        axios.get('/api/phases'),
        axios.get('/api/dashboard/stats'),
        axios.get('/api/requirements')
      ])
      setPhases(phasesRes.data)
      setStats(statsRes.data)
      setRequirements(reqsRes.data)
      setLoading(false)
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  const toggleTask = async (taskId) => {
    try {
      await axios.patch(`/api/tasks/${taskId}/toggle`)
      fetchData()
    } catch (err) {
      console.error('Failed to toggle task:', err)
    }
  }

  const currentPhase = phases.find(p => p.is_current)
  const completedTasks = currentPhase?.tasks?.filter(t => t.is_complete).length || 0
  const totalTasks = currentPhase?.tasks?.length || 0

  const getPhaseProgress = (phase) => {
    const completedTasks = phase.tasks?.filter(t => t.is_complete).length || 0
    const totalTasks = phase.tasks?.length || 1
    return Math.round((completedTasks / totalTasks) * 100)
  }

  const getPhaseTaskSummary = (phase) => {
    const completed = phase.tasks?.filter(t => t.is_complete).length || 0
    const total = phase.tasks?.length || 0
    return `${completed}/${total}`
  }

  const getComplianceColor = (percentage) => {
    if (percentage >= 80) return '#3fb950'
    if (percentage >= 50) return '#d29922'
    return '#f85149'
  }

  if (loading) return <div className="loading">Loading dashboard...</div>

  const compliancePercent = stats?.overall_compliance || 0
  const complianceColor = getComplianceColor(compliancePercent)

  return (
    <div className="dashboard-new">
      <div className="dashboard-top-bar">
        <div className="dashboard-title-section">
          <h1>PCI-DSS Compliance</h1>
          <p className="subtitle">Payment Card Industry Data Security Standard certification</p>
        </div>
        <div className="dashboard-actions">
          <button className="btn-secondary">
            <span className="btn-icon">&#128196;</span> Generate ROC
          </button>
          <button className="btn-primary">
            <span className="btn-icon">&#128100;</span> QSA Portal
          </button>
        </div>
      </div>

      <div className="metrics-row">
        <div className="metric-card main-metric">
          <div className="compliance-gauge">
            <svg viewBox="0 0 100 100" className="gauge-svg">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#21262d" strokeWidth="8" />
              <circle 
                cx="50" 
                cy="50" 
                r="40" 
                fill="none" 
                stroke={complianceColor}
                strokeWidth="8"
                strokeDasharray={`${compliancePercent * 2.51} 251`}
                strokeLinecap="round"
                transform="rotate(-90 50 50)"
              />
            </svg>
            <div className="gauge-center">
              <span className="gauge-value" style={{color: complianceColor}}>{compliancePercent}%</span>
            </div>
          </div>
          <div className="metric-label">Compliance Readiness</div>
          <div className="metric-sublabel">PCI DSS v4.0</div>
        </div>

        <div className="metric-card">
          <div className="metric-icon phase-icon">&#9679;</div>
          <div className="metric-content">
            <div className="metric-header">Current Phase</div>
            <div className="metric-value-text">Phase {currentPhase?.phase_number || 1}</div>
            <div className="metric-description">{currentPhase?.name || 'Loading...'}</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon systems-icon">&#9632;</div>
          <div className="metric-content">
            <div className="metric-header">CDE Systems</div>
            <div className="metric-value-large">{stats?.cde_systems_count || 0}</div>
            <div className="metric-description">In-scope systems</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon vuln-icon">&#9888;</div>
          <div className="metric-content">
            <div className="metric-header">Open Findings</div>
            <div className="metric-value-large danger">{stats?.open_findings || 0}</div>
            <div className="metric-description">Requires attention</div>
          </div>
        </div>
      </div>

      <div className="dashboard-tabs">
        <button className={`tab ${activeTab === 'guided' ? 'active' : ''}`} onClick={() => setActiveTab('guided')}>Guided Workflow</button>
        <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
        <button className={`tab ${activeTab === 'phases' ? 'active' : ''}`} onClick={() => setActiveTab('phases')}>Phases</button>
        <button className={`tab ${activeTab === 'requirements' ? 'active' : ''}`} onClick={() => setActiveTab('requirements')}>Requirements</button>
        <button className={`tab ${activeTab === 'cde' ? 'active' : ''}`} onClick={() => setActiveTab('cde')}>CDE Scoping</button>
        <button className={`tab ${activeTab === 'security' ? 'active' : ''}`} onClick={() => setActiveTab('security')}>Security Testing</button>
      </div>

      <div className="dashboard-content">
        {activeTab === 'overview' ? (
          <div className="overview-content">
            <div className="overview-grid">
              <div className="timeline-section">
                <h3>Compliance Timeline</h3>
                <div className="timeline-list">
                  {phases.map((phase) => (
                    <div key={phase.id} className={`timeline-item ${phase.status}`}>
                      <div className="timeline-indicator">
                        {phase.status === 'complete' ? (
                          <span className="timeline-check">&#10003;</span>
                        ) : phase.is_current ? (
                          <span className="timeline-current">&#9679;</span>
                        ) : (
                          <span className="timeline-pending">&#9675;</span>
                        )}
                      </div>
                      <div className="timeline-label">
                        Phase {phase.phase_number}: {phase.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="key-metrics-section">
                <h3>Key Metrics</h3>
                <div className="key-metrics-list">
                  <div className="key-metric-row">
                    <span className="key-metric-label">Requirements Met</span>
                    <span className="key-metric-value">{stats?.requirements_met || 0}/{stats?.total_requirements || 0}</span>
                  </div>
                  <div className="key-metric-row">
                    <span className="key-metric-label">ASV Scans (Quarter)</span>
                    <span className="key-metric-value">{stats?.asv_scans_completed || 0}/{stats?.asv_scans_required || 4}</span>
                  </div>
                  <div className="key-metric-row">
                    <span className="key-metric-label">Pen Tests (Annual)</span>
                    <span className="key-metric-value">{stats?.pen_tests_completed || 0}/{stats?.pen_tests_required || 2}</span>
                  </div>
                  <div className="key-metric-row">
                    <span className="key-metric-label">Evidence Items</span>
                    <span className="key-metric-value">{stats?.total_evidence_accepted || 0}/{stats?.total_evidence_required || 0}</span>
                  </div>
                  <div className="key-metric-row">
                    <span className="key-metric-label">Last Assessment</span>
                    <span className="key-metric-value">{stats?.last_assessment_date || 'N/A'}</span>
                  </div>
                  <div className="key-metric-row">
                    <span className="key-metric-label">CDE Systems</span>
                    <span className="key-metric-value">{stats?.cde_systems_count || 0}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <aside className="phases-sidebar">
              <h3>Certification Phases</h3>
              <div className="phase-progress-summary">
                {completedTasks} of {totalTasks} tasks completed
              </div>
              <div className="phase-progress-bar">
                <div className="phase-progress-fill" style={{width: `${totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0}%`}}></div>
              </div>
              
              <div className="phases-nav">
                {phases.map((phase) => (
                  <div 
                    key={phase.id} 
                    className={`phase-nav-item ${phase.is_current ? 'active' : ''} ${phase.status === 'complete' ? 'completed' : ''}`}
                  >
                    <div className="phase-nav-indicator">
                      {phase.status === 'complete' ? (
                        <span className="check-icon">&#10003;</span>
                      ) : phase.is_current ? (
                        <span className="active-dot"></span>
                      ) : (
                        <span className="empty-dot"></span>
                      )}
                    </div>
                    <div className="phase-nav-content">
                      <div className="phase-nav-name">{phase.name}</div>
                      {phase.is_current && <span className="active-badge">Active</span>}
                      <div className="phase-nav-progress">
                        <div className="mini-progress-bar">
                          <div className="mini-progress-fill" style={{width: `${getPhaseProgress(phase)}%`}}></div>
                        </div>
                        <span className="task-count">{getPhaseTaskSummary(phase)}</span>
                      </div>
                    </div>
                    <span className="phase-nav-arrow">&#8250;</span>
                  </div>
                ))}
              </div>
            </aside>

            <main className="phase-content">
          <div className="phase-content-header">
            <div>
              <h2>{currentPhase?.name || 'Gap Assessment'}</h2>
              <p>Complete all tasks below to advance to the next phase</p>
              <div className="task-summary">
                <span className="task-complete">&#10003; {completedTasks} completed</span>
                <span className="task-remaining">&#9711; {totalTasks - completedTasks} remaining</span>
              </div>
            </div>
            <span className="phase-status-badge">In Progress</span>
          </div>

          <div className="phase-tasks-list">
            {currentPhase?.tasks?.map((task, index) => {
              const taskCategories = {
                'Gap Assessment': ['Assessment Tasks', 'Documentation Review', 'Control Evaluation'],
                'PCI Scope Definition': ['Scope Analysis', 'System Inventory', 'Data Flow Mapping'],
                'Control Implementation': ['Security Controls', 'Access Management', 'Network Security'],
                'Evidence Collection': ['Documentation', 'Logs & Records', 'Policies'],
                'Vulnerability & Penetration Testing': ['Scanning', 'Penetration Tests', 'Remediation'],
                'Compliance Validation': ['Final Review', 'Validation', 'Sign-off'],
                'Continuous Compliance': ['Monitoring', 'Maintenance', 'Updates']
              }
              const categories = taskCategories[currentPhase?.name] || ['Phase Tasks']
              const category = categories[index % categories.length]
              const showCategory = index === 0 || index % 3 === 0

              return (
                <div key={task.id} className="requirement-section">
                  {showCategory && <h3 className="section-category">{category}</h3>}
                  <div className={`assessment-task ${task.is_complete ? 'completed' : ''}`}>
                    <div className="task-checkbox">
                      <input 
                        type="checkbox" 
                        checked={task.is_complete} 
                        onChange={() => toggleTask(task.id)}
                      />
                    </div>
                    <div className="task-info">
                      <div className="task-title-row">
                        <span className={`task-title ${task.is_complete ? 'completed' : ''}`}>{task.name}</span>
                        <span className="task-id">TASK-{String(task.id).padStart(2, '0')}</span>
                        {!task.is_complete && <span className="evidence-required-badge">Action Required</span>}
                        {task.is_complete && <span className="task-complete-badge">Completed</span>}
                      </div>
                      <p className="task-description">
                        {task.is_complete 
                          ? 'This task has been completed successfully.'
                          : 'Click the checkbox to mark this task as complete.'}
                      </p>
                      <a href="/requirements" className="task-link">
                        &#8634; View related requirements and evidence
                      </a>
                    </div>
                    <div className="task-progress-circle">
                      <svg viewBox="0 0 36 36" className="progress-ring">
                        <circle cx="18" cy="18" r="16" fill="none" stroke="#21262d" strokeWidth="2" />
                        <circle 
                          cx="18" 
                          cy="18" 
                          r="16" 
                          fill="none" 
                          stroke={task.is_complete ? "#3fb950" : "#8b949e"} 
                          strokeWidth="2"
                          strokeDasharray={task.is_complete ? "100 100" : "0 100"}
                          strokeLinecap="round"
                          transform="rotate(-90 18 18)"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              )
            })}

            {(!currentPhase?.tasks || currentPhase.tasks.length === 0) && (
              <div className="empty-state">
                <div className="empty-icon">&#128203;</div>
                <h3>No Tasks Found</h3>
                <p>Tasks for this phase will appear here once configured.</p>
              </div>
            )}
          </div>

          <div className="requirements-preview">
            <h3 className="section-category" style={{marginTop: '2rem'}}>Related Requirements</h3>
            {requirements.slice(0, 3).map((req) => {
              const totalEvidence = req.sub_requirements?.reduce((acc, sub) => acc + sub.total_required, 0) || 0
              const acceptedEvidence = req.sub_requirements?.reduce((acc, sub) => acc + sub.total_accepted, 0) || 0
              const progress = totalEvidence > 0 ? (acceptedEvidence / totalEvidence) * 100 : 0

              return (
                <div key={req.id} className="assessment-task" style={{marginBottom: '0.75rem'}}>
                  <div className="task-checkbox">
                    <input type="checkbox" checked={acceptedEvidence === totalEvidence && totalEvidence > 0} readOnly />
                  </div>
                  <div className="task-info">
                    <div className="task-title-row">
                      <span className="task-title">Requirement {req.req_number}: {req.name}</span>
                      <span className="task-id">PCI-{String(req.req_number).padStart(2, '0')}</span>
                      <span className="evidence-progress-badge">{acceptedEvidence}/{totalEvidence} evidence</span>
                    </div>
                    <p className="task-description">{req.description}</p>
                  </div>
                  <div className="task-progress-circle">
                    <svg viewBox="0 0 36 36" className="progress-ring">
                      <circle cx="18" cy="18" r="16" fill="none" stroke="#21262d" strokeWidth="2" />
                      <circle 
                        cx="18" cy="18" r="16" fill="none" 
                        stroke={progress === 100 ? "#3fb950" : progress > 0 ? "#d29922" : "#8b949e"} 
                        strokeWidth="2"
                        strokeDasharray={`${progress} 100`}
                        strokeLinecap="round" transform="rotate(-90 18 18)"
                      />
                    </svg>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="evidence-summary" style={{marginTop: '2rem', padding: '1rem', background: '#0d1117', borderRadius: '8px', border: '1px solid #30363d'}}>
            <h3 className="section-category">Evidence Collection Status</h3>
            <div style={{display: 'flex', gap: '2rem', flexWrap: 'wrap', marginTop: '1rem'}}>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '1.5rem', fontWeight: '700', color: '#3fb950'}}>{stats?.total_evidence_accepted || 0}</div>
                <div style={{fontSize: '0.8rem', color: '#8b949e'}}>Accepted</div>
              </div>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '1.5rem', fontWeight: '700', color: '#d29922'}}>{stats?.total_evidence_pending || 0}</div>
                <div style={{fontSize: '0.8rem', color: '#8b949e'}}>Pending Review</div>
              </div>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '1.5rem', fontWeight: '700', color: '#f85149'}}>{stats?.total_evidence_rejected || 0}</div>
                <div style={{fontSize: '0.8rem', color: '#8b949e'}}>Rejected</div>
              </div>
              <div style={{textAlign: 'center'}}>
                <div style={{fontSize: '1.5rem', fontWeight: '700', color: '#8b949e'}}>{stats?.total_evidence_required || 0}</div>
                <div style={{fontSize: '0.8rem', color: '#8b949e'}}>Total Required</div>
              </div>
            </div>
          </div>
        </main>
          </>
        )}
      </div>
    </div>
  )
}

export default Dashboard
