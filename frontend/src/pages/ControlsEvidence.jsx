import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'

function ControlsEvidence() {
  const [controls, setControls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedControl, setSelectedControl] = useState(null)
  const [gapData, setGapData] = useState(null)

  useEffect(() => {
    fetchControls()
  }, [])

  const fetchControls = async () => {
    try {
      const response = await axios.get('/api/controls/status')
      setControls(response.data)
      setLoading(false)
    } catch (err) {
      setError('Failed to load controls')
      setLoading(false)
    }
  }

  const openDrawer = async (control) => {
    setSelectedControl(control)
    try {
      const response = await axios.get(`/api/controls/${control.id}/gap`)
      setGapData(response.data)
    } catch (err) {
      console.error('Failed to load gap data', err)
    }
  }

  const closeDrawer = () => {
    setSelectedControl(null)
    setGapData(null)
  }

  const getEvidenceIcon = (type) => {
    const icons = {
      policy_doc: '📄',
      config_snapshot: '⚙️',
      log_sample: '📋',
      scan_report: '🔍',
      procedure_doc: '📝',
      certificate: '🔐',
      diagram: '📊',
      spreadsheet: '📈'
    }
    return icons[type] || '📎'
  }

  const formatEvidenceType = (type) => {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  }

  const getStatusClass = (status) => {
    switch (status) {
      case 'Complete': return 'status-complete'
      case 'Partial': return 'status-in-progress'
      default: return 'status-not-started'
    }
  }

  if (loading) return <div className="loading">Loading controls...</div>
  if (error) return <div className="error">{error}</div>

  return (
    <div>
      <h1 className="page-title">Controls & Evidence</h1>
      
      <div className="controls-table">
        <table>
          <thead>
            <tr>
              <th>Control</th>
              <th>PCI Requirement</th>
              <th>Description</th>
              <th>Required Evidence</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {controls.map((control) => (
              <tr key={control.id} onClick={() => openDrawer(control)}>
                <td>
                  <span className="control-name">{control.name}</span>
                </td>
                <td>
                  <span className="pci-requirement">{control.pci_requirement}</span>
                </td>
                <td>{control.description?.substring(0, 80)}...</td>
                <td>
                  <ul className="evidence-list">
                    {control.required_evidence.slice(0, 3).map((evidence) => (
                      <li key={evidence.id} className="evidence-item">
                        {getEvidenceIcon(evidence.evidence_type)} {evidence.evidence_name}
                      </li>
                    ))}
                    {control.required_evidence.length > 3 && (
                      <li className="evidence-item">+{control.required_evidence.length - 3} more</li>
                    )}
                  </ul>
                </td>
                <td>
                  <span className={`status-badge ${getStatusClass(control.status)}`}>
                    {control.status}
                  </span>
                  <div className="status-count">
                    {control.uploaded_count}/{control.required_count}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedControl && (
        <div className="drawer-overlay" onClick={closeDrawer}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <div className="drawer-title">{selectedControl.name}</div>
                <div className="drawer-subtitle">{selectedControl.pci_requirement}</div>
              </div>
              <button className="drawer-close" onClick={closeDrawer}>×</button>
            </div>
            <div className="drawer-content">
              <div className="drawer-section">
                <h3 className="drawer-section-title">Description</h3>
                <p className="drawer-description">{selectedControl.description}</p>
              </div>
              
              <div className="drawer-section">
                <div className="gap-summary">
                  <span className={`status-badge ${getStatusClass(selectedControl.status)}`}>
                    {selectedControl.status}
                  </span>
                  <span className="gap-count">
                    {selectedControl.uploaded_count} of {selectedControl.required_count} evidence items uploaded
                  </span>
                </div>
              </div>

              <div className="drawer-section">
                <h3 className="drawer-section-title">Evidence Status</h3>
                <ul className="drawer-evidence-list">
                  {gapData?.evidence_items.map((evidence) => (
                    <li key={evidence.id} className={`drawer-evidence-item ${!evidence.is_uploaded ? 'missing' : ''}`}>
                      <div className="evidence-icon">
                        {getEvidenceIcon(evidence.evidence_type)}
                      </div>
                      <div className="evidence-details">
                        <div className="evidence-name">{evidence.evidence_name}</div>
                        <div className="evidence-type">{formatEvidenceType(evidence.evidence_type)}</div>
                        {evidence.is_uploaded ? (
                          <div className="evidence-file">
                            <span className={`upload-status status-${evidence.upload_status?.toLowerCase()}`}>
                              {evidence.upload_status}
                            </span>
                            {evidence.uploaded_file}
                          </div>
                        ) : (
                          <div className="evidence-missing">Missing</div>
                        )}
                      </div>
                      {!evidence.is_uploaded && (
                        <Link 
                          to={`/upload-evidence?control=${selectedControl.id}&evidence=${evidence.id}`}
                          className="btn-upload-small"
                        >
                          Upload
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="drawer-section">
                <Link 
                  to={`/upload-evidence?control=${selectedControl.id}`} 
                  className="btn btn-primary"
                >
                  Go to Upload Evidence
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ControlsEvidence
