
import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowDownUp,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Code2,
  Command,
  FlaskConical,
  LayoutDashboard,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  ToggleLeft,
  Trash2,
  X,
} from 'lucide-react'
import './App.css'

const API_URL = 'http://localhost:5000/api/flags'

const environments = ['development', 'staging', 'production']

const initialForm = {
  name: '',
  key: '',
  description: '',
  rolloutPercentage: 0,
  allowlist: '',
  denylist: '',
}

function App() {
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [environment, setEnvironment] = useState('development')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingFlag, setEditingFlag] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    const result = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(result.message || 'Something went wrong')
    }

    return result
  }

  async function loadFlags() {
    setLoading(true)
    setError('')

    try {
      const result = await request(API_URL)
      setFlags(result.data || [])
    } catch {
      setError(
        'Could not connect to the API. Make sure your backend is running at localhost:5000.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Initial data loading is an intentional state synchronization with the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFlags()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredFlags = useMemo(() => {
    return flags.filter((flag) => {
      const query = search.trim().toLowerCase()
      const matchesSearch =
        !query ||
        flag.name.toLowerCase().includes(query) ||
        flag.key.toLowerCase().includes(query) ||
        (flag.description || '').toLowerCase().includes(query)

      const config = flag.environments?.[environment] || {}

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'enabled' && config.enabled) ||
        (statusFilter === 'disabled' && !config.enabled)

      return matchesSearch && matchesStatus
    })
  }, [flags, search, environment, statusFilter])

  const enabledCount = flags.filter(
    (flag) => flag.environments?.[environment]?.enabled
  ).length
  const disabledCount = flags.length - enabledCount
  const rolloutTotal = flags.reduce(
    (total, flag) => total + (flag.environments?.[environment]?.rolloutPercentage || 0),
    0
  )

  function openCreateModal() {
    setEditingFlag(null)
    setForm(initialForm)
    setActionError('')
    setModalOpen(true)
  }

  function openEditModal(flag) {
    setEditingFlag(flag)
    setForm({
      name: flag.name,
      key: flag.key,
      description: flag.description || '',
      rolloutPercentage: flag.environments?.[environment]?.rolloutPercentage || 0,
      allowlist: (flag.environments?.[environment]?.allowlist || []).join(', '),
      denylist: (flag.environments?.[environment]?.denylist || []).join(', '),
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
      const url = editingFlag ? `${API_URL}/${editingFlag._id}` : API_URL
      const targeting = {
        rolloutPercentage: Number(form.rolloutPercentage),
        allowlist: form.allowlist
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
        denylist: form.denylist
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      }
      const payload = editingFlag
        ? { name: form.name, key: form.key, description: form.description }
        : {
            name: form.name,
            key: form.key,
            description: form.description,
            environments: {
              [environment]: targeting,
            },
          }

      const result = await request(url, {
        method: editingFlag ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
      const savedResult = editingFlag
        ? await request(`${API_URL}/${editingFlag._id}/environments/${environment}`, {
            method: 'PATCH',
            body: JSON.stringify(targeting),
          })
        : result

      if (editingFlag) {
        setFlags((current) =>
          current.map((flag) =>
            flag._id === editingFlag._id ? savedResult.data : flag
          )
        )
        setNotice('Feature flag updated successfully.')
      } else {
        setFlags((current) => [result.data, ...current])
        setNotice('Feature flag created successfully.')
      }

      setModalOpen(false)
      setEditingFlag(null)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleFlag(flag) {
    setNotice('')
    setError('')

    try {
      const result = await request(
        `${API_URL}/${flag._id}/environments/${environment}/toggle`,
        { method: 'PATCH' }
      )

      setFlags((current) =>
        current.map((item) =>
          item._id === flag._id ? result.data : item
        )
      )
      setNotice(
        `${result.data.name} is now ${result.configuration.enabled ? 'enabled' : 'disabled'} in ${environment}.`
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function deleteFlag(flag) {
    const confirmed = window.confirm(
      `Delete "${flag.name}"? This action cannot be undone.`
    )

    if (!confirmed) return

    setNotice('')
    setError('')

    try {
      await request(`${API_URL}/${flag._id}`, {
        method: 'DELETE',
      })

      setFlags((current) =>
        current.filter((item) => item._id !== flag._id)
      )
      setNotice(`${flag.name} was deleted.`)
    } catch (err) {
      setError(err.message)
    }
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#dashboard" aria-label="FeatureFlag Studio home">
          <span className="brand-mark">
            <Command size={22} strokeWidth={2.5} />
          </span>
          <span className="brand-name">
            featureflag<span>studio</span>
          </span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-switcher" type="button">
          <span className="workspace-avatar">F</span>
          <span className="workspace-text">
            <strong>FeatureFlag Studio</strong>
            <small>Free workspace</small>
          </span>
          <ChevronDown size={16} />
        </button>

        <div className="nav-label">PLATFORM</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#dashboard">
            <LayoutDashboard size={18} />
            <span>Overview</span>
          </a>
          <a className="nav-item" href="#flags">
            <ToggleLeft size={18} />
            <span>Feature flags</span>
            <span className="nav-count">{flags.length}</span>
          </a>
          <a className="nav-item" href="#environments">
            <FlaskConical size={18} />
            <span>Environments</span>
          </a>
          <a className="nav-item" href="#activity">
            <Activity size={18} />
            <span>Activity</span>
          </a>
        </nav>

        <div className="nav-label second-nav-label">PREFERENCES</div>
        <nav className="sidebar-nav" aria-label="Preferences">
          <a className="nav-item" href="#settings">
            <Settings size={18} />
            <span>Settings</span>
          </a>
          <a className="nav-item" href="#help">
            <CircleHelp size={18} />
            <span>Help & support</span>
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="plan-card">
            <div className="plan-icon"><ShieldCheck size={18} /></div>
            <strong>Ship with confidence</strong>
            <p>Control feature releases from one place.</p>
            <div className="plan-meter"><span /></div>
            <small>Workspace overview</small>
          </div>
          <div className="profile">
            <div className="profile-avatar">FS</div>
            <div className="profile-info">
              <strong>Studio Admin</strong>
              <small>Local workspace</small>
            </div>
            <MoreHorizontal size={19} />
          </div>
        </div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>Overview</strong>
          </div>
          <div className="topbar-actions">
            <span className="connection-status">
              <span className="status-dot" /> Local environment
            </span>
            <button className="icon-button" type="button" aria-label="Notifications">
              <Bell size={18} />
              <span className="notification-dot" />
            </button>
            <div className="topbar-avatar">FS</div>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span /> FEATURE MANAGEMENT</div>
              <h1>Feature flags<span className="heading-period">.</span></h1>
              <p className="page-subtitle">
                Manage releases, control rollouts, and ship with confidence.
              </p>
            </div>
            <button className="primary-button" onClick={openCreateModal}>
              <Plus size={18} />
              Create feature flag
            </button>
          </section>

          {notice && (
            <div className="notice success-notice" role="status">
              <Check size={17} />
              {notice}
              <button onClick={() => setNotice('')} aria-label="Dismiss message">
                <X size={16} />
              </button>
            </div>
          )}

          {error && (
            <div className="notice error-notice" role="alert">
              {error}
              <button onClick={loadFlags} className="retry-button">Retry</button>
            </div>
          )}

          <section className="stats-grid" aria-label="Feature flag statistics">
            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-label">Total flags</span>
                <span className="stat-icon purple"><ToggleLeft size={19} /></span>
              </div>
              <div className="stat-number">{flags.length}</div>
              <div className="stat-foot"><span className="stat-foot-dot purple-dot" /> All feature flags</div>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-label">Enabled</span>
                <span className="stat-icon green"><Check size={19} /></span>
              </div>
              <div className="stat-number">{enabledCount}</div>
              <div className="stat-foot"><span className="stat-foot-dot green-dot" /> Currently active</div>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-label">Disabled</span>
                <span className="stat-icon amber"><SlidersHorizontal size={19} /></span>
              </div>
              <div className="stat-number">{disabledCount}</div>
              <div className="stat-foot"><span className="stat-foot-dot amber-dot" /> Currently inactive</div>
            </article>
            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-label">Production flags</span>
                <span className="stat-icon blue"><Activity size={19} /></span>
              </div>
              <div className="stat-number">{rolloutTotal}%</div>
              <div className="stat-foot"><span className="stat-foot-dot blue-dot" /> {environment} rollout total</div>
            </article>
          </section>

          <section className="flags-panel" id="flags">
            <div className="panel-heading">
              <div>
                <div className="panel-title-row">
                  <h2>All feature flags</h2>
                  <span className="total-pill">{filteredFlags.length}</span>
                </div>
                <p>Review and manage the flags in your workspace.</p>
              </div>
              <button className="secondary-button" onClick={loadFlags} disabled={loading}>
                {loading
                  ? <LoaderCircle className="spin" size={16} />
                  : <ArrowDownUp size={16} />}
                Refresh
              </button>
            </div>

            <div className="filter-toolbar">
              <label className="search-box">
                <Search size={17} />
                <input
                  type="search"
                  placeholder="Search flags by name or key..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <kbd>/</kbd>
              </label>
              <label className="filter-select">
                <span className="sr-only">Filter by environment</span>
                <FlaskConical size={16} />
                <select
                  value={environment}
                  onChange={(event) => setEnvironment(event.target.value)}
                >
                  {environments.map((item) => (
                    <option value={item} key={item}>
                    {item.charAt(0).toUpperCase() + item.slice(1)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </label>
              <label className="filter-select status-select">
                <span className="sr-only">Filter by status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
                <ChevronDown size={15} />
              </label>
            </div>

            <div className="table-wrap">
              <table className="flags-table">
                <thead>
                  <tr>
                    <th>FLAG NAME</th>
                    <th>ENVIRONMENT</th>
                    <th>STATUS</th>
                    <th>LAST UPDATED</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="5" className="table-message">
                        <LoaderCircle className="spin" size={22} />
                        <span>Loading your feature flags...</span>
                      </td>
                    </tr>
                  ) : filteredFlags.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="table-message empty-state">
                        <span className="empty-icon"><Code2 size={24} /></span>
                        <strong>{flags.length ? 'No matching flags' : 'Your workspace is ready'}</strong>
                        <span>
                          {flags.length
                            ? 'Try changing your search or filters.'
                            : 'Create your first feature flag to get started.'}
                        </span>
                        {!flags.length && (
                          <button className="primary-button small-primary" onClick={openCreateModal}>
                            <Plus size={16} /> Create your first flag
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredFlags.map((flag) => (
                      <tr key={flag._id}>
                        {(() => {
                          const config = flag.environments?.[environment] || {}
                          return (
                            <>
                        <td>
                          <div className="flag-name-cell">
                            <div className={`flag-symbol ${config.enabled ? 'symbol-on' : ''}`}>
                              <Code2 size={18} />
                            </div>
                            <div className="flag-details">
                              <strong>{flag.name}</strong>
                              <code>{flag.key}</code>
                              {flag.description && <p>{flag.description}</p>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`environment-tag env-${environment}`}>
                            <span />
                            {environment}
                          </span>
                        </td>
                        <td>
                          <div className="status-cell">
                            <button
                              className={`toggle-switch ${config.enabled ? 'is-on' : ''}`}
                              type="button"
                              role="switch"
                              aria-checked={config.enabled}
                              aria-label={`${config.enabled ? 'Disable' : 'Enable'} ${flag.name}`}
                              onClick={() => toggleFlag(flag)}
                            >
                              <span />
                            </button>
                            <span className={`status-text ${config.enabled ? 'text-enabled' : ''}`}>
                              {config.enabled ? 'Enabled' : 'Disabled'} · {config.rolloutPercentage || 0}%
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="date-cell">
                            {new Date(flag.updatedAt || flag.createdAt).toLocaleDateString(
                              'en-IN',
                              { day: '2-digit', month: 'short', year: 'numeric' }
                            )}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="row-action"
                              title="Edit flag"
                              aria-label={`Edit ${flag.name}`}
                              onClick={() => openEditModal(flag)}
                            >
                              <Settings size={16} />
                            </button>
                            <button
                              className="row-action delete-action"
                              title="Delete flag"
                              aria-label={`Delete ${flag.name}`}
                              onClick={() => deleteFlag(flag)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                            </>
                          )
                        })()}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-footer">
              <span>
                Showing <strong>{filteredFlags.length}</strong> of <strong>{flags.length}</strong> flags
              </span>
              <span className="footer-live"><span /> Connected to MongoDB API</span>
            </div>
          </section>

          <footer className="page-footer">
            <span>FeatureFlag Studio <span>·</span> Built for safer releases.</span>
            <span><span className="footer-version-dot" /> Development workspace</span>
          </footer>
        </div>
      </main>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeModal()
        }}>
          <section className="flag-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="modal-heading">
              <div className="modal-icon"><Code2 size={21} /></div>
              <button className="modal-close" type="button" onClick={closeModal} aria-label="Close dialog">
                <X size={19} />
              </button>
              <h2 id="modal-title">{editingFlag ? 'Edit feature flag' : 'Create feature flag'}</h2>
              <p>
                {editingFlag
                  ? 'Update the configuration for this feature.'
                  : 'Define a new feature you want to control.'}
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <label className="form-field">
                <span>Flag name <b>*</b></span>
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={form.name}
                  onChange={(event) => updateForm('name', event.target.value)}
                  placeholder="e.g. New checkout experience"
                />
              </label>
              <label className="form-field">
                <span>Unique key <b>*</b></span>
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
                <small>Lowercase letters, numbers, and underscores. Must start with a letter.</small>
              </label>
              <label className="form-field">
                <span>Description</span>
                <textarea
                  maxLength={500}
                  rows={3}
                  value={form.description}
                  onChange={(event) => updateForm('description', event.target.value)}
                  placeholder="What does this flag control?"
                />
              </label>
              <label className="form-field">
                <span>{environment} rollout percentage</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={form.rolloutPercentage}
                  onChange={(event) => updateForm('rolloutPercentage', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Allowlist user IDs</span>
                <input
                  value={form.allowlist}
                  onChange={(event) => updateForm('allowlist', event.target.value)}
                  placeholder="user-1, user-2"
                />
                <small>Comma-separated IDs. Allowlisted users bypass rollout.</small>
              </label>
              <label className="form-field">
                <span>Denylist user IDs</span>
                <input
                  value={form.denylist}
                  onChange={(event) => updateForm('denylist', event.target.value)}
                  placeholder="blocked-user"
                />
                <small>Denylisted users always receive the feature disabled.</small>
              </label>
              {actionError && <div className="form-error" role="alert">{actionError}</div>}

              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving
                    ? <LoaderCircle className="spin" size={17} />
                    : <Check size={17} />}
                  {saving ? 'Saving...' : editingFlag ? 'Save changes' : 'Create flag'}
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
