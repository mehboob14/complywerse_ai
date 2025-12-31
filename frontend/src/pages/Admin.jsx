import { useState, useEffect } from 'react'
import api from '../config/api'
import { useAuth } from '../context/AuthContext'

function Admin() {
  const { user, isAdmin } = useAuth()
  const [activeTab, setActiveTab] = useState('phases')
  const [phases, setPhases] = useState([])
  const [requirements, setRequirements] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingItem, setEditingItem] = useState(null)
  const [parentItem, setParentItem] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [modalType, setModalType] = useState('')
  const [formData, setFormData] = useState({})
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchData()
  }, [activeTab])

  const fetchData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'phases') {
        const response = await api.get('/phases')
        setPhases(response.data)
      } else if (activeTab === 'requirements') {
        const response = await api.get('/requirements')
        setRequirements(response.data)
      } else if (activeTab === 'users') {
        const response = await api.get('/users')
        setUsers(response.data)
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const openModal = (type, item = null, parent = null) => {
    setModalType(type)
    setEditingItem(item)
    setParentItem(parent)
    
    if (type === 'phase') {
      setFormData(item ? { phase_number: item.phase_number, name: item.name, description: item.description || '' } : { phase_number: '', name: '', description: '' })
    } else if (type === 'task') {
      setFormData(item ? { id: item.id, name: item.name, phase_id: parent?.id } : { name: '', phase_id: parent?.id })
    } else if (type === 'deliverable') {
      setFormData(item ? { id: item.id, name: item.name, phase_id: parent?.id } : { name: '', phase_id: parent?.id })
    } else if (type === 'requirement') {
      setFormData(item ? { req_number: item.req_number, name: item.name, description: item.description || '' } : { req_number: '', name: '', description: '' })
    } else if (type === 'sub_requirement') {
      setFormData(item ? { id: item.id, sub_req_number: item.sub_req_number, name: item.name, requirement_id: parent?.id } : { sub_req_number: '', name: '', requirement_id: parent?.id })
    } else if (type === 'evidence') {
      setFormData(item ? { id: item.id, name: item.name, description: item.description || '', evidence_type: item.evidence_type, sub_requirement_id: parent?.id } : { name: '', description: '', evidence_type: 'document', sub_requirement_id: parent?.id })
    } else if (type === 'user') {
      setFormData(item ? { id: item.id, username: item.username, email: item.email, role: item.role, display_name: item.display_name, is_active: item.is_active } : { username: '', email: '', password: '', role: 'it_security', display_name: '' })
    } else if (type === 'phase_requirement') {
      setFormData({ phase_id: parent?.id, requirement_id: '' })
      if (requirements.length === 0) {
        axios.get('/api/requirements').then(res => setRequirements(res.data))
      }
    }
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingItem(null)
    setParentItem(null)
    setFormData({})
  }

  const showMessage = (msg) => {
    setMessage(msg)
    setTimeout(() => setMessage(''), 3000)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (modalType === 'phase') {
        if (editingItem) {
          await axios.put(`/api/admin/phases/${editingItem.id}`, formData)
          showMessage('Phase updated successfully')
        } else {
          await axios.post('/api/admin/phases', formData)
          showMessage('Phase created successfully')
        }
      } else if (modalType === 'task') {
        if (editingItem) {
          await axios.put(`/api/admin/tasks/${editingItem.id}`, { name: formData.name })
          showMessage('Task updated successfully')
        } else {
          await axios.post(`/api/admin/phases/${formData.phase_id}/tasks`, { name: formData.name })
          showMessage('Task created successfully')
        }
      } else if (modalType === 'deliverable') {
        if (editingItem) {
          await axios.put(`/api/admin/deliverables/${editingItem.id}`, { name: formData.name })
          showMessage('Deliverable updated successfully')
        } else {
          await axios.post(`/api/admin/phases/${formData.phase_id}/deliverables`, { name: formData.name })
          showMessage('Deliverable created successfully')
        }
      } else if (modalType === 'requirement') {
        if (editingItem) {
          await axios.put(`/api/admin/requirements/${editingItem.id}`, formData)
          showMessage('Requirement updated successfully')
        } else {
          await axios.post('/api/admin/requirements', formData)
          showMessage('Requirement created successfully')
        }
      } else if (modalType === 'sub_requirement') {
        if (editingItem) {
          await axios.put(`/api/admin/sub-requirements/${editingItem.id}`, {
            sub_req_number: formData.sub_req_number,
            name: formData.name
          })
          showMessage('Sub-requirement updated successfully')
        } else {
          await axios.post(`/api/admin/requirements/${formData.requirement_id}/sub-requirements`, {
            sub_req_number: formData.sub_req_number,
            name: formData.name
          })
          showMessage('Sub-requirement created successfully')
        }
      } else if (modalType === 'evidence') {
        if (editingItem) {
          await axios.put(`/api/admin/evidence/${editingItem.id}`, {
            name: formData.name,
            description: formData.description,
            evidence_type: formData.evidence_type
          })
          showMessage('Required evidence updated successfully')
        } else {
          await axios.post(`/api/admin/sub-requirements/${formData.sub_requirement_id}/evidence`, {
            name: formData.name,
            description: formData.description,
            evidence_type: formData.evidence_type
          })
          showMessage('Required evidence created successfully')
        }
      } else if (modalType === 'user') {
        if (editingItem) {
          const updateData = {
            email: formData.email,
            role: formData.role,
            display_name: formData.display_name,
            is_active: formData.is_active
          }
          await axios.patch(`/api/users/${editingItem.id}`, updateData, { withCredentials: true })
          showMessage('User updated successfully')
        } else {
          await axios.post('/api/users', formData, { withCredentials: true })
          showMessage('User created successfully')
        }
      } else if (modalType === 'phase_requirement') {
        await axios.post(`/api/admin/phases/${formData.phase_id}/requirements`, {
          requirement_id: parseInt(formData.requirement_id)
        }, { withCredentials: true })
        showMessage('Requirement linked to phase')
      }
      closeModal()
      fetchData()
    } catch (error) {
      showMessage('Error: ' + (error.response?.data?.detail || 'Operation failed'))
    }
  }

  const handleDelete = async (type, id) => {
    if (!confirm('Are you sure you want to delete this item?')) return
    try {
      if (type === 'phase') {
        await axios.delete(`/api/admin/phases/${id}`)
      } else if (type === 'task') {
        await axios.delete(`/api/admin/tasks/${id}`)
      } else if (type === 'deliverable') {
        await axios.delete(`/api/admin/deliverables/${id}`)
      } else if (type === 'requirement') {
        await axios.delete(`/api/admin/requirements/${id}`)
      } else if (type === 'sub_requirement') {
        await axios.delete(`/api/admin/sub-requirements/${id}`)
      } else if (type === 'evidence') {
        await axios.delete(`/api/admin/evidence/${id}`)
      } else if (type === 'user') {
        await axios.delete(`/api/users/${id}`, { withCredentials: true })
      }
      showMessage('Deleted successfully')
      fetchData()
    } catch (error) {
      showMessage('Error: ' + (error.response?.data?.detail || 'Delete failed'))
    }
  }

  const handleUnlinkRequirement = async (phaseId, requirementId) => {
    if (!confirm('Remove this requirement from the phase?')) return
    try {
      await axios.delete(`/api/admin/phases/${phaseId}/requirements/${requirementId}`, { withCredentials: true })
      showMessage('Requirement unlinked from phase')
      fetchData()
    } catch (error) {
      showMessage('Error: ' + (error.response?.data?.detail || 'Unlink failed'))
    }
  }

  const roleLabels = {
    admin: 'Administrator',
    infosec_team: 'Infosec Team',
    qsa_auditor: 'QSA Auditor',
    business_owner: 'Business Owner',
    it_security: 'IT Security'
  }

  if (!isAdmin()) {
    return (
      <div className="admin-container">
        <div className="access-denied">
          <h2>Access Denied</h2>
          <p>You need administrator privileges to access this page.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>Admin Panel</h1>
        <p>Manage phases, tasks, requirements, evidence, and users</p>
      </div>

      {message && <div className="admin-message">{message}</div>}

      <div className="admin-tabs">
        <button className={activeTab === 'phases' ? 'active' : ''} onClick={() => setActiveTab('phases')}>
          Phases & Tasks
        </button>
        <button className={activeTab === 'requirements' ? 'active' : ''} onClick={() => setActiveTab('requirements')}>
          Requirements & Evidence
        </button>
        <button className={activeTab === 'users' ? 'active' : ''} onClick={() => setActiveTab('users')}>
          Users
        </button>
      </div>

      <div className="admin-content">
        {loading ? (
          <div className="loading">Loading...</div>
        ) : activeTab === 'phases' ? (
          <div className="phases-admin">
            <div className="admin-toolbar">
              <button className="add-btn" onClick={() => openModal('phase')}>+ Add Phase</button>
            </div>
            {phases.map(phase => (
              <div key={phase.id} className="admin-card">
                <div className="admin-card-header">
                  <h3>Phase {phase.phase_number}: {phase.name}</h3>
                  <div className="admin-actions">
                    <button onClick={() => openModal('phase', phase)}>Edit</button>
                    <button className="delete" onClick={() => handleDelete('phase', phase.id)}>Delete</button>
                  </div>
                </div>
                <p className="admin-description">{phase.description}</p>
                
                <div className="admin-section">
                  <div className="section-header">
                    <h4>Tasks ({phase.tasks?.length || 0})</h4>
                    <button className="small-btn" onClick={() => openModal('task', null, phase)}>+ Add Task</button>
                  </div>
                  <ul className="admin-list">
                    {phase.tasks?.map(task => (
                      <li key={task.id}>
                        <span>{task.name}</span>
                        <button className="edit-small" onClick={() => openModal('task', task, phase)}>e</button>
                        <button className="delete-small" onClick={() => handleDelete('task', task.id)}>x</button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="admin-section">
                  <div className="section-header">
                    <h4>Deliverables ({phase.deliverables?.length || 0})</h4>
                    <button className="small-btn" onClick={() => openModal('deliverable', null, phase)}>+ Add Deliverable</button>
                  </div>
                  <ul className="admin-list">
                    {phase.deliverables?.map(del => (
                      <li key={del.id}>
                        <span>{del.name}</span>
                        <button className="edit-small" onClick={() => openModal('deliverable', del, phase)}>e</button>
                        <button className="delete-small" onClick={() => handleDelete('deliverable', del.id)}>x</button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="admin-section requirements-gate">
                  <div className="section-header">
                    <h4>Required for Approval ({phase.required_requirements?.length || 0})</h4>
                    <button className="small-btn" onClick={() => openModal('phase_requirement', null, phase)}>+ Link Requirement</button>
                  </div>
                  <p className="helper-text">Phase cannot be approved until all evidence for these requirements is accepted by auditor.</p>
                  <ul className="admin-list">
                    {phase.required_requirements?.map(pr => (
                      <li key={pr.requirement_id}>
                        <span className="req-badge">Req {pr.req_number}</span>
                        <span>{pr.name}</span>
                        <button className="delete-small" onClick={() => handleUnlinkRequirement(phase.id, pr.requirement_id)}>x</button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        ) : activeTab === 'requirements' ? (
          <div className="requirements-admin">
            <div className="admin-toolbar">
              <button className="add-btn" onClick={() => openModal('requirement')}>+ Add Requirement</button>
            </div>
            {requirements.map(req => (
              <div key={req.id} className="admin-card">
                <div className="admin-card-header">
                  <h3>Requirement {req.req_number}: {req.name}</h3>
                  <div className="admin-actions">
                    <button onClick={() => openModal('requirement', req)}>Edit</button>
                    <button className="delete" onClick={() => handleDelete('requirement', req.id)}>Delete</button>
                  </div>
                </div>
                <p className="admin-description">{req.description}</p>
                
                <div className="admin-section">
                  <div className="section-header">
                    <h4>Sub-Requirements ({req.sub_requirements?.length || 0})</h4>
                    <button className="small-btn" onClick={() => openModal('sub_requirement', null, req)}>+ Add Sub-Req</button>
                  </div>
                  {req.sub_requirements?.map(sub => (
                    <div key={sub.id} className="sub-item">
                      <div className="sub-header">
                        <span className="sub-number">{sub.sub_req_number}</span>
                        <span className="sub-name">{sub.name}</span>
                        <button className="edit-small" onClick={() => openModal('sub_requirement', sub, req)}>e</button>
                        <button className="delete-small" onClick={() => handleDelete('sub_requirement', sub.id)}>x</button>
                      </div>
                      <div className="evidence-section">
                        <div className="evidence-header">
                          <span>Required Evidence ({sub.required_evidence?.length || 0})</span>
                          <button className="tiny-btn" onClick={() => openModal('evidence', null, sub)}>+</button>
                        </div>
                        <ul className="evidence-list">
                          {sub.required_evidence?.map(ev => (
                            <li key={ev.id}>
                              <span className="ev-name">{ev.name}</span>
                              <span className="ev-type">{ev.evidence_type}</span>
                              <button className="edit-tiny" onClick={() => openModal('evidence', ev, sub)}>e</button>
                              <button className="delete-tiny" onClick={() => handleDelete('evidence', ev.id)}>x</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : activeTab === 'users' ? (
          <div className="users-admin">
            <div className="admin-toolbar">
              <button className="add-btn" onClick={() => openModal('user')}>+ Add User</button>
            </div>
            <table className="users-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Display Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className={!u.is_active ? 'inactive' : ''}>
                    <td>{u.username}</td>
                    <td>{u.email}</td>
                    <td>{u.display_name}</td>
                    <td><span className={`role-badge ${u.role}`}>{roleLabels[u.role] || u.role}</span></td>
                    <td>{u.is_active ? 'Active' : 'Inactive'}</td>
                    <td>
                      <button onClick={() => openModal('user', u)}>Edit</button>
                      {u.id !== user.id && (
                        <button className="delete" onClick={() => handleDelete('user', u.id)}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>
              {editingItem ? 'Edit' : 'Add'} {modalType.replace('_', ' ')}
            </h2>
            <form onSubmit={handleSubmit}>
              {modalType === 'phase' && (
                <>
                  <div className="form-group">
                    <label>Phase Number</label>
                    <input type="number" value={formData.phase_number} onChange={e => setFormData({...formData, phase_number: parseInt(e.target.value)})} required />
                  </div>
                  <div className="form-group">
                    <label>Name</label>
                    <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
                  </div>
                </>
              )}
              {(modalType === 'task' || modalType === 'deliverable') && (
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                </div>
              )}
              {modalType === 'requirement' && (
                <>
                  <div className="form-group">
                    <label>Requirement Number</label>
                    <input type="number" value={formData.req_number} onChange={e => setFormData({...formData, req_number: parseInt(e.target.value)})} required />
                  </div>
                  <div className="form-group">
                    <label>Name</label>
                    <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
                  </div>
                </>
              )}
              {modalType === 'sub_requirement' && (
                <>
                  <div className="form-group">
                    <label>Sub-Requirement Number (e.g., 1.1)</label>
                    <input type="text" value={formData.sub_req_number} onChange={e => setFormData({...formData, sub_req_number: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Name</label>
                    <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                  </div>
                </>
              )}
              {modalType === 'evidence' && (
                <>
                  <div className="form-group">
                    <label>Evidence Name</label>
                    <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Evidence Type</label>
                    <select value={formData.evidence_type} onChange={e => setFormData({...formData, evidence_type: e.target.value})}>
                      <option value="document">Document</option>
                      <option value="policy">Policy</option>
                      <option value="config">Configuration</option>
                      <option value="screenshot">Screenshot</option>
                      <option value="log">Log</option>
                      <option value="report">Report</option>
                    </select>
                  </div>
                </>
              )}
              {modalType === 'user' && (
                <>
                  {!editingItem && (
                    <>
                      <div className="form-group">
                        <label>Username</label>
                        <input type="text" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} required />
                      </div>
                      <div className="form-group">
                        <label>Password</label>
                        <input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} required />
                      </div>
                    </>
                  )}
                  <div className="form-group">
                    <label>Email</label>
                    <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Display Name</label>
                    <input type="text" value={formData.display_name} onChange={e => setFormData({...formData, display_name: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Role</label>
                    <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                      <option value="admin">Administrator</option>
                      <option value="infosec_team">Infosec Team</option>
                      <option value="qsa_auditor">QSA Auditor</option>
                      <option value="business_owner">Business Owner</option>
                      <option value="it_security">IT Security</option>
                    </select>
                  </div>
                  {editingItem && (
                    <div className="form-group">
                      <label>
                        <input type="checkbox" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} />
                        Active
                      </label>
                    </div>
                  )}
                </>
              )}
              {modalType === 'phase_requirement' && (
                <div className="form-group">
                  <label>Select Requirement to Link</label>
                  <select value={formData.requirement_id} onChange={e => setFormData({...formData, requirement_id: e.target.value})} required>
                    <option value="">-- Select a requirement --</option>
                    {requirements.map(req => (
                      <option key={req.id} value={req.id}>
                        Req {req.req_number}: {req.name}
                      </option>
                    ))}
                  </select>
                  <p className="form-help">This requirement's evidence must be approved before the phase can advance.</p>
                </div>
              )}
              <div className="modal-actions">
                <button type="button" onClick={closeModal}>Cancel</button>
                <button type="submit" className="primary">{editingItem ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Admin
