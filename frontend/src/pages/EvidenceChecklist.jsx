import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'

function EvidenceChecklist() {
  const [controls, setControls] = useState([])
  const [selectedControlId, setSelectedControlId] = useState(null)
  const [gapData, setGapData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchControls()
  }, [])

  useEffect(() => {
    if (selectedControlId) {
      fetchGapData(selectedControlId)
    }
  }, [selectedControlId])

  const fetchControls = async () => {
    try {
      const response = await axios.get('/api/controls/status')
      setControls(response.data)
      if (response.data.length > 0) {
        setSelectedControlId(response.data[0].id)
      }
      setLoading(false)
    } catch (err) {
      setError('Failed to load controls')
      setLoading(false)
    }
  }

  const fetchGapData = async (controlId) => {
    try {
      const response = await axios.get(`/api/controls/${controlId}/gap`)
      setGapData(response.data)
    } catch (err) {
      console.error('Failed to load gap data', err)
    }
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

  if (loading) return <div className="loading">Loading evidence checklist...</div>
  if (error) return <div className="error">{error}</div>

  const selectedControl = controls.find(c => c.id === selectedControlId)

  return (
    <div>
      <h1 className="page-title">Evidence Checklist</h1>
      
      <div className="checklist-container">
        <div className="control-selector">
          <label htmlFor="control-select">Select Control:</label>
          <select 
            id="control-select"
            value={selectedControlId || ''} 
            onChange={(e) => setSelectedControlId(Number(e.target.value))}
            className="control-dropdown"
          >
            {controls.map((control) => (
              <option key={control.id} value={control.id}>
                {control.name} ({control.status})
              </option>
            ))}
          </select>
        </div>

        {gapData && (
          <>
            <div className="gap-header">
              <div className="gap-header-info">
                <h2>{gapData.name}</h2>
                <span className="pci-requirement">{gapData.pci_requirement}</span>
              </div>
              <div className="gap-header-status">
                <span className={`status-badge ${getStatusClass(gapData.status)}`}>
                  {gapData.status}
                </span>
                <div className="gap-stats">
                  <div className="gap-stat">
                    <span className="gap-stat-value">{gapData.required_count}</span>
                    <span className="gap-stat-label">Required</span>
                  </div>
                  <div className="gap-stat">
                    <span className="gap-stat-value">{gapData.uploaded_count}</span>
                    <span className="gap-stat-label">Uploaded</span>
                  </div>
                  <div className="gap-stat missing">
                    <span className="gap-stat-value">{gapData.missing_count}</span>
                    <span className="gap-stat-label">Missing</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="checklist-comparison">
              <div className="checklist-column required">
                <h3 className="column-header">Required Evidence</h3>
                <ul className="checklist-items">
                  {gapData.evidence_items.map((item) => (
                    <li key={item.id} className={`checklist-item ${!item.is_uploaded ? 'missing' : ''}`}>
                      <div className="item-icon">{getEvidenceIcon(item.evidence_type)}</div>
                      <div className="item-content">
                        <div className="item-name">{item.evidence_name}</div>
                        <div className="item-type">{formatEvidenceType(item.evidence_type)}</div>
                      </div>
                      <div className="item-status">
                        {item.is_uploaded ? (
                          <span className="check-icon">✓</span>
                        ) : (
                          <span className="missing-icon">✗</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="checklist-column uploaded">
                <h3 className="column-header">Uploaded Evidence</h3>
                <ul className="checklist-items">
                  {gapData.evidence_items.map((item) => (
                    <li key={item.id} className={`checklist-item ${!item.is_uploaded ? 'missing' : ''}`}>
                      {item.is_uploaded ? (
                        <>
                          <div className="item-icon">📎</div>
                          <div className="item-content">
                            <div className="item-name">{item.uploaded_file}</div>
                            <div className={`item-upload-status status-${item.upload_status?.toLowerCase()}`}>
                              {item.upload_status}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="item-content missing-content">
                            <div className="missing-text">No file uploaded</div>
                            <Link 
                              to={`/upload-evidence?control=${selectedControlId}&evidence=${item.id}`}
                              className="btn-upload-inline"
                            >
                              Upload Missing Evidence
                            </Link>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default EvidenceChecklist
