import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../config/api'
import { useAuth } from '../context/AuthContext'

function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  
  const canApprovePhases = user?.role === 'admin' || user?.role === 'business_owner'
  const canUploadEvidence = user?.role === 'it_security'
  const canReviewEvidence = user?.role === 'infosec_team'
  const [phases, setPhases] = useState([])
  const [showRoleGuide, setShowRoleGuide] = useState(false)
  const [stats, setStats] = useState(null)
  const [requirements, setRequirements] = useState([])
  const [activeTab, setActiveTab] = useState('guided')
  const [loading, setLoading] = useState(true)
  const [expandedPhases, setExpandedPhases] = useState({})

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [phasesRes, statsRes, reqsRes] = await Promise.all([
        api.get('/phases'),
        api.get('/dashboard/stats'),
        api.get('/requirements')
      ])
      setPhases(phasesRes.data)
      setStats(statsRes.data)
      setRequirements(reqsRes.data)
      setLoading(false)
      
      // Auto-expand current phase
      const current = phasesRes.data.find(p => p.is_current)
      if (current) {
        setExpandedPhases({ [current.id]: true })
      }
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

  const setCurrentPhase = async (phaseId) => {
    try {
      await axios.patch(`/api/phases/${phaseId}/set-current`)
      fetchData()
    } catch (err) {
      console.error('Failed to set current phase:', err)
    }
  }

  const approvePhase = async () => {
    if (!currentPhase) return
    try {
      await axios.post(`/api/phases/${currentPhase.id}/approve`)
      fetchData()
    } catch (err) {
      console.error('Failed to approve phase:', err)
    }
  }

  const advanceToNextPhase = async () => {
    if (!currentPhase) return
    try {
      await axios.post(`/api/phases/${currentPhase.id}/advance`)
      fetchData()
    } catch (err) {
      console.error('Failed to advance to next phase:', err)
    }
  }

  const togglePhaseExpand = (phaseId) => {
    setExpandedPhases(prev => ({
      ...prev,
      [phaseId]: !prev[phaseId]
    }))
  }

  const currentPhase = phases.find(p => p.is_current)
  const completedTasks = currentPhase?.tasks?.filter(t => t.is_complete).length || 0
  const totalTasks = currentPhase?.tasks?.length || 0
  const allTasksComplete = completedTasks === totalTasks && totalTasks > 0

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

  const getPhaseStatus = (phase) => {
    const completed = phase.tasks?.filter(t => t.is_complete).length || 0
    const total = phase.tasks?.length || 0
    if (completed === total && total > 0) return 'complete'
    if (phase.is_current) return 'in_progress'
    if (completed > 0) return 'partial'
    return 'not_started'
  }

  const getComplianceColor = (percentage) => {
    if (percentage >= 80) return '#3fb950'
    if (percentage >= 50) return '#d29922'
    return '#f85149'
  }

  const getRoleActions = () => {
    const roleGuides = {
      admin: {
        title: 'Administrator',
        actions: [
          'Manage all phases, tasks, requirements, and users in Admin panel',
          'Configure which requirements must have evidence before phase approval',
          'Approve phases when all tasks complete and evidence is accepted',
          'View all evidence and compliance status (read-only)'
        ]
      },
      business_owner: {
        title: 'Business Owner',
        actions: [
          'Approve phases when all tasks complete and evidence is accepted',
          'Approve or reject residual risks in Risk Register',
          'Monitor overall compliance progress',
          'View all findings and requirements status (read-only)'
        ]
      },
      infosec_team: {
        title: 'Infosec Team',
        actions: [
          'Review and accept/reject evidence submissions in Requirements page',
          'Start remediation for findings when evidence is rejected',
          'Create and close findings manually',
          'Monitor compliance progress and gaps'
        ]
      },
      it_security: {
        title: 'IT Security',
        actions: [
          'Upload evidence for assigned requirements in Requirements page',
          'Complete assigned phase tasks',
          'View compliance status and findings',
          'Prepare and submit evidence documentation'
        ]
      },
      qsa_auditor: {
        title: 'QSA Auditor',
        actions: [
          'Monitor overall compliance readiness',
          'View all requirements and evidence status',
          'Review findings and compliance gaps',
          'Audit compliance documentation (read-only)'
        ]
      }
    }
    return roleGuides[user?.role] || roleGuides.it_security
  }

  const getEvidenceStatusForPhase = (phase) => {
    if (!phase.phase_requirements || phase.phase_requirements.length === 0) {
      return { status: 'no_requirements', message: 'No requirements linked', color: '#8b949e' }
    }
    
    let totalRequired = 0
    let totalAccepted = 0
    
    phase.phase_requirements.forEach(pr => {
      const req = requirements.find(r => r.id === pr.requirement_id)
      if (req) {
        req.sub_requirements?.forEach(sr => {
          sr.required_evidence?.forEach(re => {
            totalRequired++
            const accepted = re.submissions?.some(s => s.status === 'accepted')
            if (accepted) totalAccepted++
          })
        })
      }
    })
    
    if (totalRequired === 0) return { status: 'no_evidence', message: 'No evidence required', color: '#8b949e' }
    if (totalAccepted === totalRequired) return { status: 'complete', message: `${totalAccepted}/${totalRequired} evidence accepted`, color: '#3fb950' }
    if (totalAccepted > 0) return { status: 'partial', message: `${totalAccepted}/${totalRequired} evidence accepted`, color: '#d29922' }
    return { status: 'none', message: `0/${totalRequired} evidence accepted`, color: '#f85149' }
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
          <button className="btn-secondary" onClick={() => setShowRoleGuide(!showRoleGuide)}>
            <span className="btn-icon">&#128101;</span> {showRoleGuide ? 'Hide Guide' : 'My Role'}
          </button>
          <button className="btn-secondary">
            <span className="btn-icon">&#128196;</span> Generate ROC
          </button>
          <button className="btn-primary">
            <span className="btn-icon">&#128100;</span> QSA Portal
          </button>
        </div>
      </div>

      {showRoleGuide && (
        <div className="role-guide-banner">
          <div className="role-guide-header">
            <span className="role-badge">{getRoleActions().title}</span>
            <span className="role-username">{user?.username}</span>
          </div>
          <div className="role-guide-content">
            <h4>What You Can Do:</h4>
            <ul className="role-actions-list">
              {getRoleActions().actions.map((action, idx) => (
                <li key={idx}>{action}</li>
              ))}
            </ul>
          </div>
          <div className="role-guide-quicklinks">
            <span className="quicklink-label">Quick Actions:</span>
            {canUploadEvidence && (
              <button onClick={() => navigate('/requirements')} className="quicklink-btn">
                Upload Evidence
              </button>
            )}
            {canReviewEvidence && (
              <button onClick={() => navigate('/requirements')} className="quicklink-btn">
                Review Evidence
              </button>
            )}
            {canApprovePhases && (
              <button onClick={() => navigate('/risk-register')} className="quicklink-btn">
                Manage Risks
              </button>
            )}
            {user?.role === 'admin' && (
              <button onClick={() => navigate('/admin')} className="quicklink-btn">
                Admin Panel
              </button>
            )}
          </div>
        </div>
      )}

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
        <button className="tab" onClick={() => navigate('/requirements')}>Requirements</button>
        <button className="tab" onClick={() => navigate('/findings')}>Findings</button>
        <button className="tab" onClick={() => navigate('/risk-register')}>Risk Register</button>
      </div>

      <div className="dashboard-content">
        {activeTab === 'overview' ? (
          <div className="overview-content">
            <div className="overview-grid">
              <div className="timeline-section">
                <h3>Compliance Timeline</h3>
                <div className="timeline-list">
                  {phases.map((phase) => (
                    <div key={phase.id} className={`timeline-item ${getPhaseStatus(phase)}`}>
                      <div className="timeline-indicator">
                        {getPhaseStatus(phase) === 'complete' ? (
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
        ) : activeTab === 'phases' ? (
          <div className="phases-tab-content">
            <div className="phases-instruction-banner">
              <div className="instruction-icon">&#128221;</div>
              <div className="instruction-content">
                <h4>How Phase Progression Works</h4>
                <p>PCI DSS certification follows a 7-phase lifecycle. You must complete each phase in order:</p>
                <ol>
                  <li><strong>Complete Tasks</strong> - Check off all tasks in your current phase</li>
                  <li><strong>Advance</strong> - Click "Next Phase" button when all tasks are done</li>
                  <li><strong>Repeat</strong> - Continue through all 7 phases until certification</li>
                </ol>
              </div>
            </div>
            
            <div className="phases-progress-overview">
              <div className="progress-step-row">
                {phases.map((phase, idx) => (
                  <div key={phase.id} className={`progress-step ${getPhaseStatus(phase)} ${phase.is_current ? 'current' : ''}`}>
                    <div className="step-circle">
                      {getPhaseStatus(phase) === 'complete' ? '✓' : phase.phase_number}
                    </div>
                    {idx < phases.length - 1 && <div className="step-line"></div>}
                  </div>
                ))}
              </div>
              <div className="progress-labels">
                <span>Phase 1: Scope</span>
                <span>Phase 7: Continuous</span>
              </div>
            </div>
            
            <div className="phases-list-full">
              {phases.map((phase) => {
                const status = getPhaseStatus(phase)
                const isExpanded = expandedPhases[phase.id]
                const progress = getPhaseProgress(phase)
                
                return (
                  <div key={phase.id} className={`phase-card-full ${status} ${isExpanded ? 'expanded' : ''}`}>
                    <div 
                      className="phase-card-header"
                      onClick={() => togglePhaseExpand(phase.id)}
                    >
                      <div className="phase-indicator">
                        {status === 'complete' ? (
                          <span className="phase-check-icon">&#10003;</span>
                        ) : (
                          <span className="phase-number">{phase.phase_number}</span>
                        )}
                      </div>
                      <div className="phase-header-content">
                        <div className="phase-title-row">
                          <h3>Phase {phase.phase_number}: {phase.name}</h3>
                          {phase.is_current && <span className="current-badge">Current</span>}
                          {status === 'complete' && <span className="complete-badge">Complete</span>}
                        </div>
                        <p className="phase-description">{phase.description}</p>
                      </div>
                      <span className={`phase-expand-arrow ${isExpanded ? 'rotated' : ''}`}>&#9662;</span>
                    </div>
                    
                    {isExpanded && (
                      <div className="phase-card-body">
                        <div className="phase-section">
                          <h4>Key Tasks</h4>
                          <ul className="phase-tasks-list-items">
                            {phase.tasks?.map((task) => (
                              <li key={task.id} className={task.is_complete ? 'completed' : ''}>
                                <span className="task-bullet">{task.is_complete ? '✓' : '•'}</span>
                                <span className="task-text">{task.name}</span>
                              </li>
                            ))}
                            {(!phase.tasks || phase.tasks.length === 0) && (
                              <li className="no-items">No tasks defined for this phase</li>
                            )}
                          </ul>
                        </div>
                        
                        <div className="phase-section">
                          <h4>Deliverables</h4>
                          <div className="phase-deliverables">
                            {phase.deliverables?.map((del) => (
                              <span key={del.id} className="deliverable-tag">{del.name}</span>
                            ))}
                            {(!phase.deliverables || phase.deliverables.length === 0) && (
                              <span className="no-items">No deliverables defined</span>
                            )}
                          </div>
                        </div>

                        {!phase.is_current && status !== 'complete' && (
                          <button 
                            className="set-current-btn"
                            onClick={(e) => { e.stopPropagation(); setCurrentPhase(phase.id); }}
                          >
                            Set as Current Phase
                          </button>
                        )}
                        
                        {phase.is_current && allTasksComplete && phase.phase_number < 7 && (
                          <button 
                            className="advance-phase-btn"
                            onClick={(e) => { e.stopPropagation(); advanceToNextPhase(); }}
                          >
                            Advance to Phase {phase.phase_number + 1} &#8594;
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
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
                    className={`phase-nav-item ${phase.is_current ? 'active' : ''} ${getPhaseStatus(phase) === 'complete' ? 'completed' : ''}`}
                  >
                    <div className="phase-nav-indicator">
                      {getPhaseStatus(phase) === 'complete' ? (
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
          {!allTasksComplete && (
            <div className="workflow-tip-banner">
              <span className="tip-icon">&#128161;</span>
              <span><strong>Tip:</strong> Complete all tasks below. Once done, Admin or Business Owner approval is required before advancing.</span>
            </div>
          )}
          
          {allTasksComplete && currentPhase?.approval_status === 'pending_approval' && (
            <div className="workflow-approval-banner">
              <span className="approval-icon">&#128274;</span>
              <span><strong>Awaiting Approval:</strong> All tasks complete! Admin or Business Owner must approve before advancing to the next phase.</span>
              {currentPhase && (() => {
                const evidenceStatus = getEvidenceStatusForPhase(currentPhase)
                return evidenceStatus.status !== 'complete' && evidenceStatus.status !== 'no_requirements' && evidenceStatus.status !== 'no_evidence' ? (
                  <div className="evidence-gate-warning">
                    <span style={{color: evidenceStatus.color}}>{evidenceStatus.message}</span>
                    <button onClick={() => navigate('/requirements')} className="evidence-link-btn">
                      View Requirements
                    </button>
                  </div>
                ) : null
              })()}
            </div>
          )}
          
          {allTasksComplete && currentPhase?.approval_status === 'approved' && currentPhase?.phase_number < 7 && (
            <div className="workflow-success-banner">
              <span className="success-icon">&#127881;</span>
              <span><strong>Phase Approved!</strong> Click "Advance to Next Phase" to continue to Phase {currentPhase?.phase_number + 1}.</span>
            </div>
          )}
          
          <div className="phase-content-header">
            <div>
              <h2>{currentPhase?.name || 'Gap Assessment'}</h2>
              <p>
                {currentPhase?.approval_status === 'approved' 
                  ? 'Phase approved - ready to advance'
                  : currentPhase?.approval_status === 'pending_approval'
                  ? 'Tasks complete - awaiting Admin/Business Owner approval'
                  : 'Complete all tasks below to advance to the next phase'}
              </p>
              <div className="task-summary">
                <span className="task-complete">&#10003; {completedTasks} completed</span>
                <span className="task-remaining">&#9711; {totalTasks - completedTasks} remaining</span>
              </div>
            </div>
            <div className="phase-header-actions">
              <span className={`phase-status-badge ${currentPhase?.approval_status === 'approved' ? 'approved' : currentPhase?.approval_status === 'pending_approval' ? 'pending' : ''}`}>
                {currentPhase?.approval_status === 'approved' 
                  ? 'Approved' 
                  : currentPhase?.approval_status === 'pending_approval' 
                  ? 'Pending Approval' 
                  : allTasksComplete ? 'Complete' : 'In Progress'}
              </span>
              {allTasksComplete && currentPhase?.approval_status === 'pending_approval' && (
                canApprovePhases ? (
                  <button className="approve-btn" onClick={approvePhase}>
                    &#128274; Approve Phase
                  </button>
                ) : (
                  <span className="pending-note">Awaiting Admin/Business Owner approval</span>
                )
              )}
              {currentPhase?.approval_status === 'approved' && currentPhase?.phase_number < 7 && (
                <button className="advance-btn" onClick={advanceToNextPhase}>
                  Advance to Next Phase &#8594;
                </button>
              )}
            </div>
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

          {allTasksComplete && currentPhase?.deliverables?.length > 0 && (
            <div className="phase-deliverables">
              <h3>&#127942; Phase Deliverables</h3>
              <div className="deliverables-list">
                {currentPhase.deliverables.map(d => (
                  <div key={d.id} className="deliverable-item">
                    <span className="check">&#10003;</span>
                    {d.name}
                  </div>
                ))}
              </div>
              {currentPhase.approval_status === 'approved' && currentPhase.approved_by && (
                <div className="approval-info">
                  <span>&#128274;</span>
                  <span>Approved by <span className="approved-by">{currentPhase.approved_by}</span></span>
                  {currentPhase.approved_at && (
                    <span> on {new Date(currentPhase.approved_at).toLocaleDateString()}</span>
                  )}
                </div>
              )}
            </div>
          )}

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
