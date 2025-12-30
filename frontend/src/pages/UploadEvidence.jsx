import { useSearchParams } from 'react-router-dom'

function UploadEvidence() {
  const [searchParams] = useSearchParams()
  const controlId = searchParams.get('control')

  return (
    <div>
      <h1 className="page-title">Upload Evidence</h1>
      <div className="page-placeholder">
        {controlId ? (
          <p>Upload evidence for Control ID: {controlId}</p>
        ) : (
          <p>Evidence upload functionality coming soon...</p>
        )}
      </div>
    </div>
  )
}

export default UploadEvidence
