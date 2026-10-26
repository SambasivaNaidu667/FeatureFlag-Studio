# FeatureFlag Studio

A feature flag management and rollout platform built with React,
Node.js, Express, and MongoDB.

## Problem Statement

Developers need a controlled way to enable, disable, and gradually
release application features without repeatedly changing application code.

## Target Users

- Software developers
- Development teams
- Application administrators

## Planned Features

- Project and environment management
- Feature flag creation and configuration
- Attribute-based targeting rules
- Deterministic percentage-based rollouts
- Feature evaluation API
- Configuration audit history
- Configuration rollback
- Authentication and authorization

## Technology Stack

- Frontend: React
- Backend: Node.js and Express
- Database: MongoDB
- Version Control: Git and GitHub

## Project Structure

- `client/`: React frontend
- `server/`: Express backend
- `docs/`: Architecture and project documentation

## Development Status

Initial project structure created.
Application functionality will be implemented incrementally.

## Security

Secrets must be stored in environment variables.
Never commit real credentials or API keys.

## Setup

The backend uses the nested `environments` model. Existing legacy records
must be migrated before running the new application against that database.
The migration is intentionally not run automatically.

```powershell
cd server
npm install
npm test
npm start
```

In a second terminal:

```powershell
cd client
npm install
npm run dev
```

Environment updates use
`PATCH /api/flags/:id/environments/:environmentName` and toggles use the
same path with `/toggle`. Evaluation is available at
`GET /api/flags/evaluate/:key/:environmentName?userId=...`.

Migration commands are explicit:

```powershell
node src/scripts/migrateFeatureFlags.js --dry-run
node src/scripts/migrateFeatureFlags.js --apply
```

No arguments perform no migration. `--dry-run` validates and reports without
creating a backup collection or writing feature flags. `--apply` is required
before any writes. The live path creates and deeply verifies a separate
backup, uses conditional atomic updates, and reports partial progress if a
later document conflicts. Preserve the backup, resolve validation or
concurrency conflicts, and inspect the backup before retrying. Use an
isolated database for tests and never use a production URI for experiments.

`MONGODB_DNS_SERVER` is optional. Leave it unset to use the operating
system resolver; set it only when the local resolver cannot resolve the
MongoDB SRV record.

## Authentication and Role-Based Access Control (RBAC)

FeatureFlag Studio uses persistent MongoDB user accounts (`User` collection), bcrypt password hashing, and short-lived HS256 JWT bearer tokens verified against server-side user state on every request.

### Required Environment Variables (`server/.env`)

- `JWT_SECRET`: at least 32 random characters; keep it private.
- `JWT_EXPIRES_IN`: token lifetime (default `15m`).
- `CLIENT_ORIGIN`: comma-separated allowed frontend origins, such as `http://localhost:5173,http://127.0.0.1:5173`.
- `ADMIN_EMAIL`: explicit email address for bootstrapping the initial administrator (for example, `admin@featureflag.local`). `ADMIN_USERNAME` is never silently interpreted as an email.
- `ADMIN_NAME`: display name for the initial administrator (default `Studio Admin`).
- `ADMIN_PASSWORD_HASH`: 60-character bcrypt hash used by the administrator bootstrap/recovery script.
- `ALLOW_PUBLIC_REGISTRATION`: set to `true` to enable self-service Viewer registration (`POST /api/auth/register`), or `false` (default) to restrict account creation to administrators.

### Bootstrapping and Recovering the Initial Administrator

The bootstrap script never runs automatically on server startup, never deletes feature flags, and defaults to dry-run mode:

```powershell
cd server

# 1. Preview what bootstrap will do (dry-run by default; no database writes):
npm run bootstrap-admin

# 2. Create the initial administrator in MongoDB (idempotent; safe to re-run):
npm run bootstrap-admin -- --apply
```

After running `--apply`, sign in at `http://localhost:5173` using:
- **Email:** the address configured in `ADMIN_EMAIL` (e.g., `admin@featureflag.local`)
- **Password:** the administrator password matching `ADMIN_PASSWORD_HASH`

**Administrator password recovery procedure:**

```powershell
cd server
# 1. Prompt for a new password (input hidden) and update ADMIN_PASSWORD_HASH in server/.env:
npm run set-admin-password

# 2. Apply the updated hash to the administrator record and revoke prior tokens:
npm run bootstrap-admin -- --apply --reset-password --confirm-reset
```

### Roles and Permissions

Every authenticated request verifies the JWT signature and reloads the user's current `role`, `status`, and `tokenVersion` from MongoDB. Stale role claims are never trusted, and role changes take effect on the very next request:

| Role | Capabilities | Restrictions |
|---|---|---|
| **Admin** (`admin`) | Read, create, edit, toggle, and delete feature flags across all environments (including `production`); create users, assign roles, activate/deactivate accounts (`GET/POST/PATCH /api/users`); view audit trail (`GET /api/audit`). | Cannot demote or deactivate the last active administrator or modify own role/status. |
| **Developer** (`developer`) | Read all feature flags; create flags (with safe default `production` config); edit flag metadata; configure and toggle `development` and `staging` environments. | Cannot modify or toggle `production` configuration via any endpoint (`403`); cannot delete flags (`403`); cannot manage users or view audit logs (`403`). |
| **Viewer** (`viewer`) | Read feature flags and environment configurations (`GET /api/flags`, `GET /api/flags/:id`). | Read-only; cannot create, edit, toggle, or delete flags (`403`), or access user/audit endpoints (`403`). |

### Session Behavior and Token Revocation

- **In-memory bearer tokens:** Access tokens (`15m` default lifetime) are held exclusively in React state in memory and sent via `Authorization: Bearer <token>`. They are intentionally never written to `localStorage` or `sessionStorage`, avoiding persistent XSS token theft.
- **Page refresh behavior:** Because tokens live only in memory, refreshing or closing the browser tab clears the token and requires signing in again. Expired sessions automatically return the user to the sign-in screen with a clear notice.
- **Server-side revocation (`tokenVersion`):** Each user document stores a `tokenVersion` counter embedded in the JWT (`ver`). Signing out (`POST /api/auth/logout`), deactivating an account (`PATCH /api/users/:id/status`), or running administrator password recovery increments `tokenVersion`, immediately invalidating all previously issued tokens for that user across all sessions.

### Audit Logging

All successful privileged mutations (`flag.created`, `flag.updated`, `flag.targeting_updated`, `flag.enabled`, `flag.disabled`, `flag.deleted`, `user.created`, `user.role_changed`, `user.deactivated`, `user.reactivated`) are recorded in the `AuditLog` collection with actor ID, actor email, action, target resource, safe summary, and timestamp. Passwords, hashes, and tokens are never logged. Only administrators can query `GET /api/audit` or view the **Audit activity** screen.

### Public Endpoints and Rate Limiting

- `GET /api/health`: reports API liveness, environment, database status, and timestamp.
- `GET /api/flags/evaluate/:key/:environmentName?userId=...`: public evaluation endpoint returning only `{ success: true, data: { value: true|false } }`. Internal evaluator reasons, allowlists, and denylists are never exposed. **Never use feature-flag evaluation as an authorization check for sensitive operations.**
- Rate limits (configurable via `LOGIN_RATE_LIMIT_*`, `REGISTER_RATE_LIMIT_*`, `EVALUATION_RATE_LIMIT_*`) protect `/api/auth/login` (10 / 15m), `/api/auth/register` (5 / 60m), and `/api/flags/evaluate` (300 / 1m).
