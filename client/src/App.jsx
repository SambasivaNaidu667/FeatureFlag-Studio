import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
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
const validSections = new Set([
  'dashboard',
  'flags',
  'environments',
  'users',
  'activity',
  'settings',
])

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
  development: {
    label: 'Development',
    short: 'DEV',
    className: 'dev',
    description: 'Rapid iteration and feature validation for engineering teams.',
  },
  staging: {
    label: 'Staging',
    short: 'STG',
    className: 'staging',
    description: 'Pre-release verification and QA sign-off before production.',
  },
  production: {
    label: 'Production',
    short: 'PRD',
    className: 'production',
    description: 'Live customer traffic governed by administrator release controls.',
  },
}

const roleMeta = {
  admin: {
    label: 'Admin',
    className: 'role-admin',
    summary: 'Full workspace, production, and user control',
  },
  developer: {
    label: 'Developer',
    className: 'role-developer',
    summary: 'Create and manage flags in DEV & STG',
  },
  viewer: {
    label: 'Viewer',
    className: 'role-viewer',
    summary: 'Read-only access across environments',
  },
}

const sectionTitles = {
  dashboard: 'Overview',
  flags: 'Feature flags',
  environments: 'Environments',
  users: 'Team & roles',
  activity: 'Audit activity',
  settings: 'Account & session',
}

const API_UNAVAILABLE_MESSAGE =
  'Could not connect to the API. Check that the backend is running.'

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

function resolveSectionFromHash(hashValue, canManageUsers, canReadAudit) {
  const raw = (hashValue || '').replace(/^#/, '').trim().toLowerCase()
  if (!validSections.has(raw)) return 'dashboard'
  if (raw === 'users' && !canManageUsers) return 'dashboard'
  if (raw === 'activity' && !canReadAudit) return 'dashboard'
  return raw
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
  const [flagBusyId, setFlagBusyId] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const profileWrapperRef = useRef(null)

  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [userForm, setUserForm] = useState(initialUserForm)
  const [userSaving, setUserSaving] = useState(false)
  const [userActionError, setUserActionError] = useState('')
  const [userBusyId, setUserBusyId] = useState('')
  const [deletingUser, setDeletingUser] = useState(null)
  const [userDeleting, setUserDeleting] = useState(false)
  const [deleteUserError, setDeleteUserError] = useState('')

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

  const canModifyEnv = useCallback(
    (envName) => {
      if (envName === 'production') {
        return permissions.has('flags:production')
      }
      return permissions.has('flags:update') || permissions.has('flags:toggle')
    },
    [permissions],
  )

  const canModifyCurrentEnvironment = useMemo(
    () => canModifyEnv(environment),
    [canModifyEnv, environment],
  )

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

  const navigateTo = useCallback(
    (section) => {
      const target = resolveSectionFromHash(section, canManageUsers, canReadAudit)
      setActiveSection(target)
      setMobileNavOpen(false)
      setProfileMenuOpen(false)
      const expectedHash = `#${target}`
      if (window.location.hash !== expectedHash) {
        window.history.pushState(null, '', expectedHash)
      }
    },
    [canManageUsers, canReadAudit],
  )

  useEffect(() => {
    if (!accessToken) return
    const syncFromHash = () => {
      const next = resolveSectionFromHash(
        window.location.hash,
        canManageUsers,
        canReadAudit,
      )
      setActiveSection(next)
    }
    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    window.addEventListener('popstate', syncFromHash)
    return () => {
      window.removeEventListener('hashchange', syncFromHash)
      window.removeEventListener('popstate', syncFromHash)
    }
  }, [accessToken, canManageUsers, canReadAudit])

  useEffect(() => {
    if (!profileMenuOpen) return
    function handlePointerDown(event) {
      if (
        profileWrapperRef.current &&
        !profileWrapperRef.current.contains(event.target)
      ) {
        setProfileMenuOpen(false)
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [profileMenuOpen])

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

  const clearSessionState = useCallback((expiredMessage = '') => {
    setAccessToken('')
    setCurrentUser(null)
    setFlags([])
    setUsers([])
    setAuditEvents([])
    setProfileMenuOpen(false)
    setModalOpen(false)
    setUserModalOpen(false)
    setDeletingUser(null)
    if (expiredMessage) {
      setLoginError(expiredMessage)
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
          clearSessionState(
            result.message === 'This account has been deactivated'
              ? 'Your account has been deactivated by an administrator.'
              : 'Your session expired. Please sign in again.',
          )
        }
        throw new Error(describeHttpError(response.status, result))
      }

      return result
    },
    [accessToken, clearSessionState],
  )

  const loadProfile = useCallback(async () => {
    if (!accessToken) return
    setProfileLoading(true)
    setProfileError('')
    try {
      const result = await request(`${API_ROOT}/auth/me`)
      if (result.data) {
        setCurrentUser(result.data)
      }
    } catch (requestError) {
      setProfileError(requestError.message || 'Could not load account profile.')
    } finally {
      setProfileLoading(false)
    }
  }, [accessToken, request])

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
    if (accessToken && activeSection === 'settings') loadProfile()
  }, [
    accessToken,
    activeSection,
    canManageUsers,
    canReadAudit,
    loadUsers,
    loadAudit,
    loadProfile,
  ])

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
      const userObj = result.data.user || null
      const userPerms = new Set(userObj?.permissions || [])
      const initialSection = resolveSectionFromHash(
        window.location.hash,
        userPerms.has('users:manage'),
        userPerms.has('audit:read'),
      )
      setAccessToken(result.data.accessToken)
      setCurrentUser(userObj)
      setActiveSection(initialSection)
      window.history.replaceState(null, '', `#${initialSection}`)
      setCredentials({ name: '', email: '', password: '' })
    } catch (requestError) {
      setLoginError(requestError.message || 'Sign-in failed')
    } finally {
      setLoggingIn(false)
    }
  }

  async function logout() {
    const tokenToRevoke = accessToken
    clearSessionState('')
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

  function handleToggleProfileMenu() {
    const nextOpen = !profileMenuOpen
    setProfileMenuOpen(nextOpen)
    if (nextOpen) {
      loadProfile()
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

  const environmentSummaries = useMemo(() => {
    return environments.map((envKey) => {
      const meta = environmentMeta[envKey]
      let enabled = 0
      let rolloutSum = 0
      let targeted = 0
      for (const flag of flags) {
        const cfg = flag.environments?.[envKey] || {}
        if (cfg.enabled) enabled += 1
        rolloutSum += cfg.rolloutPercentage || 0
        if ((cfg.allowlist?.length || 0) > 0 || (cfg.denylist?.length || 0) > 0) {
          targeted += 1
        }
      }
      const total = flags.length
      return {
        key: envKey,
        ...meta,
        total,
        enabled,
        disabled: Math.max(0, total - enabled),
        averageRollout: total ? Math.round(rolloutSum / total) : 0,
        targeted,
        editable: canModifyEnv(envKey),
      }
    })
  }, [flags, canModifyEnv])

  const recentFlags = useMemo(() => {
    return [...flags]
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime(),
      )
      .slice(0, 5)
  }, [flags])

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

  function openEditModal(flag, targetEnv = environment) {
    const canEditTarget =
      permissions.has('flags:update') &&
      (targetEnv !== 'production' || permissions.has('flags:production'))
    if (!canEditTarget) return
    if (targetEnv !== environment) {
      setEnvironment(targetEnv)
    }
    const config = flag.environments?.[targetEnv] || {}
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
    if (saving) return
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
      if (requestError.message?.includes('permission')) {
        loadProfile()
      }
    } finally {
      setSaving(false)
    }
  }

  async function toggleFlag(flag, targetEnv = environment) {
    const allowed =
      permissions.has('flags:toggle') &&
      (targetEnv !== 'production' || permissions.has('flags:production'))
    if (!allowed || flagBusyId === flag._id) return
    setFlagBusyId(flag._id)
    setNotice('')
    setError('')
    try {
      const result = await request(
        `${API_URL}/${flag._id}/environments/${targetEnv}/toggle`,
        { method: 'PATCH' },
      )
      setFlags((current) =>
        current.map((item) => (item._id === flag._id ? result.data : item)),
      )
      setNotice(
        `${result.data.name} is now ${
          result.configuration.enabled ? 'enabled' : 'disabled'
        } in ${targetEnv}.`,
      )
    } catch (requestError) {
      setError(requestError.message)
      if (requestError.message?.includes('permission')) {
        loadProfile()
      }
    } finally {
      setFlagBusyId('')
    }
  }

  async function deleteFlag(flag) {
    if (!canDeleteFlag || flagBusyId === flag._id) return
    if (!window.confirm(`Delete "${flag.name}"? This action cannot be undone.`)) return
    setFlagBusyId(flag._id)
    setNotice('')
    setError('')
    try {
      await request(`${API_URL}/${flag._id}`, { method: 'DELETE' })
      setFlags((current) => current.filter((item) => item._id !== flag._id))
      setNotice(`${flag.name} was deleted.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setFlagBusyId('')
    }
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleCreateUser(event) {
    event.preventDefault()
    if (userSaving) return
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
    if (targetUser.role === nextRole || userBusyId === targetUser._id) return
    setUserBusyId(targetUser._id)
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
    } finally {
      setUserBusyId('')
    }
  }

  async function handleStatusToggle(targetUser) {
    if (userBusyId === targetUser._id) return
    const nextStatus = targetUser.status === 'active' ? 'deactivated' : 'active'
    if (
      nextStatus === 'deactivated' &&
      !window.confirm(
        `Deactivate "${targetUser.email}"? Any active sessions for this user will be revoked immediately.`,
      )
    ) {
      return
    }
    setUserBusyId(targetUser._id)
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
    } finally {
      setUserBusyId('')
    }
  }

  function openDeleteUserModal(targetUser) {
    if (targetUser.status !== 'deactivated' || userBusyId === targetUser._id) return
    setDeleteUserError('')
    setDeletingUser(targetUser)
  }

  function closeDeleteUserModal() {
    if (userDeleting) return
    setDeletingUser(null)
    setDeleteUserError('')
  }

  async function confirmDeleteUser() {
    if (!deletingUser || userDeleting) return
    setUserDeleting(true)
    setDeleteUserError('')
    setUsersError('')
    setNotice('')
    try {
      await request(`${API_ROOT}/users/${deletingUser._id}`, {
        method: 'DELETE',
      })
      const removedEmail = deletingUser.email
      const removedId = deletingUser._id
      setUsers((current) => current.filter((item) => item._id !== removedId))
      setDeletingUser(null)
      setNotice(`Permanently deleted deactivated account ${removedEmail}.`)
    } catch (requestError) {
      setDeleteUserError(requestError.message)
    } finally {
      setUserDeleting(false)
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
              navigateTo('dashboard')
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
        <button
          className="workspace-switcher"
          type="button"
          onClick={() => navigateTo('environments')}
          title="View workspace environments"
        >
          <span className="workspace-avatar">F</span>
          <span>
            <strong>FeatureFlag Studio</strong>
            <small>{currentRoleMeta.label} · {currentEnvironment.short} scope</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <p className="nav-label">WORKSPACE</p>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <a
            className={`nav-item ${activeSection === 'dashboard' ? 'active' : ''}`}
            href="#dashboard"
            aria-current={activeSection === 'dashboard' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              navigateTo('dashboard')
            }}
          >
            <LayoutDashboard size={17} />
            <span>Overview</span>
          </a>
          <a
            className={`nav-item ${activeSection === 'flags' ? 'active' : ''}`}
            href="#flags"
            aria-current={activeSection === 'flags' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              navigateTo('flags')
            }}
          >
            <ToggleLeft size={17} />
            <span>Feature flags</span>
            <b>{flags.length}</b>
          </a>
          <a
            className={`nav-item ${activeSection === 'environments' ? 'active' : ''}`}
            href="#environments"
            aria-current={activeSection === 'environments' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              navigateTo('environments')
            }}
          >
            <FlaskConical size={17} />
            <span>Environments</span>
            <b>{environments.length}</b>
          </a>
        </nav>
        <p className="nav-label nav-label-spaced">GOVERNANCE</p>
        <nav className="sidebar-nav" aria-label="Governance navigation">
          {canManageUsers && (
            <a
              className={`nav-item ${activeSection === 'users' ? 'active' : ''}`}
              href="#users"
              aria-current={activeSection === 'users' ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault()
                navigateTo('users')
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
              aria-current={activeSection === 'activity' ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault()
                navigateTo('activity')
              }}
            >
              <Activity size={17} />
              <span>Audit activity</span>
            </a>
          )}
          <a
            className={`nav-item ${activeSection === 'settings' ? 'active' : ''}`}
            href="#settings"
            aria-current={activeSection === 'settings' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              navigateTo('settings')
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
            <button
              type="button"
              className="profile-identity-button"
              onClick={() => navigateTo('settings')}
              title="Open account & session details"
            >
              <span className="profile-avatar">{userInitials}</span>
              <span className="profile-info">
                <strong>{currentUser?.name || 'Workspace User'}</strong>
                <small>{currentUser?.email || 'Authenticated session'}</small>
              </span>
            </button>
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

      <main className="main-content" id="main-view">
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
            <strong>{sectionTitles[activeSection] || 'Overview'}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`role-badge ${currentRoleMeta.className}`}>
              {currentRoleMeta.label}
            </span>
            <span className="connection-status">
              <span className="live-dot" /> API connected
            </span>
            <div className="profile-menu-anchor" ref={profileWrapperRef}>
              <button
                type="button"
                className={`topbar-avatar topbar-avatar-button ${
                  profileMenuOpen ? 'is-open' : ''
                }`}
                onClick={handleToggleProfileMenu}
                aria-label="Open user profile menu"
                aria-haspopup="dialog"
                aria-expanded={profileMenuOpen}
                title={currentUser?.email || 'Account profile'}
              >
                {userInitials}
              </button>
              {profileMenuOpen && (
                <div
                  className="profile-popover"
                  role="dialog"
                  aria-label="Signed-in user profile"
                >
                  <div className="profile-popover-head">
                    <span className="profile-avatar">{userInitials}</span>
                    <div className="profile-popover-identity">
                      <strong>{currentUser?.name || 'Workspace User'}</strong>
                      <code>{currentUser?.email || '—'}</code>
                    </div>
                  </div>
                  <div className="profile-popover-badges">
                    <span className={`role-badge ${currentRoleMeta.className}`}>
                      {currentRoleMeta.label}
                    </span>
                    <span className="status-pill status-active">
                      <span />
                      {currentUser?.status === 'deactivated' ? 'Deactivated' : 'Active'}
                    </span>
                  </div>
                  {profileLoading && (
                    <p className="profile-popover-note">
                      <LoaderCircle className="spin" size={13} /> Syncing profile...
                    </p>
                  )}
                  {profileError && (
                    <div className="profile-popover-error" role="alert">
                      <span>{profileError}</span>
                      <button type="button" onClick={loadProfile}>
                        Retry
                      </button>
                    </div>
                  )}
                  <div className="profile-popover-section">
                    <span className="section-eyebrow">GRANTED PERMISSIONS</span>
                    <div className="permission-list compact">
                      {(currentUser?.permissions || []).length > 0 ? (
                        currentUser.permissions.map((perm) => (
                          <code key={perm} className="permission-chip">
                            {perm}
                          </code>
                        ))
                      ) : (
                        <small>No explicit permissions loaded</small>
                      )}
                    </div>
                  </div>
                  <p className="profile-popover-meta">
                    15-minute JWT held in memory · Cleared on page refresh
                  </p>
                  <div className="profile-popover-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => navigateTo('settings')}
                    >
                      <Settings size={14} /> Account & session
                    </button>
                    <button
                      type="button"
                      className="secondary-button danger-outline-button"
                      onClick={logout}
                    >
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="page-content">
          {notice && (
            <div className="notice success-notice" role="status">
              <Check size={16} />
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice('')} aria-label="Dismiss message">
                <X size={15} />
              </button>
            </div>
          )}

          {activeSection === 'dashboard' && (
            <>
              <section className="hero-row">
                <div>
                  <p className="kicker">
                    <span className="kicker-mark" /> WORKSPACE OVERVIEW
                  </p>
                  <h1>
                    Release command center<span className="heading-period">.</span>
                  </h1>
                  <p className="page-subtitle">
                    Real-time posture across environments, rollout exposure, and recent flag activity.
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
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => navigateTo('flags')}
                  >
                    <ToggleLeft size={16} /> View inventory
                  </button>
                  {canCreateFlag && (
                    <button type="button" className="primary-button" onClick={openCreateModal}>
                      <Plus size={17} /> New flag
                    </button>
                  )}
                </div>
              </section>

              {error && (
                <div className="notice error-notice" role="alert">
                  <span>{error}</span>
                  <button type="button" onClick={loadFlags} className="retry-button">
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
                  <small>In {currentEnvironment.label}</small>
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

              <section className="overview-grid">
                <div className="flags-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="section-eyebrow">
                        RECENT ACTIVITY <span />
                      </div>
                      <div className="panel-title-row">
                        <h2>Recently updated flags</h2>
                        <span className="total-pill">
                          {recentFlags.length.toString().padStart(2, '0')}
                        </span>
                      </div>
                      <p>
                        Showing state in {currentEnvironment.label}. Open Feature flags for full search and filtering.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => navigateTo('flags')}
                    >
                      Open full inventory <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table className="flags-table">
                      <thead>
                        <tr>
                          <th>FLAG</th>
                          <th>{currentEnvironment.short} STATE</th>
                          <th>ROLLOUT</th>
                          <th>UPDATED</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading ? (
                          <tr>
                            <td colSpan="4" className="table-message">
                              <LoaderCircle className="spin" size={22} />
                              <span>Loading workspace overview...</span>
                            </td>
                          </tr>
                        ) : recentFlags.length === 0 ? (
                          <tr>
                            <td colSpan="4" className="table-message empty-state">
                              <span className="empty-icon">
                                <Code2 size={21} />
                              </span>
                              <strong>No feature flags yet</strong>
                              <span>
                                {canCreateFlag
                                  ? 'Create your first feature flag to begin orchestrating releases.'
                                  : 'No feature flags have been configured in this workspace.'}
                              </span>
                              {canCreateFlag && (
                                <button
                                  type="button"
                                  className="primary-button small-primary"
                                  onClick={openCreateModal}
                                >
                                  <Plus size={15} /> Create first flag
                                </button>
                              )}
                            </td>
                          </tr>
                        ) : (
                          recentFlags.map((flag) => {
                            const cfg = flag.environments?.[environment] || {}
                            return (
                              <tr key={flag._id}>
                                <td>
                                  <div className="flag-name-cell">
                                    <div
                                      className={`flag-symbol ${
                                        cfg.enabled ? 'symbol-on' : ''
                                      }`}
                                    >
                                      <Code2 size={17} />
                                    </div>
                                    <div className="flag-details">
                                      <strong>{flag.name}</strong>
                                      <code>{flag.key}</code>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <span
                                    className={`status-pill ${
                                      cfg.enabled ? 'status-active' : 'status-deactivated'
                                    }`}
                                  >
                                    <span />
                                    {cfg.enabled ? 'Enabled' : 'Disabled'}
                                  </span>
                                </td>
                                <td>
                                  <span className="date-cell">
                                    {cfg.rolloutPercentage || 0}%
                                  </span>
                                </td>
                                <td>
                                  <span className="date-cell">
                                    {formatDate(flag.updatedAt || flag.createdAt)}
                                  </span>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flags-panel overview-side-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="section-eyebrow">
                        ENVIRONMENT POSTURE <span />
                      </div>
                      <div className="panel-title-row">
                        <h2>Release channels</h2>
                      </div>
                      <p>Live rollout summary across all three environments.</p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => navigateTo('environments')}
                    >
                      Environments <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="env-mini-list">
                    {environmentSummaries.map((envStat) => (
                      <div
                        key={envStat.key}
                        className={`env-mini-card ${
                          environment === envStat.key ? 'is-selected' : ''
                        }`}
                      >
                        <div className="env-mini-top">
                          <span className={`environment-tag ${envStat.className}`}>
                            <span />
                            {envStat.label}
                          </span>
                          <span className="env-access-pill">
                            {envStat.editable ? 'Editable' : 'Read-only'}
                          </span>
                        </div>
                        <div className="env-mini-stats">
                          <div>
                            <strong>
                              {envStat.enabled} / {envStat.total}
                            </strong>
                            <small>Enabled flags</small>
                          </div>
                          <div>
                            <strong>{envStat.averageRollout}%</strong>
                            <small>Avg rollout</small>
                          </div>
                          <div>
                            <strong>{envStat.targeted}</strong>
                            <small>Targeted</small>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          )}

          {activeSection === 'flags' && (
            <>
              <section className="hero-row">
                <div>
                  <p className="kicker">
                    <span className="kicker-mark" /> FEATURE INVENTORY
                  </p>
                  <h1>
                    Feature flags<span className="heading-period">.</span>
                  </h1>
                  <p className="page-subtitle">
                    Search, filter, and orchestrate feature rollouts and user targeting rules.
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
                    <button type="button" className="primary-button" onClick={openCreateModal}>
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
                  <button type="button" onClick={loadFlags} className="retry-button">
                    Retry <RefreshCw size={13} />
                  </button>
                </div>
              )}

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
                    type="button"
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
                                type="button"
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
                          const isBusy = flagBusyId === flag._id
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
                                    disabled={!canToggleInEnv || isBusy}
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
                                      disabled={isBusy}
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
                                      disabled={isBusy}
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

          {activeSection === 'environments' && (
            <>
              <section className="hero-row">
                <div>
                  <p className="kicker">
                    <span className="kicker-mark" /> ENVIRONMENT TOPOLOGY
                  </p>
                  <h1>
                    Release environments<span className="heading-period">.</span>
                  </h1>
                  <p className="page-subtitle">
                    Compare rollout posture across Development, Staging, and Production and manage per-environment targeting.
                  </p>
                </div>
                <div className="hero-actions">
                  <button
                    type="button"
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
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => navigateTo('flags')}
                  >
                    <ToggleLeft size={16} /> Open inventory
                  </button>
                </div>
              </section>

              {currentUser?.role !== 'admin' && (
                <div className="notice info-notice" role="status">
                  <Lock size={15} />
                  <span>
                    {currentUser?.role === 'viewer'
                      ? 'Viewer access is read-only across Development, Staging, and Production.'
                      : 'Developer access permits changes in Development and Staging. Production is read-only and requires an Administrator.'}
                  </span>
                </div>
              )}

              {error && (
                <div className="notice error-notice" role="alert">
                  <span>{error}</span>
                  <button type="button" onClick={loadFlags} className="retry-button">
                    Retry <RefreshCw size={13} />
                  </button>
                </div>
              )}

              <section className="environments-grid" aria-label="Environment cards">
                {environmentSummaries.map((envStat) => {
                  const isSelected = environment === envStat.key
                  const canToggleThisEnv =
                    permissions.has('flags:toggle') &&
                    (envStat.key !== 'production' || permissions.has('flags:production'))
                  const canEditThisEnv =
                    permissions.has('flags:update') &&
                    (envStat.key !== 'production' || permissions.has('flags:production'))

                  return (
                    <article
                      key={envStat.key}
                      className={`flags-panel environment-card ${
                        isSelected ? 'selected-env-card' : ''
                      }`}
                    >
                      <div className="environment-card-head">
                        <div>
                          <div className="environment-card-badges">
                            <span className={`environment-tag ${envStat.className}`}>
                              <span />
                              {envStat.label} ({envStat.short})
                            </span>
                            <span className="env-access-pill">
                              {envStat.editable
                                ? 'Editable'
                                : envStat.key === 'production' &&
                                    currentUser?.role === 'developer'
                                  ? 'Read-only · Admin required'
                                  : 'Read-only'}
                            </span>
                          </div>
                          <p className="environment-card-desc">{envStat.description}</p>
                        </div>
                        <button
                          type="button"
                          className={isSelected ? 'primary-button small-action-button' : 'secondary-button small-action-button'}
                          onClick={() => setEnvironment(envStat.key)}
                        >
                          {isSelected ? 'Selected scope' : `Select ${envStat.short}`}
                        </button>
                      </div>

                      <div className="environment-metrics-row">
                        <div>
                          <strong>
                            {envStat.enabled} <em>/ {envStat.total}</em>
                          </strong>
                          <small>Enabled flags</small>
                        </div>
                        <div>
                          <strong>{envStat.disabled}</strong>
                          <small>Disabled flags</small>
                        </div>
                        <div>
                          <strong>
                            {envStat.averageRollout}
                            <em>%</em>
                          </strong>
                          <small>Avg rollout</small>
                        </div>
                        <div>
                          <strong>{envStat.targeted}</strong>
                          <small>With ID lists</small>
                        </div>
                      </div>

                      <div className="environment-flag-list">
                        {loading ? (
                          <div className="environment-empty">
                            <LoaderCircle className="spin" size={18} />
                            <span>Syncing {envStat.label} flags...</span>
                          </div>
                        ) : flags.length === 0 ? (
                          <div className="environment-empty">
                            <span>No feature flags configured in {envStat.label}.</span>
                          </div>
                        ) : (
                          flags.map((flag) => {
                            const cfg = flag.environments?.[envStat.key] || {}
                            const allowCount = cfg.allowlist?.length || 0
                            const denyCount = cfg.denylist?.length || 0
                            const isBusy = flagBusyId === flag._id
                            return (
                              <div key={flag._id} className="environment-flag-row">
                                <div className="environment-flag-info">
                                  <strong>{flag.name}</strong>
                                  <code>{flag.key}</code>
                                  <small>
                                    {cfg.rolloutPercentage || 0}% rollout
                                    {(allowCount > 0 || denyCount > 0) &&
                                      ` · ${allowCount} allow / ${denyCount} deny`}
                                  </small>
                                </div>
                                <div className="environment-flag-controls">
                                  <button
                                    className={`toggle-switch ${
                                      cfg.enabled ? 'is-on' : ''
                                    }`}
                                    type="button"
                                    role="switch"
                                    disabled={!canToggleThisEnv || isBusy}
                                    aria-checked={Boolean(cfg.enabled)}
                                    aria-label={`${
                                      cfg.enabled ? 'Disable' : 'Enable'
                                    } ${flag.name} in ${envStat.label}`}
                                    onClick={() => toggleFlag(flag, envStat.key)}
                                  >
                                    <span />
                                  </button>
                                  {canEditThisEnv && (
                                    <button
                                      type="button"
                                      className="row-action"
                                      disabled={isBusy}
                                      onClick={() => openEditModal(flag, envStat.key)}
                                      aria-label={`Configure ${flag.name} in ${envStat.label}`}
                                      title={`Configure ${envStat.label} targeting`}
                                    >
                                      <Pencil size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </article>
                  )
                })}
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
                    Manage workspace members, assign role-based permissions, and deactivate or permanently remove deactivated accounts.
                  </p>
                </div>
                <div className="hero-actions">
                  <button
                    type="button"
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
                  <button type="button" onClick={loadUsers} className="retry-button">
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
                      Role changes apply on the next API request. Deactivated accounts can be reactivated or permanently deleted.
                    </p>
                  </div>
                  <button
                    type="button"
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
                          const isBusy = userBusyId === member._id
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
                                    disabled={isSelf || isBusy}
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
                                    disabled={isSelf || isBusy}
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
                                  {member.status === 'deactivated' && !isSelf && (
                                    <button
                                      className="secondary-button small-action-button danger-outline-button"
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => openDeleteUserModal(member)}
                                      aria-label={`Delete ${member.email} permanently`}
                                      title="Permanently delete this deactivated user"
                                    >
                                      <Trash2 size={14} /> Delete permanently
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
                    type="button"
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
                  <button type="button" onClick={loadAudit} className="retry-button">
                    Retry <RefreshCw size={13} />
                  </button>
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
                    <p>
                      Credentials, password hashes, and tokens are never stored in audit records. Historical snapshots survive user deletion.
                    </p>
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
                    Account & session<span className="heading-period">.</span>
                  </h1>
                  <p className="page-subtitle">
                    Authenticated identity, effective role permissions, and session security posture.
                  </p>
                </div>
                <div className="hero-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={loadProfile}
                    disabled={profileLoading}
                  >
                    {profileLoading ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <RefreshCw size={15} />
                    )}{' '}
                    Refresh profile
                  </button>
                  <button type="button" className="secondary-button danger-outline-button" onClick={logout}>
                    <LogOut size={15} /> Sign out & revoke session
                  </button>
                </div>
              </section>

              {profileError && (
                <div className="notice error-notice" role="alert">
                  <span>{profileError}</span>
                  <button type="button" onClick={loadProfile} className="retry-button">
                    Retry <RefreshCw size={13} />
                  </button>
                </div>
              )}

              <section className="flags-panel settings-panel">
                <div className="settings-grid">
                  <div>
                    <span className="section-eyebrow">AUTHENTICATED IDENTITY</span>
                    <div className="settings-identity-row">
                      <span className="profile-avatar large-avatar">{userInitials}</span>
                      <div>
                        <h3>{currentUser?.name || 'Workspace User'}</h3>
                        <p>
                          <code>{currentUser?.email || '—'}</code>
                        </p>
                      </div>
                    </div>
                    <div className="settings-meta-list">
                      <div>
                        <span>Assigned role</span>
                        <span className={`role-badge ${currentRoleMeta.className}`}>
                          {currentRoleMeta.label}
                        </span>
                      </div>
                      <div>
                        <span>Account status</span>
                        <span className="status-pill status-active">
                          <span />
                          {currentUser?.status === 'deactivated' ? 'Deactivated' : 'Active'}
                        </span>
                      </div>
                      <div>
                        <span>Member since</span>
                        <strong>{formatDate(currentUser?.createdAt)}</strong>
                      </div>
                    </div>
                    <p className="page-subtitle">{currentRoleMeta.summary}</p>
                  </div>
                  <div>
                    <span className="section-eyebrow">EFFECTIVE PERMISSIONS</span>
                    <div className="permission-list">
                      {(currentUser?.permissions || []).length > 0 ? (
                        currentUser.permissions.map((perm) => (
                          <code key={perm} className="permission-chip">
                            {perm}
                          </code>
                        ))
                      ) : (
                        <small>No permissions available</small>
                      )}
                    </div>
                    <span className="section-eyebrow">SESSION SECURITY</span>
                    <ul className="session-security-list">
                      <li>
                        <strong>15-minute access token expiry:</strong> Tokens are short-lived HS256 JWTs verified against your active database record on every request.
                      </li>
                      <li>
                        <strong>In-memory storage only:</strong> Access tokens are never stored in <code>localStorage</code> or <code>sessionStorage</code>. Refreshing the browser tab clears the token and requires signing in again.
                      </li>
                      <li>
                        <strong>Immediate revocation:</strong> Signing out increments your server-side <code>tokenVersion</code>, invalidating any active sessions immediately.
                      </li>
                    </ul>
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

      {deletingUser && canManageUsers && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !userDeleting) {
              closeDeleteUserModal()
            }
          }}
        >
          <section
            className="flag-modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-user-modal-title"
          >
            <div className="modal-heading">
              <div className="modal-kicker">
                <span className="modal-icon danger-icon">
                  <AlertTriangle size={17} />
                </span>
                <span>PERMANENT ACCOUNT REMOVAL</span>
              </div>
              <button
                className="modal-close"
                type="button"
                disabled={userDeleting}
                onClick={closeDeleteUserModal}
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
              <h2 id="delete-user-modal-title">Delete deactivated user?</h2>
              <p>
                This permanently removes the user account from FeatureFlag Studio and cannot be undone.
              </p>
            </div>
            <div className="confirm-modal-body">
              <div className="confirm-target-summary">
                <strong>{deletingUser.name}</strong>
                <code>{deletingUser.email}</code>
                <span className="status-pill status-deactivated">
                  <span /> Deactivated {deletingUser.role}
                </span>
              </div>
              <p className="confirm-note">
                Historical audit log entries associated with this account will be preserved for compliance, and this deletion will be recorded in the audit trail.
              </p>
              {deleteUserError && (
                <div className="form-error" role="alert">
                  {deleteUserError}
                </div>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeDeleteUserModal}
                  disabled={userDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button danger-button"
                  onClick={confirmDeleteUser}
                  disabled={userDeleting}
                >
                  {userDeleting ? (
                    <>
                      <LoaderCircle className="spin" size={16} /> Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} /> Delete permanently
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
