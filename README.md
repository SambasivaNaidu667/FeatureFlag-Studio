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

## Authentication

The flag-management API uses short-lived JWT bearer tokens. Configure these
server-only variables before starting the backend:

- `ADMIN_USERNAME`: administrator login name.
- `ADMIN_PASSWORD_HASH`: bcrypt hash of the administrator password.
- `JWT_SECRET`: at least 32 random characters; keep it private.
- `JWT_EXPIRES_IN`: token lifetime such as `15m`.
- `CLIENT_ORIGIN`: exact frontend origin, such as `http://localhost:5173`.

For a known feature flag and valid environment, the public evaluation endpoint
returns `{ success: true, data: { value: true|false } }`.

Internal evaluator reasons are not returned to unauthenticated callers.

Because callers can still submit an arbitrary identity and observe the boolean decision, this endpoint can reveal whether a guessed identity receives a feature. Use opaque identifiers and do not treat response minimization as a complete confidentiality boundary.

**Important:** Never use the public evaluation result as an authorization check for sensitive server-side operations. Those operations must enforce authorization independently.

Login and public evaluation use separate in-memory per-IP rate limits:

- Login: 10 requests per 15 minutes by default.
- Evaluation: 300 requests per minute by default.

Override them with `LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MS`,
`EVALUATION_RATE_LIMIT_MAX`, and `EVALUATION_RATE_LIMIT_WINDOW_MS`. The limits
return HTTP 429 and standard `RateLimit-*` headers. The limiter uses
`req.ip`; do not enable Express `trust proxy` for arbitrary proxies. If the
application runs behind a trusted reverse proxy, configure proxy trust
carefully so client IPs cannot be spoofed. The in-memory limits are per
process and are not shared across multiple server instances.

Generate a password hash without putting the plaintext password in a file:

```powershell
cd server
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" "choose-a-strong-password"
```

Copy the printed hash into the server's private `.env` as
`ADMIN_PASSWORD_HASH`. Generate a secret with a password manager or a
cryptographically secure generator, for example:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The browser login screen posts credentials to `POST /api/auth/login`. The
returned access token is kept in memory only and is sent as a bearer token for
management requests. Signing out or reloading the page removes access.

The following endpoints are intentionally public:

- `GET /api/health`: reports whether the API is running, the current
  environment, the database connection status, and a timestamp.
- `GET /api/flags/evaluate/:key/:environmentName`: returns the evaluation
  result as `{ success: true, data: { value: true|false } }` for a known
  feature flag and valid environment. It does not expose internal evaluator
  reasons, flag configuration, allowlists, or denylists. A missing flag
  returns `404` to preserve the existing API contract, so flag-key existence
  remains observable.

The public evaluation endpoint accepts a caller-supplied `userId`, so callers
can test arbitrary identities and observe their boolean decisions. Use opaque
identifiers and do not treat response minimization as a complete confidentiality
boundary. Never use the evaluation result as authorization for sensitive
server-side operations; those operations must enforce authorization
independently.

All other `/api/flags` routes require a valid administrator bearer token.
Missing or invalid authentication configuration prevents the server from
starting; there is no unauthenticated development bypass. This initial design
uses one configured administrator and does not yet provide multi-user roles,
tenant isolation, refresh tokens, or audit history.
