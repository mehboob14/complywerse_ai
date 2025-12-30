import { useState, useEffect } from 'react'
import axios from 'axios'

function Findings() {
  const [findings, setFindings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchFindings()
  }, [])

  const fetchFindings = async () => {
    try {
      const response = await axios.get('/api/findings')
      setFindings(response.data)
      setLoading(false)
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  if (loading) return <div className="loading">Loading findings...</div>

  return (
    <div className="findings-page">
      <h1 className="page-title">Findings</h1>
      <p className="page-subtitle">Track and remediate compliance gaps</p>

      {findings.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">&#128269;</div>
          <h3>No Findings Yet</h3>
          <p>Findings will appear here when evidence is rejected during the audit process.</p>
        </div>
      ) : (
        <div className="findings-list">
          {findings.map((finding) => (
            <div key={finding.id} className={`finding-card ${finding.status}`}>
              <div className="finding-header">
                <span className={`severity-badge ${finding.severity}`}>{finding.severity}</span>
                <span className={`status-badge ${finding.status}`}>{finding.status}</span>
              </div>
              <h3 className="finding-title">{finding.title}</h3>
              <p className="finding-description">{finding.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Findings
