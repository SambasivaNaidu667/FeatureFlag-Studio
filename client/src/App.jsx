import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronDown,
  Code2,
  Command,
  Eye,
  EyeOff,
  FlaskConical,
  LayoutDashboard,
  LoaderCircle,
  Lock,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  ToggleLeft,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  X,
} from 'lucide-react'
import './App.css'

const API_ROOT = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'
).replace(/\/$/, '')
const API_URL = `${API_ROOT}/flags`
const environments = ['development', 'staging', 'production']
const roles = ['admin', 'developer', 'viewer']

const initialForm = {
  name: '',
  key: '',
  description: '',
  rolloutPercentage: 0,
  allowlist: '',
  denylist: '',
}

const initialUserForm = {
  name: '',
  email: '',
  password: '',
  role: 'viewer',
}

const environmentMeta = {
  development: { label: 'Development', short: 'DEV', className: 'dev' },
  staging: { label: 'Staging', short: 'STG', className: 'staging' },
  production: { label: 'Production', short: 'PRD', className: 'production' },
}

const roleMeta = {
  admin: { label: 'Admin', className: 'role-admin', summary: 'Full workspace, production, and user control' },
  developer: { label: 'Developer', className: 'role-developer', summary: 'Create and manage flags in DEV & STG' },
  viewer: { label: 'Viewer', className: 'role-viewer', summary: 'Read-only access across environments' },
}

const API_UNAVAILABLE_MESSAGE =
  'Could not connect to the API. Check that the backend is running.'

// Maps an HTTP error response to a user-facing message so that real server
// responses (401, 403, 429, 5xx) are never reported as connection failures.
function describeHttpError(status, result = {}) {
  const serverMessage = typeof result.message === 'string' ? result.message : ''
  if (status === 401) return serverMessage || 'Invalid email or password'
  if (status === 403) return serverMessage || 'You do not have permission to perform this action'
  if (status === 429) return serverMessage || 'Too many attempts. Please try again later.'
  if (status === 503) return serverMessage || 'The service is temporarily unavailable.'
  if (status >= 500) return `Server error (${status}). Please try again or check the backend logs.`
  return serverMessage || `Request failed (${status})`
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getInitials(name, email) {
  const source = (name || email || 'U').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

function App() {
  const [accessToken, setAccessToken] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [authMode, setAuthMode] = useState('login')
  const [registrationEnabled, setRegistrationEnabled] = useState(false)
  const [credentials, setCredentials] = useState({ name: '', email: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [loginNotice, setLoginNotice] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)

  const [activeSection, setActiveSection] = useState('dashboard')
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [environment, setEnvironment] = useState('development')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [editingFlag, setEditingFlag] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [userForm, setUserForm] = useState(initialUserForm)
  const [userSaving, setUserSaving] = useState(false)
  const [userActionError, setUserActionError] = useState('')

  const [auditEvents, setAuditEvents] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')

  const permissions = useMemo(
    () => new Set(currentUser?.permissions || []),
    [currentUser],
  )
  const hasPermission = useCallback(
    (perm) => permissions.has(perm),
    [permissions],
  )

  const canModifyCurrentEnvironment = useMemo(() => {
    if (environment === 'production') {
      return permissions.has('flags:production')
    }
    return permissions.has('flags:update') || permissions.has('flags:toggle')
  }, [environment, permissions])

  const canCreateFlag = permissions.has('flags:create')
  const canEditInEnv =
    permissions.has('flags:update') &&
    (environment !== 'production' || permissions.has('flags:production'))
  const canToggleInEnv =
    permissions.has('flags:toggle') &&
    (environment !== 'production' || permissions.has('flags:production'))
  const canDeleteFlag = permissions.has('flags:delete')
  const canManageUsers = permissions.has('users:manage')
  const canReadAudit = permissions.has('audit:read')

  useEffect(() => {
    let active = true
    fetch(`${API_ROOT}/auth/config`)
      .then((res) => res.json())
      .then((result) => {
        if (active && typeof result?.data?.registrationEnabled === 'boolean') {
          setRegistrationEnabled(result.data.registrationEnabled)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const request = useCallback(
    async (url, options = {}) => {
      const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
      }
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`

      let response
      try {
        response = await fetch(url, { ...options, headers })
      } catch {
        throw new Error(API_UNAVAILABLE_MESSAGE)
      }
      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (response.status === 401 && accessToken) {
          setLoginError(
            result.message === 'This account has been deactivated'
              ? 'Your account has been deactivated by an administrator.'
              : 'Your session expired. Please sign in again.',
          )
          setAccessToken('')
          setCurrentUser(null)
          setFlags([])
          setUsers([])
          setAuditEvents([])
        }
        throw new Error(describeHttpError(response.status, result))
      }

      return result
    },
    [accessToken],
  )

  const loadFlags = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await request(API_URL)
      setFlags(result.data || [])
    } catch (requestError) {
      setError(requestError.message || API_UNAVAILABLE_MESSAGE)
    } finally {
      setLoading(false)
    }
  }, [request])

  const loadUsers = useCallback(async () => {
    if (!canManageUsers) return
    setUsersLoading(true)
    setUsersError('')
    try {
      const result = await request(`${API_ROOT}/users`)
      setUsers(result.data || [])
    } catch (requestError) {
      setUsersError(requestError.message || API_UNAVAILABLE_MESSAGE)
    } finally {
      setUsersLoading(false)
    }
  }, [canManageUsers, request])

  const loadAudit = useCallback(async () => {
    if (!canReadAudit) return
    setAuditLoading(true)
    setAuditError('')
    try {
      const result = await request(`${API_ROOT}/audit?limit=50`)
      setAuditEvents(result.data || [])
    } catch (requestError) {
      setAuditError(requestError.message || API_UNAVAILABLE_MESSAGE)
    } finally {
      setAuditLoading(false)
    }
  }, [canReadAudit, request])

  useEffect(() => {
    // Loading data after authentication is an intentional API synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (accessToken) loadFlags()
  }, [accessToken, loadFlags])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (accessToken && activeSection === 'users' && canManageUsers) loadUsers()
    if (accessToken && activeSection === 'activity' && canReadAudit) loadAudit()
  }, [accessToken, activeSection, canManageUsers, canReadAudit, loadUsers, loadAudit])

  async function handleLogin(event) {
    event.preventDefault()
    setLoggingIn(true)
    setLoginError('')
    setLoginNotice('')
    try {
      if (authMode === 'register') {
        let response
        try {
          response = await fetch(`${API_ROOT}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: credentials.name,
              email: credentials.email,
              password: credentials.password,
            }),
          })
        } catch {
          throw new Error(API_UNAVAILABLE_MESSAGE)
        }
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(describeHttpError(response.status, result))
        setLoginNotice(
          result.message ||
            'Account registered with Viewer access. Sign in with your email and password.',
        )
        setAuthMode('login')
        setCredentials((curr) => ({ ...curr, name: '', password: '' }))
        return
      }

      let response
      try {
        response = await fetch(`${API_ROOT}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        })
      } catch {
        throw new Error(API_UNAVAILABLE_MESSAGE)
      }
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(describeHttpError(response.status, result))
      if (typeof result.data?.accessToken !== 'string' || !result.data.accessToken) {
        throw new Error('The server returned an invalid sign-in response')
      }
      setAccessToken(result.data.accessToken)
      setCurrentUser(result.data.user || null)
      setActiveSection('dashboard')
      setCredentials({ name: '', email: '', password: '' })
    } catch (requestError) {
      setLoginError(requestError.message || 'Sign-in failed')
    } finally {
      setLoggingIn(false)
    }
  }

  async function logout() {
    const tokenToRevoke = accessToken
    setAccessToken('')
    setCurrentUser(null)
    setFlags([])
    setUsers([])
    setAuditEvents([])
    setLoginError('')
    setLoginNotice('')
    setNotice('')
    setError('')
    if (tokenToRevoke) {
      fetch(`${API_ROOT}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenToRevoke}` },
      }).catch(() => {})
    }
  }

  const filteredFlags = useMemo(() => {
    const query = search.trim().toLowerCase()
    return flags.filter((flag) => {
      const config = flag.environments?.[environment] || {}
      const matchesSearch =
        !query ||
        flag.name.toLowerCase().includes(query) ||
        flag.key.toLowerCase().includes(query) ||
        (flag.description || '').toLowerCase().includes(query)
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'enabled' && config.enabled) ||
        (statusFilter === 'disabled' && !config.enabled)
      return matchesSearch && matchesStatus
    })
  }, [flags, search, environment, statusFilter])

  const enabledCount = flags.filter(
    (flag) => flag.environments?.[environment]?.enabled,
  ).length
  const rolloutTotal = flags.reduce(
    (total, flag) =>
      total + (flag.environments?.[environment]?.rolloutPercentage || 0),
    0,
  )
  const averageRollout = flags.length ? Math.round(rolloutTotal / flags.length) : 0
  const currentEnvironment = environmentMeta[environment]
  const currentRoleMeta = roleMeta[currentUser?.role] || roleMeta.viewer

  function openCreateModal() {
    if (!canCreateFlag) return
    setEditingFlag(null)
    setForm(initialForm)
    setActionError('')
    setModalOpen(true)
  }

  function openEditModal(flag) {
    if (!canEditInEnv) return
    const config = flag.environments?.[environment] || {}
    setEditingFlag(flag)
    setForm({
      name: flag.name,
      key: flag.key,
      description: flag.description || '',
      rolloutPercentage: config.rolloutPercentage || 0,
      allowlist: (config.allowlist || []).join(', '),
      denylist: (config.denylist || []).join(', '),
    })
    setActionError('')
    setModalOpen(true)
  }

  function closeModal() {
    if (saving) return
    setModalOpen(false)
    setEditingFlag(null)
    setActionError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setActionError('')
    setNotice('')

    try {
      const targeting = {
        rolloutPercentage: Number(form.rolloutPercentage),
        allowlist: form.allowlist.split(',').map((id) => id.trim()).filter(Boolean),
        denylist: form.denylist.split(',').map((id) => id.trim()).filter(Boolean),
      }
      const targetEnvForNew =
        environment === 'production' && !hasPermission('flags:production')
          ? 'development'
          : environment
      const url = editingFlag ? `${API_URL}/${editingFlag._id}` : API_URL
      const payload = editingFlag
        ? { name: form.name, key: form.key, description: form.description }
        : {
            name: form.name,
            key: form.key,
            description: form.description,
            environments: Object.fromEntries(
              environments.map((item) => [
                item,
                item === targetEnvForNew
                  ? { enabled: false, ...targeting }
                  : {
                      enabled: false,
                      rolloutPercentage: 0,
                      allowlist: [],
                      denylist: [],
                    },
              ]),
            ),
          }

      const result = await request(url, {
        method: editingFlag ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
      const savedResult = editingFlag
        ? await request(
            `${API_URL}/${editingFlag._id}/environments/${environment}`,
            { method: 'PATCH', body: JSON.stringify(targeting) },
          )
        : result

      if (editingFlag) {
        setFlags((current) =>
          current.map((flag) =>
            flag._id === editingFlag._id ? savedResult.data : flag,
          ),
        )
        setNotice('Feature flag updated successfully.')
      } else {
        setFlags((current) => [result.data, ...current])
        setNotice('Feature flag created successfully.')
      }
      setModalOpen(false)
      setEditingFlag(null)
      setActionError('')
    } catch (requestError) {
      setActionError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleFlag(flag) {
    if (!canToggleInEnv) return
    setNotice('')
    setError('')
    try {
      const result = await request(
        `${API_URL}/${flag._id}/environments/${environment}/toggle`,
        { method: 'PATCH' },
      )
      setFlags((current) =>
        current.map((item) => (item._id === flag._id ? result.data : item)),
      )
      setNotice(
        `${result.data.name} is now ${
          result.configuration.enabled ? 'enabled' : 'disabled'
        } in ${environment}.`,
      )
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function deleteFlag(flag) {
    if (!canDeleteFlag) return
    if (!window.confirm(`Delete "${flag.name}"? This action cannot be undone.`)) return
    setNotice('')
    setError('')
    try {
      await request(`${API_URL}/${flag._id}`, { method: 'DELETE' })
      setFlags((current) => current.filter((item) => item._id !== flag._id))
      setNotice(`${flag.name} was deleted.`)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleCreateUser(event) {
    event.preventDefault()
    setUserSaving(true)
    setUserActionError('')
    setNotice('')
    try {
      const result = await request(`${API_ROOT}/users`, {
        method: 'POST',
        body: JSON.stringify(userForm),
      })
      setUsers((current) => [...current, result.data])
      setUserModalOpen(false)
      setUserForm(initialUserForm)
      setNotice(`Created ${result.data.role} account for ${result.data.email}.`)
    } catch (requestError) {
      setUserActionError(requestError.message)
    } finally {
      setUserSaving(false)
    }
  }

  async function handleRoleChange(targetUser, nextRole) {
    if (targetUser.role === nextRole) return
    setUsersError('')
    setNotice('')
    try {
      const result = await request(`${API_ROOT}/users/${targetUser._id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      })
      setUsers((current) =>
        current.map((item) => (item._id === targetUser._id ? result.data : item)),
      )
      setNotice(`Updated ${targetUser.email} role to ${nextRole}.`)
    } catch (requestError) {
      setUsersError(requestError.message)
    }
  }

  async function handleStatusToggle(targetUser) {
    const nextStatus = targetUser.status === 'active' ? 'deactivated' : 'active'
    if (
      nextStatus === 'deactivated' &&
      !window.confirm(
        `Deactivate "${targetUser.email}"? Any active sessions for this user will be revoked immediately.`,
      )
    ) {
      return
    }
    setUsersError('')
    setNotice('')
    try {
      const result = await request(`${API_ROOT}/users/${targetUser._id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      })
      setUsers((current) =>
        current.map((item) => (item._id === targetUser._id ? result.data : item)),
      )
      setNotice(
        `${targetUser.email} is now ${nextStatus === 'active' ? 'active' : 'deactivated'}.`,
      )
    } catch (requestError) {
      setUsersError(requestError.message)
    }
  }

  if (!accessToken) {
    return (
      <main className="login-shell">
        <section className="login-story" aria-label="FeatureFlag Studio">
          <a className="brand brand-light" href="#login">
            <span className="brand-mark"><Command size={19} /></span>
            <span>featureflag<span>studio</span></span>
          </a>
          <div className="story-copy">
            <p className="kicker"><Sparkles size={14} /> RELEASE CONTROL / 01</p>
            <h1>Ship boldly.<br /><em>Control precisely.</em></h1>
            <p>
              One calm command center for progressive delivery, environment
              targeting, and role-governed releases.
            </p>
          </div>
          <div className="signal-map" aria-hidden="true">
            {/* Uniform scaling keeps circles round. Nodes sit 60 units apart (r=24) so they never
                overlap, and each line runs from the origin's edge to the edge of its target circle. */}
            <svg className="signal-graphic" viewBox="0 0 580 185" preserveAspectRatio="xMinYMid meet">
              <defs>
                <linearGradient id="signal-line-gradient" gradientUnits="userSpaceOnUse" x1="58" y1="0" x2="248" y2="0">
                  <stop offset="0%" stopColor="#7464d9" />
                  <stop offset="100%" stopColor="#4da8c5" />
                </linearGradient>
              </defs>
              <line className="signal-line" x1="58" y1="92.5" x2="248.89" y2="38.98" />
              <line className="signal-line" x1="58" y1="92.5" x2="248" y2="92.5" />
              <line className="signal-line" x1="58" y1="92.5" x2="248.89" y2="146.02" />
              <rect className="signal-origin" x="18" y="72.5" width="40" height="40" rx="12" />
              <text className="signal-origin-icon" x="38" y="92.5" textAnchor="middle" dominantBaseline="central">⌘</text>
              <circle className="signal-node node-dev" cx="272" cy="32.5" r="24" />
              <circle className="signal-node node-stage" cx="272" cy="92.5" r="24" />
              <circle className="signal-node node-prod" cx="272" cy="152.5" r="24" />
              <text className="signal-label label-dev" x="272" y="32.5" textAnchor="middle" dominantBaseline="central">DEV</text>
              <text className="signal-label label-stage" x="272" y="92.5" textAnchor="middle" dominantBaseline="central">STG</text>
              <text className="signal-label label-prod" x="272" y="152.5" textAnchor="middle" dominantBaseline="central">PRD</text>
            </svg>
            <div className="signal-caption">CONTROLLED RELEASE PATH</div>
          </div>
          <div className="story-footer"><span><span className="live-dot" /> SYSTEM READY</span><span>RBAC / MULTI-USER WORKSPACE</span></div>
        </section>

        <section className="login-panel">
          <form className="login-card" onSubmit={handleLogin}>
            <div className="login-card-top">
              <span className="secure-mark"><ShieldCheck size={18} /></span>
              <span className="secure-label">
                {authMode === 'register' ? 'VIEWER ONBOARDING' : 'ACCESS CONSOLE'}
              </span>
            </div>
            <h2>{authMode === 'register' ? 'Create account.' : 'Welcome back.'}</h2>
            <p className="login-intro">
              {authMode === 'register'
                ? 'Register for read-only Viewer access. An administrator can elevate your role later.'
                : 'Sign in with your workspace email and password.'}
            </p>
            {registrationEnabled && (
              <div className="auth-mode-tabs" role="tablist" aria-label="Authentication mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === 'login'}
                  className={authMode === 'login' ? 'active' : ''}
                  onClick={() => {
                    setAuthMode('login')
                    setLoginError('')
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === 'register'}
                  className={authMode === 'register' ? 'active' : ''}
                  onClick={() => {
                    setAuthMode('register')
                    setLoginError('')
                    setLoginNotice('')
                  }}
                >
                  Create account
                </button>
              </div>
            )}
            <div className="login-fields">
              {authMode === 'register' && (
                <>
                  <label htmlFor="name">Full name</label>
                  <input
                    id="name"
                    autoComplete="name"
                    minLength={2}
                    maxLength={80}
                    value={credentials.name}
                    onChange={(event) =>
                      setCredentials({ ...credentials, name: event.target.value })
                    }
                    placeholder="Alex Morgan"
                    required
                  />
                </>
              )}
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={credentials.email}
                onChange={(event) =>
                  setCredentials({ ...credentials, email: event.target.value })
                }
                placeholder="admin@featureflag.local"
                required
              />
              <label htmlFor="password">Password</label>
              <div className="password-field">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                  minLength={authMode === 'register' ? 8 : undefined}
                  value={credentials.password}
                  onChange={(event) =>
                    setCredentials({ ...credentials, password: event.target.value })
                  }
                  placeholder={
                    authMode === 'register'
                      ? 'At least 8 characters'
                      : 'Enter your password'
                  }
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            {loginNotice && (
              <div className="notice success-notice" role="status">
                <Check size={16} />
                <span>{loginNotice}</span>
              </div>
            )}
            {loginError && <div className="notice error-notice" role="alert">{loginError}</div>}
            <button className="primary-button login-button" type="submit" disabled={loggingIn}>
              {loggingIn ? (
                <>
                  <LoaderCircle className="spin" size={17} />{' '}
                  {authMode === 'register' ? 'Creating account' : 'Authenticating'}
                </>
              ) : authMode === 'register' ? (
                <>
                  Register viewer account <UserPlus size={17} />
                </>
              ) : (
                <>
                  Enter console <ArrowUpRight size={17} />
                </>
              )}
            </button>
            <p className="login-security">
              <ShieldCheck size={13} /> Role-based access · In-memory 15m JWT session
            </p>
          </form>
        </section>
      </main>
    )
  }

  const userInitials = getInitials(currentUser?.name, currentUser?.email)

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-head">
          <a
            className="brand"
            href="#dashboard"
            onClick={(event) => {
              event.preventDefault()
              setActiveSection('dashboard')
              setMobileNavOpen(false)
            }}
            aria-label="FeatureFlag Studio home"
          >
            <span className="brand-mark"><Command size={18} /></span>
            <span>featureflag<span>studio</span></span>
          </a>
          <button
            className="mobile-close"
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={19} />
          </button>
        </div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">F</span>
          <span>
            <strong>FeatureFlag Studio</strong>
            <small>{currentRoleMeta.label} access</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <a
            className={`nav-item ${activeSection === 'dashboard' ? 'active' : ''}`}
            href="#dashboard"
            onClick={(event) => {
              event.preventDefault()
              setActiveSection('dashboard')
              setMobileNavOpen(false)
            }}
          >
            <LayoutDashboard size={17} />
            <span>Overview</span>
          </a>
          <a
            className={`nav-item ${activeSection === 'flags' ? 'active' : ''}`}
            href="#flags"
            onClick={(event) => {
              event.preventDefault()
              setActiveSection('flags')
              setMobileNavOpen(false)
            }}
          >
            <ToggleLeft size={17} />
            <span>Feature flags</span>
            <b>{flags.length}</b>
          </a>
          <a
            className={`nav-item ${activeSection === 'environments' ? 'active' : ''}`}
            href="#environments"
            onClick={(event) => {
              event.preventDefault()
              setActiveSection('environments')
              setMobileNavOpen(false)
            }}
          >
            <FlaskConical size={17} />
            <span>Environments</span>
          </a>
        </nav>
        <p className="nav-label nav-label-spaced">GOVERNANCE</p>
        <nav className="sidebar-nav" aria-label="Governance navigation">
          {canManageUsers && (
            <a
              className={`nav-item ${activeSection === 'users' ? 'active' : ''}`}
              href="#users"
              onClick={(event) => {
                event.preventDefault()
                setActiveSection('users')
                setMobileNavOpen(false)
              }}
            >
              <Users size={17} />
              <span>Team & roles</span>
              {users.length > 0 && <b>{users.length}</b>}
            </a>
          )}
          {canReadAudit && (
            <a
              className={`nav-item ${activeSection === 'activity' ? 'active' : ''}`}
              href="#activity"
              onClick={(event) => {
                event.preventDefault()
                setActiveSection('activity')
                setMobileNavOpen(false)
              }}
            >
              <Activity size={17} />
              <span>Audit activity</span>
            </a>
          )}
          <a
            className={`nav-item ${activeSection === 'settings' ? 'active' : ''}`}
            href="#settings"
            onClick={(event) => {
              event.preventDefault()
              setActiveSection('settings')
              setMobileNavOpen(false)
            }}
          >
            <Settings size={17} />
            <span>Account & session</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <div className="upgrade-icon"><Sparkles size={16} /></div>
            <strong>{currentRoleMeta.label} permissions</strong>
            <p>{currentRoleMeta.summary}</p>
            <div className="upgrade-line"><span /></div>
          </div>
          <div className="profile">
            <span className="profile-avatar">{userInitials}</span>
            <span className="profile-info">
              <strong>{currentUser?.name || 'Workspace User'}</strong>
              <small>{currentUser?.email}</small>
            </span>
            <button type="button" onClick={logout} aria-label="Sign out" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          className="nav-scrim"
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <button
            className="mobile-menu"
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <i>/</i>
            <strong>
              {activeSection === 'users'
                ? 'Team & roles'
                : activeSection === 'activity'
                  ? 'Audit activity'
                  : activeSection === 'settings'
                    ? 'Account & session'
                    : activeSection === 'environments'
                      ? 'Environments'
                      : 'Overview'}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className={`role-badge ${currentRoleMeta.className}`}>
              {currentRoleMeta.label}
            </span>
            <span className="connection-status">
              <span className="live-dot" /> API connected
            </span>
            <div className="topbar-avatar" title={currentUser?.email}>
              {userInitials}
            </div>
          </div>
        </header>

        <div className="page-content">
          {notice && (
            <div className="notice success-notice" role="status">
              <Check size={16} />
              <span>{notice}</span>
              <button onClick={() => setNotice('')} aria-label="Dismiss message">
                <X size={15} />
              </button>
            </div>
          )}

          {(activeSection === 'dashboard' ||
            activeSection === 'flags' ||
            activeSection === 'environments') && (
            <>
              <section className="hero-row">
                <div>
                  <p className="kicker">
                    <span className="kicker-mark" /> FEATURE MANAGEMENT
                  </p>
                  <h1>
                    Feature flags<span className="heading-period">.</span>
                  </h1>
                  <p className="page-subtitle">
                    A precise control plane for shipping what matters.
                  </p>
                </div>
                <div className="hero-actions">
                  <label className="environment-picker">
                    <span>VIEWING ENVIRONMENT</span>
                    <select
                      value={environment}
                      onChange={(event) => setEnvironment(event.target.value)}
                      aria-label="Viewing environment"
                    >
                      {environments.map((item) => (
                        <option value={item} key={item}>
                          {environmentMeta[item].label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={15} />
                  </label>
                  {canCreateFlag && (
                    <button className="primary-button" onClick={openCreateModal}>
                      <Plus size={17} /> New flag
                    </button>
                  )}
                </div>
              </section>

              {!canModifyCurrentEnvironment && (
                <div className="notice info-notice" role="status">
                  <Lock size={15} />
                  <span>
                    {currentUser?.role === 'viewer'
                      ? 'You have Viewer access. Feature flags and targeting configurations are read-only.'
                      : 'Production configuration is protected. Only administrators can toggle or modify production targeting.'}
                  </span>
                </div>
              )}

              {error && (
                <div className="notice error-notice" role="alert">
                  <span>{error}</span>
                  <button onClick={loadFlags} className="retry-button">
                    Retry <RefreshCw size={13} />
                  </button>
                </div>
              )}

              <section className="metrics-grid" aria-label="Feature flag metrics">
                <article className="metric-card metric-primary">
                  <div className="metric-label">
                    <span className="metric-icon">
                      <ToggleLeft size={17} />
                    </span>
                    <span>Total flags</span>
                  </div>
                  <strong>{flags.length}</strong>
                  <small>Across all environments</small>
                </article>
                <article className="metric-card">
                  <div className="metric-label">
                    <span className="metric-icon green">
                      <Check size={17} />
                    </span>
                    <span>Active in {currentEnvironment.short}</span>
                  </div>
                  <strong>{enabledCount}</strong>
                  <small>
                    {flags.length
                      ? `${Math.round((enabledCount / flags.length) * 100)}% of workspace`
                      : 'Ready to configure'}
                  </small>
                </article>
                <article className="metric-card">
                  <div className="metric-label">
                    <span className="metric-icon cyan">
                      <Activity size={17} />
                    </span>
                    <span>Average rollout</span>
                  </div>
                  <strong>
                    {averageRollout}
                    <em>%</em>
                  </strong>
                  <small>Current environment</small>
                </article>
                <article className="metric-card metric-context">
                  <div className="metric-label">
                    <span className={`env-dot ${currentEnvironment.className}`} />
                    <span>Selected environment</span>
                  </div>
                  <strong>{currentEnvironment.label}</strong>
                  <small>
                    {canModifyCurrentEnvironment ? 'Editable scope' : 'Read-only scope'}
                  </small>
                </article>
              </section>

              <section className="flags-panel" id="flags">
                <div className="panel-heading">
                  <div>
                    <div className="section-eyebrow">
                      CONTROL PLANE <span />
                    </div>
                    <div className="panel-title-row">
                      <h2>Feature inventory</h2>
                      <span className="total-pill">
                        {filteredFlags.length.toString().padStart(2, '0')}
                      </span>
                    </div>
                    <p>Manage release states and audience targeting from one place.</p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={loadFlags}
                    disabled={loading}
                  >
                    {loading ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <RefreshCw size={15} />
                    )}{' '}
                    Refresh
                  </button>
                </div>
                <div className="filter-toolbar">
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      type="search"
                      placeholder="Search by name, key, or description"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    <kbd>/</kbd>
                  </label>
                  <label className="filter-select">
                    <span className={`env-dot ${currentEnvironment.className}`} />
                    <select
                      value={environment}
                      onChange={(event) => setEnvironment(event.target.value)}
                      aria-label="Filter by environment"
                    >
                      {environments.map((item) => (
                        <option value={item} key={item}>
                          {environmentMeta[item].label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </label>
                  <label className="filter-select">
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                      aria-label="Filter by status"
                    >
                      <option value="all">All statuses</option>
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                    </select>
                    <ChevronDown size={14} />
                  </label>
                </div>
                <div className="table-wrap">
                  <table className="flags-table">
                    <thead>
                      <tr>
                        <th>FLAG</th>
                        <th>ENVIRONMENT</th>
                        <th>RELEASE STATE</th>
                        <th>UPDATED</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan="5" className="table-message">
                            <LoaderCircle className="spin" size={22} />
                            <span>Syncing feature inventory...</span>
                          </td>
                        </tr>
                      ) : filteredFlags.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="table-message empty-state">
                            <span className="empty-icon">
                              <Code2 size={21} />
                            </span>
                            <strong>
                              {flags.length
                                ? 'No matching flags'
                                : 'Your control plane is ready'}
                            </strong>
                            <span>
                              {flags.length
                                ? 'Try adjusting your search or filters.'
                                : canCreateFlag
                                  ? 'Create your first flag to start a controlled release.'
                                  : 'No feature flags have been created yet.'}
                            </span>
                            {!flags.length && canCreateFlag && (
                              <button
                                className="primary-button small-primary"
                                onClick={openCreateModal}
                              >
                                <Plus size={15} /> Create first flag
                              </button>
                            )}
                          </td>
                        </tr>
                      ) : (
                        filteredFlags.map((flag) => {
                          const config = flag.environments?.[environment] || {}
                          return (
                            <tr key={flag._id}>
                              <td>
                                <div className="flag-name-cell">
                                  <div
                                    className={`flag-symbol ${
                                      config.enabled ? 'symbol-on' : ''
                                    }`}
                                  >
                                    <Code2 size={17} />
                                  </div>
                                  <div className="flag-details">
                                    <strong>{flag.name}</strong>
                                    <code>{flag.key}</code>
                                    {flag.description && <p>{flag.description}</p>}
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span
                                  className={`environment-tag ${currentEnvironment.className}`}
                                >
                                  <span />
                                  {currentEnvironment.label}
                                </span>
                              </td>
                              <td>
                                <div className="status-cell">
                                  <button
                                    className={`toggle-switch ${
                                      config.enabled ? 'is-on' : ''
                                    }`}
                                    type="button"
                                    role="switch"
                                    disabled={!canToggleInEnv}
                                    aria-checked={Boolean(config.enabled)}
                                    aria-label={`${
                                      config.enabled ? 'Disable' : 'Enable'
                                    } ${flag.name}`}
                                    title={
                                      canToggleInEnv
                                        ? `Toggle in ${currentEnvironment.label}`
                                        : 'You do not have permission to toggle this environment'
                                    }
                                    onClick={() => toggleFlag(flag)}
                                  >
                                    <span />
                                  </button>
                                  <span
                                    className={`status-text ${
                                      config.enabled ? 'text-enabled' : ''
                                    }`}
                                  >
                                    {config.enabled ? 'Enabled' : 'Disabled'} <b>·</b>{' '}
                                    {config.rolloutPercentage || 0}% rollout
                                  </span>
                                </div>
                              </td>
                              <td>
                                <span className="date-cell">
                                  {formatDate(flag.updatedAt || flag.createdAt)}
                                </span>
                              </td>
                              <td>
                                <div className="row-actions">
                                  {canEditInEnv && (
                                    <button
                                      className="row-action"
                                      type="button"
                                      onClick={() => openEditModal(flag)}
                                      aria-label={`Edit ${flag.name}`}
                                      title="Edit flag"
                                    >
                                      <Pencil size={15} />
                                    </button>
                                  )}
                                  {canDeleteFlag && (
                                    <button
                                      className="row-action delete-action"
                                      type="button"
                                      onClick={() => deleteFlag(flag)}
                                      aria-label={`Delete ${flag.name}`}
                                      title="Delete flag"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer">
                  <span>
                    Showing <strong>{filteredFlags.length}</strong> of{' '}
                    <strong>{flags.length}</strong> flags
                  </span>
                  <span className="footer-live">
                    <span className="live-dot" /> Live API sync
                  </span>
                </div>
              </section>
            </>
          )}

          {activeSection === 'users' && canManageUsers && (
            <>
              <section className="hero-row">
                <div>
                  <p className="kicker">
                    <span className="kicker-mark" /> ACCESS GOVERNANCE
                  </p>
                  <h1>
                    Team & roles<span className="heading-period">.</span>
                  </h1>
                  <p className="page-subtitle">
                    Manage workspace members, assign role-based permissions, and revoke access.
                  </p>
                </div>
                <div className="hero-actions">
                  <button
                    className="primary-button"
                    onClick={() => {
                      setUserForm(initialUserForm)
                      setUserActionError('')
                      setUserModalOpen(true)
                    }}
                  >
                    <UserPlus size={17} /> Add member
                  </button>
                </div>
              </section>

              {usersError && (
                <div className="notice error-notice" role="alert">
                  <span>{usersError}</span>
                  <button onClick={loadUsers} className="retry-button">
                    Retry <RefreshCw size={13} />
                  </button>
                </div>
              )}

              <section className="flags-panel">
                <div className="panel-heading">
                  <div>
                    <div className="section-eyebrow">
                      DIRECTORY <span />
                    </div>
                    <div className="panel-title-row">
                      <h2>Workspace accounts</h2>
                      <span className="total-pill">
                        {users.length.toString().padStart(2, '0')}
                      </span>
                    </div>
                    <p>
                      Role changes apply on the next API request. Deactivating a user revokes all active tokens immediately.
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={loadUsers}
                    disabled={usersLoading}
                  >
                    {usersLoading ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <RefreshCw size={15} />
                    )}{' '}
                    Refresh
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="flags-table">
                    <thead>
                      <tr>
                        <th>USER</th>
                        <th>ROLE</th>
                        <th>STATUS</th>
                        <th>CREATED</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {usersLoading ? (
                        <tr>
                          <td colSpan="5" className="table-message">
                            <LoaderCircle className="spin" size={22} />
                            <span>Loading workspace members...</span>
                          </td>
                        </tr>
                      ) : users.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="table-message">
                            <span>No users found.</span>
                          </td>
                        </tr>
                      ) : (
                        users.map((member) => {
                          const isSelf = member._id === currentUser?.id
                          const memberRole = roleMeta[member.role] || roleMeta.viewer
                          return (
                            <tr key={member._id}>
                              <td>
                                <div className="flag-name-cell">
                                  <div className="profile-avatar">
                                    {getInitials(member.name, member.email)}
                                  </div>
                                  <div className="flag-details">
                                    <strong>
                                      {member.name} {isSelf && <em>(you)</em>}
                                    </strong>
                                    <code>{member.email}</code>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <label className="filter-select role-select">
                                  <span className={`role-badge ${memberRole.className}`}>
                                    {memberRole.label}
                                  </span>
                                  <select
                                    value={member.role}
                                    disabled={isSelf}
                                    aria-label={`Role for ${member.email}`}
                                    onChange={(event) =>
                                      handleRoleChange(member, event.target.value)
                                    }
                                  >
                                    {roles.map((r) => (
                                      <option value={r} key={r}>
                                        {roleMeta[r].label}
                                      </option>
                                    ))}
                                  </select>
                                  <ChevronDown size={13} />
                                </label>
                              </td>
                              <td>
                                <span
                                  className={`status-pill ${
                                    member.status === 'active'
                                      ? 'status-active'
                                      : 'status-deactivated'
                                  }`}
                                >
                                  <span />
                                  {member.status === 'active' ? 'Active' : 'Deactivated'}
                                </span>
                              </td>
                              <td>
                                <span className="date-cell">
                                  {formatDate(member.createdAt)}
                                </span>
                              </td>
                              <td>
                                <div className="row-actions">
                                  <button
                                    className="secondary-button small-action-button"
                                    type="button"
                                    disabled={isSelf}
                                    onClick={() => handleStatusToggle(member)}
                                    title={
                                      isSelf
                                        ? 'You cannot deactivate your own account'
                                        : member.status === 'active'
                                          ? 'Deactivate account'
                                          : 'Reactivate account'
                                    }
                                  >
                                    {member.status === 'active' ? (
                                      <>
                                        <UserX size={14} /> Deactivate
                                      </>
                                    ) : (
                                      <>
                                        <UserCheck size={14} /> Activate
                                      </>
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {activeSection === 'activity' && canReadAudit && (
            <>
              <section className="hero-row">
                <div>
                  <p className="kicker">
                    <span className="kicker-mark" /> AUDIT TRAIL
                  </p>
                  <h1>
                    Audit activity<span className="heading-period">.</span>
                  </h1>
                  <p className="page-subtitle">
                    Immutable record of feature-flag mutations and user administration changes.
                  </p>
                </div>
                <div className="hero-actions">
                  <button
                    className="secondary-button"
                    onClick={loadAudit}
                    disabled={auditLoading}
                  >
                    {auditLoading ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <RefreshCw size={15} />
                    )}{' '}
                    Refresh log
                  </button>
                </div>
              </section>

              {auditError && (
                <div className="notice error-notice" role="alert">
                  <span>{auditError}</span>
                </div>
              )}

              <section className="flags-panel">
                <div className="panel-heading">
                  <div>
                    <div className="section-eyebrow">
                      SECURITY LOG <span />
                    </div>
                    <div className="panel-title-row">
                      <h2>Recent events</h2>
                      <span className="total-pill">
                        {auditEvents.length.toString().padStart(2, '0')}
                      </span>
                    </div>
                    <p>Credentials, password hashes, and tokens are never stored in audit records.</p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="flags-table">
                    <thead>
                      <tr>
                        <th>ACTION</th>
                        <th>TARGET</th>
                        <th>ACTOR</th>
                        <th>SUMMARY</th>
                        <th>TIMESTAMP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLoading ? (
                        <tr>
                          <td colSpan="5" className="table-message">
                            <LoaderCircle className="spin" size={22} />
                            <span>Loading audit events...</span>
                          </td>
                        </tr>
                      ) : auditEvents.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="table-message">
                            <span>No audit events recorded yet.</span>
                          </td>
                        </tr>
                      ) : (
                        auditEvents.map((event) => (
                          <tr key={event._id}>
                            <td>
                              <code>{event.action}</code>
                            </td>
                            <td>
                              <strong>{event.targetLabel || event.targetType}</strong>
                            </td>
                            <td>
                              <span className="date-cell">{event.actorEmail}</span>
                            </td>
                            <td>
                              <span className="date-cell">{event.summary}</span>
                            </td>
                            <td>
                              <span className="date-cell">
                                {formatDateTime(event.createdAt)}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {activeSection === 'settings' && (
            <>
              <section className="hero-row">
                <div>
                  <p className="kicker">
                    <span className="kicker-mark" /> ACCOUNT & SECURITY
                  </p>
                  <h1>
                    Session profile<span className="heading-period">.</span>
                  </h1>
                  <p className="page-subtitle">
                    Your active identity, effective role permissions, and session security posture.
                  </p>
                </div>
                <div className="hero-actions">
                  <button className="secondary-button" onClick={logout}>
                    <LogOut size={15} /> Sign out & revoke session
                  </button>
                </div>
              </section>

              <section className="flags-panel settings-panel">
                <div className="settings-grid">
                  <div>
                    <span className="section-eyebrow">SIGNED-IN ACCOUNT</span>
                    <h3>{currentUser?.name}</h3>
                    <p><code>{currentUser?.email}</code></p>
                    <p>
                      Role:{' '}
                      <span className={`role-badge ${currentRoleMeta.className}`}>
                        {currentRoleMeta.label}
                      </span>
                    </p>
                    <p className="page-subtitle">{currentRoleMeta.summary}</p>
                  </div>
                  <div>
                    <span className="section-eyebrow">EFFECTIVE PERMISSIONS</span>
                    <div className="permission-list">
                      {(currentUser?.permissions || []).map((perm) => (
                        <code key={perm} className="permission-chip">
                          {perm}
                        </code>
                      ))}
                    </div>
                    <p className="page-subtitle">
                      Access tokens are held exclusively in memory (15-minute expiry) and are never persisted to localStorage. Refreshing the page requires signing in again.
                    </p>
                  </div>
                </div>
              </section>
            </>
          )}

          <footer className="page-footer">
            <span>
              FeatureFlag Studio <i>·</i> Release with confidence.
            </span>
            <span>
              {currentUser?.email} ({currentRoleMeta.label}) / {currentEnvironment.label}
            </span>
          </footer>
        </div>
      </main>

      {modalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal()
          }}
        >
          <section
            className="flag-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-heading">
              <div className="modal-kicker">
                <span className="modal-icon">
                  <Code2 size={17} />
                </span>
                <span>
                  {editingFlag ? 'EDIT CONFIGURATION' : 'NEW RELEASE CONTROL'}
                </span>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={closeModal}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
              <h2 id="modal-title">
                {editingFlag ? 'Edit feature flag' : 'Create feature flag'}
              </h2>
              <p>
                {editingFlag
                  ? `Update the ${currentEnvironment.label.toLowerCase()} release configuration.`
                  : 'Define a new capability and its initial rollout scope.'}
              </p>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <label className="form-field full">
                  <span>
                    Flag name <b>*</b>
                  </span>
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={form.name}
                    onChange={(event) => updateForm('name', event.target.value)}
                    placeholder="e.g. New checkout experience"
                  />
                </label>
                <label className="form-field full">
                  <span>
                    Unique key <b>*</b>
                  </span>
                  <input
                    required
                    maxLength={100}
                    pattern="[a-z][a-z0-9_]*"
                    title="Start with a lowercase letter. Use only lowercase letters, numbers, and underscores."
                    value={form.key}
                    onChange={(event) => updateForm('key', event.target.value)}
                    placeholder="e.g. new_checkout_v1"
                    disabled={Boolean(editingFlag)}
                  />
                  <small>Lowercase letters, numbers, and underscores only.</small>
                </label>
                <label className="form-field full">
                  <span>Description</span>
                  <textarea
                    maxLength={500}
                    rows={2}
                    value={form.description}
                    onChange={(event) =>
                      updateForm('description', event.target.value)
                    }
                    placeholder="What does this flag control?"
                  />
                </label>
                <div className="form-section-label full">
                  <span>
                    Targeting in{' '}
                    {!editingFlag &&
                    environment === 'production' &&
                    !hasPermission('flags:production')
                      ? 'Development (Production requires Admin)'
                      : currentEnvironment.label}
                  </span>
                  <small>Applied only to the selected environment.</small>
                </div>
                <label className="form-field">
                  <span>Rollout percentage</span>
                  <div className="number-input">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={form.rolloutPercentage}
                      onChange={(event) =>
                        updateForm('rolloutPercentage', event.target.value)
                      }
                    />
                    <b>%</b>
                  </div>
                </label>
                <div className="rollout-preview">
                  <span>Release exposure</span>
                  <strong>{Number(form.rolloutPercentage) || 0}%</strong>
                  <div>
                    <span
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(0, Number(form.rolloutPercentage) || 0),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
                <label className="form-field full">
                  <span>Allowlist user IDs</span>
                  <input
                    value={form.allowlist}
                    onChange={(event) =>
                      updateForm('allowlist', event.target.value)
                    }
                    placeholder="user-1, user-2"
                  />
                  <small>
                    Comma-separated IDs. These users bypass rollout percentage.
                  </small>
                </label>
                <label className="form-field full">
                  <span>Denylist user IDs</span>
                  <input
                    value={form.denylist}
                    onChange={(event) =>
                      updateForm('denylist', event.target.value)
                    }
                    placeholder="blocked-user"
                  />
                  <small>
                    Comma-separated IDs. Denylisted users always receive the feature disabled.
                  </small>
                </label>
              </div>
              {actionError && (
                <div className="form-error" role="alert">
                  {actionError}
                </div>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? (
                    <>
                      <LoaderCircle className="spin" size={16} /> Saving
                    </>
                  ) : (
                    <>
                      <Check size={16} />{' '}
                      {editingFlag ? 'Save changes' : 'Create flag'}
                    </>
                  )}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {userModalOpen && canManageUsers && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !userSaving) {
              setUserModalOpen(false)
            }
          }}
        >
          <section
            className="flag-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-modal-title"
          >
            <div className="modal-heading">
              <div className="modal-kicker">
                <span className="modal-icon">
                  <UserPlus size={17} />
                </span>
                <span>WORKSPACE ACCESS</span>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => !userSaving && setUserModalOpen(false)}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
              <h2 id="user-modal-title">Add workspace member</h2>
              <p>Create an account and assign its role-based permissions.</p>
            </div>
            <form onSubmit={handleCreateUser}>
              <div className="form-grid">
                <label className="form-field full">
                  <span>
                    Full name <b>*</b>
                  </span>
                  <input
                    required
                    minLength={2}
                    maxLength={80}
                    value={userForm.name}
                    onChange={(event) =>
                      setUserForm({ ...userForm, name: event.target.value })
                    }
                    placeholder="e.g. Priya Sharma"
                  />
                </label>
                <label className="form-field full">
                  <span>
                    Email address <b>*</b>
                  </span>
                  <input
                    required
                    type="email"
                    value={userForm.email}
                    onChange={(event) =>
                      setUserForm({ ...userForm, email: event.target.value })
                    }
                    placeholder="priya@featureflag.local"
                  />
                </label>
                <label className="form-field">
                  <span>
                    Temporary password <b>*</b>
                  </span>
                  <input
                    required
                    type="password"
                    minLength={8}
                    value={userForm.password}
                    onChange={(event) =>
                      setUserForm({ ...userForm, password: event.target.value })
                    }
                    placeholder="At least 8 characters"
                  />
                </label>
                <label className="form-field">
                  <span>
                    Assigned role <b>*</b>
                  </span>
                  <select
                    className="modal-select"
                    value={userForm.role}
                    onChange={(event) =>
                      setUserForm({ ...userForm, role: event.target.value })
                    }
                  >
                    {roles.map((r) => (
                      <option value={r} key={r}>
                        {roleMeta[r].label} — {roleMeta[r].summary}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {userActionError && (
                <div className="form-error" role="alert">
                  {userActionError}
                </div>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setUserModalOpen(false)}
                  disabled={userSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={userSaving}
                >
                  {userSaving ? (
                    <>
                      <LoaderCircle className="spin" size={16} /> Creating
                    </>
                  ) : (
                    <>
                      <Check size={16} /> Create account
                    </>
                  )}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
