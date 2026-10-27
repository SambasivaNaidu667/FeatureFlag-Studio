# FeatureFlag Studio

FeatureFlag Studio is a feature-flag management platform for development teams. It provides a central place to manage feature flags, configure them for Development, Staging, and Production, manage team access, and review audit activity.

## Live Demo

- **Application:** https://feature-flag-studio-kappa.vercel.app
- **Backend health:** https://feature-flag-studio-api-render.onrender.com/api/health
- **Demo video:** https://drive.google.com/file/d/1jnZTwp_rbblbHIVxCC_LrXo8-Wz2P4Fn/view?usp=sharing
- **Source code:** https://github.com/SambasivaNaidu667/FeatureFlag-Studio

> The demo video must be accessible to evaluators. In Google Drive, confirm that the file's General access is set to **Anyone with the link — Viewer**, if permitted by your submission requirements.

## Problem Statement

Releasing application functionality often requires teams to coordinate code changes and deployments even when they only need to enable or disable a feature. Teams also need to keep track of how a feature is configured across development, testing, and production environments, and understand who changed a configuration.

FeatureFlag Studio provides a central interface for managing feature flags and environment-specific settings, with role-based access control and audit activity to support safer, more traceable releases.

## Target Users

- Software developers managing feature availability during development and release.
- Engineering teams working across multiple environments.
- Application administrators responsible for access, user roles, and configuration oversight.

## Key Features

- **Feature flag management:** View, create, edit, and manage feature flags.
- **Environment-specific configuration:** Organize flag settings for Development, Staging, and Production.
- **Flag evaluation API:** Retrieve an evaluated flag value through the backend API.
- **Authentication:** Authenticate users with password hashing and short-lived JWT bearer tokens.
- **Role-based access control (RBAC):** Apply different permissions to Admin, Developer, and Viewer roles.
- **Team management:** Review users, roles, and account statuses; authorized administrators can manage user access.
- **Audit activity:** Review recorded privileged actions and their associated actors, resources, and timestamps.
- **API safeguards:** Validate requests, apply rate limits to selected public/authentication endpoints, and return appropriate authorization errors.
- **Persistent storage:** Store user, feature-flag, and audit data in MongoDB.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite |
| Backend | Node.js, Express |
| Database | MongoDB Atlas / MongoDB |
| Authentication | bcrypt password hashing, JWT bearer tokens |
| Version control | Git, GitHub |
| Frontend hosting | Vercel |
| Backend hosting | Render |

## Architecture

```text
User's Browser
      |
      v
React + Vite Frontend (Vercel)
      |
      | HTTPS requests to /api
      v
Node.js + Express REST API (Render)
      |
      v
MongoDB Atlas
```

The frontend uses the `VITE_API_BASE_URL` environment variable to locate the backend API. In production, it is configured as:

```text
https://feature-flag-studio-api-render.onrender.com/api
```

The backend connects to MongoDB Atlas using `MONGODB_URI`. Secrets are configured in the hosting provider's environment settings and must not be committed to the repository.

## Major Workflows

1. **Manage a feature flag:** Review the available flags and manage a flag's configuration.
2. **Configure environments:** Inspect flag configuration for Development, Staging, and Production.
3. **Manage team access:** Review users and their assigned roles; administrative operations are protected by permissions.
4. **Review audit activity:** Inspect the recorded history of privileged configuration and user-management actions.
5. **Evaluate a flag:** Call the evaluation endpoint to retrieve the public evaluated value for a flag and environment.

## Role-Based Access Control

The backend checks the authenticated user's current role and account status rather than relying only on role information carried in a token.

| Role | Summary of permissions |
|---|---|
| **Admin** (`admin`) | Manage feature flags across environments, manage users and roles, and view audit activity, subject to safeguards protecting the last active administrator and the administrator's own account. |
| **Developer** (`developer`) | Read flags, create flags, edit flag metadata, and configure/toggle Development and Staging; cannot change Production configuration, delete flags, manage users, or view audit logs. |
| **Viewer** (`viewer`) | Read feature flags and environment configuration; cannot perform mutations or access administrative user/audit endpoints. |

The backend remains the authority for permission checks. A feature-flag evaluation result must not be used as an authorization check for sensitive operations.

## API Endpoints

The API is mounted under `/api`.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health and database status check. |
| `GET` | `/api/auth/config` | Read public authentication configuration, including whether registration is enabled. |
| `POST` | `/api/auth/login` | Authenticate a user. |
| `POST` | `/api/auth/logout` | Sign out and revoke the user's current token version. |
| `GET` | `/api/auth/me` | Get the authenticated user's profile and permissions. |
| `GET` | `/api/flags` | List feature flags. |
| `GET` | `/api/flags/:id` | Get a feature flag. |
| `PATCH` | `/api/flags/:id/environments/:environmentName` | Update an environment's flag configuration. |
| `PATCH` | `/api/flags/:id/environments/:environmentName/toggle` | Toggle a flag in an environment. |
| `GET` | `/api/flags/evaluate/:key/:environmentName?userId=...` | Evaluate a flag and return its public value. |
| `GET` | `/api/users` | List team users (authorized roles only). |
| `GET` | `/api/audit?limit=10` | Read audit events (admin only). |

Access to endpoints depends on authentication and role permissions. See the route definitions in `server/src` for the complete API contract.

## Local Development Setup

### Prerequisites

- Node.js version supported by `server/package.json` (Node.js 22 or newer is recommended based on the configured engine requirement).
- `npm`.
- A MongoDB database for local development/testing, such as a dedicated MongoDB Atlas development database.

### 1. Clone the repository

```bash
git clone https://github.com/SambasivaNaidu667/FeatureFlag-Studio.git
cd FeatureFlag-Studio
```

### 2. Configure the backend

```bash
cd server
npm install
```

Create `server/.env` using `server/.env.example` as a guide. Set the required values for your development database and secrets. For example, use the following variable names and provide your own local values:

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=<your-development-mongodb-connection-string>
JWT_SECRET=<your-own-random-secret-of-at-least-32-characters>
JWT_EXPIRES_IN=15m
CLIENT_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
ALLOW_PUBLIC_REGISTRATION=false
```

The administrator bootstrap/recovery workflow may also use `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD_HASH`. Follow the bootstrap instructions below and the scripts documented in `server/package.json`; do not commit `server/.env` or real secrets.

Run the backend tests and start the API:

```bash
npm test
npm start
```

The backend normally listens on port `5000` locally, unless `PORT` is set to another value. Test the health endpoint at `http://localhost:5000/api/health`.

### 3. Configure the frontend

Open a second terminal from the repository root:

```bash
cd client
npm install
```

Create `client/.env.local` with:

```env
VITE_API_BASE_URL=http://localhost:5000/api
```

Start the Vite development server:

```bash
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Vite environment variables are embedded at build time, so restart the development server after changing them.

## Administrator Bootstrap and Recovery

The bootstrap script does not run automatically when the server starts and defaults to dry-run mode.

```bash
cd server

# Preview the action; dry-run by default:
npm run bootstrap-admin

# Apply the bootstrap operation when appropriate:
npm run bootstrap-admin -- --apply
```

Use the `ADMIN_EMAIL`, `ADMIN_NAME`, and password-hash configuration expected by the scripts. The administrator password hash must be generated through the project's password-setting procedure; never put a plaintext password or real secret in this README.

For password recovery, follow the repository's `set-admin-password` and bootstrap script instructions. Do not run recovery commands against production unless recovery is genuinely needed and you understand their effects.

## Legacy Feature-Flag Data Migration

The project includes an explicit migration script for legacy feature-flag records. The migration is not run automatically.

```bash
cd server

# Validate and report without applying writes:
node src/scripts/migrateFeatureFlags.js --dry-run

# Apply the migration only after reviewing the dry-run output:
node src/scripts/migrateFeatureFlags.js --apply
```

Do not experiment against a production database. Use an isolated development/test database, preserve backups, and review the dry-run output before applying any data migration. The migration script's `--apply` option is required before it writes changes.

`MONGODB_DNS_SERVER` is optional. Leave it unset under normal circumstances so the operating system resolver can resolve MongoDB SRV records; only configure it when a known local DNS-resolution problem requires an override.

## Security Notes

- Store credentials and secret values in environment variables or the hosting provider's secret settings. Never commit `.env` files, JWT secrets, database URIs, or password hashes.
- Passwords are hashed with bcrypt; they must not be stored or logged in plaintext.
- Access tokens are short-lived JWT bearer tokens sent in the `Authorization` header. In the frontend, tokens are held in memory rather than browser local/session storage; refreshing the page may require signing in again.
- The backend checks current user status and permissions and supports token-version revocation.
- Registration is disabled by default unless `ALLOW_PUBLIC_REGISTRATION=true` is explicitly configured.
- The public feature-evaluation API returns only the evaluated value. Do not use a feature flag as a substitute for server-side authorization.
- Apply database network-access rules and use a least-privilege database user appropriate to the hosting environment.

## Deployment

### Frontend — Vercel

- **Production URL:** https://feature-flag-studio-kappa.vercel.app
- **Project root directory:** `client`
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Production environment variable:** `VITE_API_BASE_URL=https://feature-flag-studio-api-render.onrender.com/api`

### Backend — Render

- **Production URL:** https://feature-flag-studio-api-render.onrender.com
- **Root directory:** `server`
- **Build command:** `npm install`
- **Start command:** `npm start`
- **Health check path:** `/api/health`

Configure these backend environment variables securely in Render: `MONGODB_URI`, `JWT_SECRET`, `NODE_ENV`, `CLIENT_ORIGIN`, `TRUST_PROXY`, `JWT_EXPIRES_IN`, and `ALLOW_PUBLIC_REGISTRATION`. Render supplies `PORT` automatically. Do not put secret values in the repository or README.

### Database — MongoDB Atlas

The deployed backend uses the existing MongoDB Atlas database through `MONGODB_URI`. Keep production credentials private and configure Atlas network access according to the chosen hosting plan and connectivity requirements.

## Project Structure

```text
FeatureFlag-Studio/
├── client/                  # React + Vite frontend
├── server/                  # Express backend and API
│   ├── src/                  # Server, configuration, routes, and application logic
│   ├── tests/                # Backend tests
│   ├── .env.example          # Environment-variable template (no secrets)
│   └── package.json
├── render.yaml               # Render service configuration
└── README.md
```

## Testing

Run the backend test suite from the `server` directory:

```bash
npm test
```

Before submitting, verify the deployed health endpoint, sign-in, flag and environment views, team/role views, and audit activity through the live frontend.

## Demo Video

FeatureFlag Studio demo: https://drive.google.com/file/d/1jnZTwp_rbblbHIVxCC_LrXo8-Wz2P4Fn/view?usp=sharing

The demo shows the deployed application and its major workflows. Make sure the video-sharing permission allows evaluators to open it without requesting access.

## License

Add the license chosen for this project here, if applicable.
