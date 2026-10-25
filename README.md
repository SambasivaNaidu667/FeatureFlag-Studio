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

To inspect a migration without writes, set `MONGODB_URI` to an isolated
database and run `node src/scripts/migrateFeatureFlags.js --dry-run`.
Never use a production URI for experiments. A live migration requires an
explicit maintenance-window decision and is not part of normal startup.

`MONGODB_DNS_SERVER` is optional. Leave it unset to use the operating
system resolver; set it only when the local resolver cannot resolve the
MongoDB SRV record.
