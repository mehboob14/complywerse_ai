import { createContext, useContext, useState, useEffect } from 'react'
import api from '../config/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const response = await api.get('/auth/me')
      if (response.data.authenticated) {
        setUser(response.data.user)
      }
    } catch (error) {
      console.error('Auth check failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const login = async (username, password) => {
    const response = await api.post('/auth/login', { username, password })
    setUser(response.data.user)
    return response.data
  }

  const register = async (userData) => {
    const response = await api.post('/auth/register', userData)
    setUser(response.data.user)
    return response.data
  }

  const logout = async () => {
    await api.post('/auth/logout', {})
    setUser(null)
  }

  const hasRole = (...roles) => {
    if (!user) return false
    return roles.includes(user.role)
  }

  const isAdmin = () => hasRole('admin')
  const isInfosec = () => hasRole('admin', 'infosec_team')
  const isAuditor = () => hasRole('admin', 'qsa_auditor')
  const isBusinessOwner = () => hasRole('admin', 'business_owner')

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      register,
      logout,
      hasRole,
      isAdmin,
      isInfosec,
      isAuditor,
      isBusinessOwner,
      checkAuth
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
