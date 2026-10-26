const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { app } = require("../src/server");
const User = require("../src/models/User");
const FeatureFlag = require("../src/models/FeatureFlag");
const AuditLog = require("../src/models/AuditLog");
const {
  requireAuth,
  signAccessToken,
  validateAuthConfig,
  verifyAccessToken,
} = require("../src/auth/auth");
const {
  bootstrapAdmin,
  parseBootstrapArgs,
  validateBootstrapConfig,
} = require("../src/scripts/bootstrapAdmin");

const TEST_JWT_SECRET = "a-test-secret-that-is-at-least-32-characters-long";

let mongoServer;
let httpServer;
let baseUrl;
let previousEnv;

before(async () => {
  previousEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    BCRYPT_ROUNDS: process.env.BCRYPT_ROUNDS,
    ALLOW_PUBLIC_REGISTRATION: process.env.ALLOW_PUBLIC_REGISTRATION,
    LOGIN_RATE_LIMIT_MAX: process.env.LOGIN_RATE_LIMIT_MAX,
    REGISTER_RATE_LIMIT_MAX: process.env.REGISTER_RATE_LIMIT_MAX,
  };
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.BCRYPT_ROUNDS = "4";
  process.env.ALLOW_PUBLIC_REGISTRATION = "true";

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  httpServer = app.listen(0);
  const { port } = httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(async () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.ALLOW_PUBLIC_REGISTRATION = "true";
  await Promise.all([
    User.deleteMany({}),
    FeatureFlag.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

after(async () => {
  if (httpServer) httpServer.close();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function createTestUser({
  name = "Test User",
  email,
  password = "Password123!",
  role = "viewer",
  status = "active",
}) {
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await User.create({
    name,
    email,
    passwordHash,
    role,
    status,
  });
  const token = signAccessToken(user, {
    jwtSecret: TEST_JWT_SECRET,
    expiresIn: "15m",
  });
  return { user, token, password };
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json, headers: response.headers };
}

test("authentication configuration must be complete and use a strong JWT secret", () => {
  assert.throws(
    () => validateAuthConfig({ jwtSecret: "" }),
    /Missing authentication configuration/
  );
  assert.throws(
    () => validateAuthConfig({ jwtSecret: "too-short" }),
    /at least 32 characters/
  );
});

test("expired, invalid-signature, and wrong-algorithm tokens are rejected", async () => {
  const { user } = await createTestUser({
    email: "token-check@example.com",
    role: "admin",
  });
  const config = { jwtSecret: TEST_JWT_SECRET, expiresIn: "15m" };

  const expired = jwt.sign(
    { sub: String(user._id), ver: 0 },
    TEST_JWT_SECRET,
    { expiresIn: -1, issuer: "featureflag-studio" }
  );
  assert.throws(() => verifyAccessToken(expired, config));
  assert.throws(() => verifyAccessToken(`${expired}tampered`, config));

  const wrongAlgorithm = jwt.sign(
    { sub: String(user._id), ver: 0 },
    TEST_JWT_SECRET,
    { algorithm: "HS512", issuer: "featureflag-studio" }
  );
  assert.throws(() => verifyAccessToken(wrongAlgorithm, config));
});

test("bearer headers with extra fields and unauthenticated requests are rejected", async () => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  const request = {
    get(name) {
      return name === "authorization" ? "Bearer token extra" : undefined;
    },
  };
  await requireAuth(request, response, () => {
    throw new Error("malformed bearer header was accepted");
  });
  assert.equal(response.statusCode, 401);

  const flagsRes = await api("/api/flags");
  assert.equal(flagsRes.status, 401);
  const usersRes = await api("/api/users");
  assert.equal(usersRes.status, 401);
  const auditRes = await api("/api/audit");
  assert.equal(auditRes.status, 401);
});

test("login fails safely when authentication configuration is missing", async () => {
  delete process.env.JWT_SECRET;
  const res = await api("/api/auth/login", {
    method: "POST",
    body: { email: "admin@example.com", password: "Password123!" },
  });
  assert.equal(res.status, 503);
});

test("bootstrap validates ADMIN_EMAIL explicitly, defaults to dry-run, is idempotent, and supports confirmed password reset", async () => {
  const validHash = bcrypt.hashSync("InitialAdminPass123!", 4);

  // CLI argument rules
  assert.deepEqual(parseBootstrapArgs([]), {
    apply: false,
    dryRun: true,
    resetPassword: false,
    confirmReset: false,
  });
  assert.throws(() => parseBootstrapArgs(["--dry-run", "--apply"]), /Cannot combine/);
  assert.throws(
    () => parseBootstrapArgs(["--apply", "--reset-password"]),
    /requires explicit confirmation/
  );

  // Never silently interpret ADMIN_USERNAME as ADMIN_EMAIL
  assert.throws(
    () =>
      validateBootstrapConfig({
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD_HASH: validHash,
      }),
    /ADMIN_EMAIL is required/
  );

  // Create an existing flag first to verify bootstrap never deletes flags
  await FeatureFlag.create({
    name: "Existing Flag",
    key: "existing_flag",
    description: "Must remain intact",
    environments: {
      development: { enabled: true, rolloutPercentage: 100, allowlist: [], denylist: [] },
      staging: { enabled: false, rolloutPercentage: 0, allowlist: [], denylist: [] },
      production: { enabled: false, rolloutPercentage: 0, allowlist: [], denylist: [] },
    },
  });

  const env = {
    ADMIN_EMAIL: "Admin@FeatureFlag.local",
    ADMIN_NAME: "Initial Admin",
    ADMIN_PASSWORD_HASH: validHash,
  };
  const silentLogger = { log() {} };

  // 1. Dry-run does not write
  const dryResult = await bootstrapAdmin({ env, apply: false, logger: silentLogger });
  assert.equal(dryResult.action, "would_create");
  assert.equal(await User.countDocuments(), 0);

  // 2. Apply creates the administrator reusing the existing bcrypt hash
  const createdResult = await bootstrapAdmin({ env, apply: true, logger: silentLogger });
  assert.equal(createdResult.action, "created");
  assert.equal(await User.countDocuments(), 1);

  // 3. Re-running apply is idempotent and does not duplicate the admin
  const secondRun = await bootstrapAdmin({ env, apply: true, logger: silentLogger });
  assert.equal(secondRun.action, "already_exists");
  assert.equal(await User.countDocuments(), 1);
  assert.equal(await FeatureFlag.countDocuments(), 1);

  // Verify the bootstrapped administrator can log in with ADMIN_EMAIL and the original password
  const loginRes = await api("/api/auth/login", {
    method: "POST",
    body: { email: "admin@featureflag.local", password: "InitialAdminPass123!" },
  });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.data.user.role, "admin");
  const oldToken = loginRes.body.data.accessToken;

  // 4. Confirmed password reset updates the hash and revokes prior tokens
  const newHash = bcrypt.hashSync("RecoveredAdminPass456!", 4);
  const resetResult = await bootstrapAdmin({
    env: { ...env, ADMIN_PASSWORD_HASH: newHash },
    apply: true,
    resetPassword: true,
    confirmReset: true,
    logger: silentLogger,
  });
  assert.equal(resetResult.action, "password_reset");

  const oldTokenCheck = await api("/api/auth/me", { token: oldToken });
  assert.equal(oldTokenCheck.status, 401);

  const newLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email: "admin@featureflag.local", password: "RecoveredAdminPass456!" },
  });
  assert.equal(newLogin.status, 200);
});

test("public registration assigns viewer role, prevents privilege escalation, and handles duplicate emails safely", async () => {
  const regRes = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: "New Member",
      email: "NewMember@Example.com",
      password: "StrongPassword123",
      role: "admin",
    },
  });
  assert.equal(regRes.status, 202);

  const stored = await User.findOne({ email: "newmember@example.com" }).select("+passwordHash");
  assert.ok(stored);
  assert.equal(stored.role, "viewer");
  assert.notEqual(stored.passwordHash, "StrongPassword123");
  assert.equal(await bcrypt.compare("StrongPassword123", stored.passwordHash), true);

  // Duplicate email returns identical 202 response without creating a second record
  const dupRes = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: "Duplicate",
      email: "newmember@example.com",
      password: "AnotherPassword123",
    },
  });
  assert.equal(dupRes.status, 202);
  assert.equal(dupRes.body.message, regRes.body.message);
  assert.equal(await User.countDocuments({ email: "newmember@example.com" }), 1);

  // Disabled public registration returns 403
  process.env.ALLOW_PUBLIC_REGISTRATION = "false";
  const disabledRes = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: "Blocked",
      email: "blocked@example.com",
      password: "StrongPassword123",
    },
  });
  assert.equal(disabledRes.status, 403);
});

test("login, /api/auth/me, and /api/auth/logout enforce session lifecycle", async () => {
  await createTestUser({
    name: "Alice Admin",
    email: "alice@example.com",
    password: "CorrectHorseBattery",
    role: "admin",
  });

  const badPass = await api("/api/auth/login", {
    method: "POST",
    body: { email: "alice@example.com", password: "WrongPassword" },
  });
  assert.equal(badPass.status, 401);

  const missingField = await api("/api/auth/login", {
    method: "POST",
    body: { email: "alice@example.com" },
  });
  assert.equal(missingField.status, 400);

  const loginRes = await api("/api/auth/login", {
    method: "POST",
    body: { email: "ALICE@example.com", password: "CorrectHorseBattery" },
  });
  assert.equal(loginRes.status, 200);
  const token = loginRes.body.data.accessToken;
  assert.equal(loginRes.body.data.user.role, "admin");

  const meRes = await api("/api/auth/me", { token });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.data.email, "alice@example.com");

  const logoutRes = await api("/api/auth/logout", { method: "POST", token });
  assert.equal(logoutRes.status, 200);

  const afterLogout = await api("/api/auth/me", { token });
  assert.equal(afterLogout.status, 401);
});

test("RBAC enforces admin, developer, and viewer permissions and protects production mutations", async () => {
  const admin = await createTestUser({ email: "admin@example.com", role: "admin" });
  const dev = await createTestUser({ email: "dev@example.com", role: "developer" });
  const viewer = await createTestUser({ email: "viewer@example.com", role: "viewer" });

  const defaultEnvs = {
    development: { enabled: false, rolloutPercentage: 25, allowlist: ["u1"], denylist: [] },
    staging: { enabled: false, rolloutPercentage: 0, allowlist: [], denylist: [] },
    production: { enabled: false, rolloutPercentage: 0, allowlist: [], denylist: [] },
  };

  // Viewer cannot create flags
  const viewerCreate = await api("/api/flags", {
    method: "POST",
    token: viewer.token,
    body: { name: "Viewer Flag", key: "viewer_flag", environments: defaultEnvs },
  });
  assert.equal(viewerCreate.status, 403);

  // Developer cannot create a flag that enables or configures production
  for (const prodOverride of [
    { enabled: true, rolloutPercentage: 0, allowlist: [], denylist: [] },
    { enabled: false, rolloutPercentage: 50, allowlist: [], denylist: [] },
    { enabled: false, rolloutPercentage: 0, allowlist: ["vip"], denylist: [] },
    { enabled: false, rolloutPercentage: 0, allowlist: [], denylist: ["blocked"] },
  ]) {
    const devProdCreate = await api("/api/flags", {
      method: "POST",
      token: dev.token,
      body: {
        name: "Unsafe Prod Flag",
        key: "unsafe_prod_flag",
        environments: { ...defaultEnvs, production: prodOverride },
      },
    });
    assert.equal(devProdCreate.status, 403);
  }
  assert.equal(await FeatureFlag.countDocuments({ key: "unsafe_prod_flag" }), 0);

  // Developer can create a flag with safe default production config
  const devCreate = await api("/api/flags", {
    method: "POST",
    token: dev.token,
    body: { name: "Checkout Flow", key: "checkout_flow", environments: defaultEnvs },
  });
  assert.equal(devCreate.status, 201);
  const flagId = devCreate.body.data._id;

  // Viewer can read flags but cannot update, toggle, or delete
  assert.equal((await api("/api/flags", { token: viewer.token })).status, 200);
  assert.equal((await api(`/api/flags/${flagId}`, { token: viewer.token })).status, 200);
  assert.equal(
    (
      await api(`/api/flags/${flagId}`, {
        method: "PATCH",
        token: viewer.token,
        body: { name: "Renamed" },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await api(`/api/flags/${flagId}/environments/development/toggle`, {
        method: "PATCH",
        token: viewer.token,
      })
    ).status,
    403
  );
  assert.equal(
    (await api(`/api/flags/${flagId}`, { method: "DELETE", token: viewer.token })).status,
    403
  );

  // Developer can update metadata and toggle/configure development & staging
  assert.equal(
    (
      await api(`/api/flags/${flagId}`, {
        method: "PATCH",
        token: dev.token,
        body: { description: "Updated by developer" },
      })
    ).status,
    200
  );
  assert.equal(
    (
      await api(`/api/flags/${flagId}/environments/development`, {
        method: "PATCH",
        token: dev.token,
        body: { rolloutPercentage: 80, allowlist: ["dev-user"], denylist: ["deny-user"] },
      })
    ).status,
    200
  );
  assert.equal(
    (
      await api(`/api/flags/${flagId}/environments/development/toggle`, {
        method: "PATCH",
        token: dev.token,
      })
    ).status,
    200
  );

  // Developer cannot modify or toggle production through any endpoint
  assert.equal(
    (
      await api(`/api/flags/${flagId}/environments/production`, {
        method: "PATCH",
        token: dev.token,
        body: { rolloutPercentage: 10 },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await api(`/api/flags/${flagId}/environments/production/toggle`, {
        method: "PATCH",
        token: dev.token,
      })
    ).status,
    403
  );
  assert.equal(
    (
      await api(`/api/flags/${flagId}/toggle`, {
        method: "PATCH",
        token: dev.token,
        body: { environment: "production" },
      })
    ).status,
    403
  );

  // Developer cannot delete flags
  assert.equal(
    (await api(`/api/flags/${flagId}`, { method: "DELETE", token: dev.token })).status,
    403
  );

  // Public evaluation endpoint remains unauthenticated and returns only boolean value
  const evalAllow = await api(
    "/api/flags/evaluate/checkout_flow/development?userId=dev-user"
  );
  assert.equal(evalAllow.status, 200);
  assert.deepEqual(evalAllow.body, { success: true, data: { value: true } });

  const evalDeny = await api(
    "/api/flags/evaluate/checkout_flow/development?userId=deny-user"
  );
  assert.deepEqual(evalDeny.body, { success: true, data: { value: false } });

  // Admin can modify production and delete flags
  assert.equal(
    (
      await api(`/api/flags/${flagId}/environments/production/toggle`, {
        method: "PATCH",
        token: admin.token,
      })
    ).status,
    200
  );
  assert.equal(
    (await api(`/api/flags/${flagId}`, { method: "DELETE", token: admin.token })).status,
    200
  );
});

test("user management enforces role assignment, deactivation, and last-admin protection, and records audit logs", async () => {
  const admin = await createTestUser({
    name: "Primary Admin",
    email: "admin@example.com",
    role: "admin",
  });
  const dev = await createTestUser({
    name: "Dev User",
    email: "dev@example.com",
    role: "developer",
  });

  // Non-admins cannot manage users or read audit logs
  assert.equal((await api("/api/users", { token: dev.token })).status, 403);
  assert.equal((await api("/api/audit", { token: dev.token })).status, 403);

  // Admin creates a user
  const createRes = await api("/api/users", {
    method: "POST",
    token: admin.token,
    body: {
      name: "Viewer User",
      email: "viewer@example.com",
      password: "ViewerPass123!",
      role: "viewer",
    },
  });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.data.passwordHash, undefined);

  // Reject invalid role assignment
  const invalidRole = await api(`/api/users/${dev.user._id}/role`, {
    method: "PATCH",
    token: admin.token,
    body: { role: "superadmin" },
  });
  assert.equal(invalidRole.status, 400);

  // Prevent demoting or deactivating the last active administrator
  const lastAdminDemote = await api(`/api/users/${admin.user._id}/role`, {
    method: "PATCH",
    token: admin.token,
    body: { role: "viewer" },
  });
  assert.equal(lastAdminDemote.status, 409);

  const lastAdminDeactivate = await api(`/api/users/${admin.user._id}/status`, {
    method: "PATCH",
    token: admin.token,
    body: { status: "deactivated" },
  });
  assert.equal(lastAdminDeactivate.status, 409);

  // Even when a second admin exists, self-demotion and self-deactivation are blocked
  const secondAdmin = await createTestUser({
    name: "Second Admin",
    email: "admin2@example.com",
    role: "admin",
  });
  const selfDemote = await api(`/api/users/${admin.user._id}/role`, {
    method: "PATCH",
    token: admin.token,
    body: { role: "viewer" },
  });
  assert.equal(selfDemote.status, 400);

  const selfDeactivate = await api(`/api/users/${admin.user._id}/status`, {
    method: "PATCH",
    token: admin.token,
    body: { status: "deactivated" },
  });
  assert.equal(selfDeactivate.status, 400);
  await User.deleteOne({ _id: secondAdmin.user._id });

  // Role change takes effect immediately on the next request without re-issuing the token
  const demoteDev = await api(`/api/users/${dev.user._id}/role`, {
    method: "PATCH",
    token: admin.token,
    body: { role: "viewer" },
  });
  assert.equal(demoteDev.status, 200);

  const devCreateAfterDemote = await api("/api/flags", {
    method: "POST",
    token: dev.token,
    body: {
      name: "Blocked Flag",
      key: "blocked_flag",
      environments: {
        development: { enabled: false, rolloutPercentage: 0, allowlist: [], denylist: [] },
        staging: { enabled: false, rolloutPercentage: 0, allowlist: [], denylist: [] },
        production: { enabled: false, rolloutPercentage: 0, allowlist: [], denylist: [] },
      },
    },
  });
  assert.equal(devCreateAfterDemote.status, 403);

  // Deactivating a user revokes their active token and blocks future login
  const deactivateRes = await api(`/api/users/${dev.user._id}/status`, {
    method: "PATCH",
    token: admin.token,
    body: { status: "deactivated" },
  });
  assert.equal(deactivateRes.status, 200);

  const deactivatedTokenUse = await api("/api/flags", { token: dev.token });
  assert.equal(deactivatedTokenUse.status, 401);

  const deactivatedLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email: "dev@example.com", password: dev.password },
  });
  assert.equal(deactivatedLogin.status, 403);

  // Audit log contains the administrative events and no sensitive values
  const auditRes = await api("/api/audit", { token: admin.token });
  assert.equal(auditRes.status, 200);
  const actions = auditRes.body.data.map((entry) => entry.action);
  assert.ok(actions.includes("user.created"));
  assert.ok(actions.includes("user.role_changed"));
  assert.ok(actions.includes("user.deactivated"));
  const serializedAudit = JSON.stringify(auditRes.body.data);
  assert.equal(serializedAudit.includes("ViewerPass123!"), false);
  assert.equal(serializedAudit.includes("$2"), false);
});

test("permanent user deletion enforces deactivated-only, admin-only, self/last-admin guards, and preserves historical audit trail", async () => {
  const admin = await createTestUser({
    name: "Primary Admin",
    email: "admin@example.com",
    role: "admin",
  });
  const dev = await createTestUser({
    name: "Developer User",
    email: "dev@example.com",
    role: "developer",
  });
  const viewer = await createTestUser({
    name: "Viewer User",
    email: "viewer@example.com",
    role: "viewer",
  });

  // Have the developer perform a flag creation so they appear as an actor in AuditLog
  const flagRes = await api("/api/flags", {
    method: "POST",
    token: dev.token,
    body: {
      name: "Dev Created Flag",
      key: "dev_created_flag",
      environments: {
        development: { enabled: true, rolloutPercentage: 50, allowlist: [], denylist: [] },
        staging: { enabled: false, rolloutPercentage: 0, allowlist: [], denylist: [] },
        production: { enabled: false, rolloutPercentage: 0, allowlist: [], denylist: [] },
      },
    },
  });
  assert.equal(flagRes.status, 201);

  // 1. Unauthenticated and non-admin callers cannot delete users
  assert.equal(
    (await api(`/api/users/${viewer.user._id}`, { method: "DELETE" })).status,
    401
  );
  assert.equal(
    (
      await api(`/api/users/${viewer.user._id}`, {
        method: "DELETE",
        token: dev.token,
      })
    ).status,
    403
  );
  assert.equal(
    (
      await api(`/api/users/${dev.user._id}`, {
        method: "DELETE",
        token: viewer.token,
      })
    ).status,
    403
  );

  // 2. Invalid IDs and nonexistent users return 400 and 404 safely
  assert.equal(
    (
      await api("/api/users/not-a-valid-object-id", {
        method: "DELETE",
        token: admin.token,
      })
    ).status,
    400
  );
  assert.equal(
    (
      await api("/api/users/000000000000000000000000", {
        method: "DELETE",
        token: admin.token,
      })
    ).status,
    404
  );

  // 3. Cannot delete the last active administrator (409) or self when another admin exists (400)
  assert.equal(
    (
      await api(`/api/users/${admin.user._id}`, {
        method: "DELETE",
        token: admin.token,
      })
    ).status,
    409
  );
  const secondAdmin = await createTestUser({
    name: "Backup Admin",
    email: "admin2@example.com",
    role: "admin",
  });
  assert.equal(
    (
      await api(`/api/users/${admin.user._id}`, {
        method: "DELETE",
        token: admin.token,
      })
    ).status,
    400
  );
  await User.deleteOne({ _id: secondAdmin.user._id });

  // 4. Cannot delete an active user before deactivating them
  const activeDelete = await api(`/api/users/${dev.user._id}`, {
    method: "DELETE",
    token: admin.token,
  });
  assert.equal(activeDelete.status, 409);
  assert.match(activeDelete.body.message, /Deactivate the user first/i);

  // 5. Deactivate the developer account, then permanently delete it
  const deactivateDev = await api(`/api/users/${dev.user._id}/status`, {
    method: "PATCH",
    token: admin.token,
    body: { status: "deactivated" },
  });
  assert.equal(deactivateDev.status, 200);

  const deleteDev = await api(`/api/users/${dev.user._id}`, {
    method: "DELETE",
    token: admin.token,
  });
  assert.equal(deleteDev.status, 200);
  assert.equal(deleteDev.body.data.email, "dev@example.com");
  assert.equal(await User.findById(dev.user._id), null);

  // 6. Repeated deletion request returns 404 safely without crashing
  const repeatDelete = await api(`/api/users/${dev.user._id}`, {
    method: "DELETE",
    token: admin.token,
  });
  assert.equal(repeatDelete.status, 404);

  // 7. Historical audit records survive user deletion, and user.deleted is recorded
  const auditRes = await api("/api/audit", { token: admin.token });
  assert.equal(auditRes.status, 200);
  const events = auditRes.body.data;

  const historicalFlagEvent = events.find(
    (entry) =>
      entry.action === "flag.created" && entry.actorEmail === "dev@example.com"
  );
  assert.ok(historicalFlagEvent, "historical flag.created event by deleted user must survive");
  assert.equal(historicalFlagEvent.targetLabel, "dev_created_flag");

  const historicalDeactivateEvent = events.find(
    (entry) =>
      entry.action === "user.deactivated" && entry.targetLabel === "dev@example.com"
  );
  assert.ok(historicalDeactivateEvent, "historical user.deactivated event must survive");

  const deletionEvent = events.find(
    (entry) =>
      entry.action === "user.deleted" && entry.targetLabel === "dev@example.com"
  );
  assert.ok(deletionEvent, "user.deleted audit event must be recorded");
  assert.equal(deletionEvent.actorEmail, "admin@example.com");
  assert.equal(String(deletionEvent.actor), String(admin.user._id));
});

test("prevent non-admins from changing flag keys when enabled in production while allowing safe edits and admin overrides", async () => {
  const admin = await createTestUser({
    name: "Primary Admin",
    email: "admin@example.com",
    role: "admin",
  });
  const dev = await createTestUser({
    name: "Developer User",
    email: "dev@example.com",
    role: "developer",
  });
  const viewer = await createTestUser({
    name: "Viewer User",
    email: "viewer@example.com",
    role: "viewer",
  });

  // 1. Developer creates a flag that is disabled in production and can rename its key
  const nonProdCreate = await api("/api/flags", {
    method: "POST",
    token: dev.token,
    body: {
      name: "Search V2",
      key: "search_v2_draft",
      description: "Initial draft key",
      environments: {
        development: { enabled: true, rolloutPercentage: 100, allowlist: [], denylist: [] },
        staging: { enabled: true, rolloutPercentage: 50, allowlist: [], denylist: [] },
        production: { enabled: false, rolloutPercentage: 0, allowlist: [], denylist: [] },
      },
    },
  });
  assert.equal(nonProdCreate.status, 201);
  const flagId = nonProdCreate.body.data._id;

  const devAllowedKeyRename = await api(`/api/flags/${flagId}`, {
    method: "PATCH",
    token: dev.token,
    body: {
      name: "Search V2 Ready",
      key: "search_v2",
    },
  });
  assert.equal(devAllowedKeyRename.status, 200);
  assert.equal(devAllowedKeyRename.body.data.key, "search_v2");
  assert.equal(devAllowedKeyRename.body.data.name, "Search V2 Ready");

  // 2. Admin enables the flag in production
  const enableProd = await api(`/api/flags/${flagId}/environments/production/toggle`, {
    method: "PATCH",
    token: admin.token,
  });
  assert.equal(enableProd.status, 200);
  assert.equal(enableProd.body.data.environments.production.enabled, true);

  // 3. Developer attempts to change the key on the production-enabled flag (including mixed fields) -> 403 and no partial write
  const devBlockedKeyRename = await api(`/api/flags/${flagId}`, {
    method: "PATCH",
    token: dev.token,
    body: {
      name: "Should Not Persist",
      key: "search_v2_renamed_by_dev",
      description: "Attempted bypass with extra fields",
    },
  });
  assert.equal(devBlockedKeyRename.status, 403);
  assert.match(
    devBlockedKeyRename.body.message,
    /Only administrators can change the key of a flag enabled in production/i
  );

  const storedAfterBlocked = await FeatureFlag.findById(flagId);
  assert.equal(storedAfterBlocked.key, "search_v2");
  assert.equal(storedAfterBlocked.name, "Search V2 Ready");
  assert.equal(storedAfterBlocked.description, "Initial draft key");

  // 4. Viewer is also blocked from changing the key
  const viewerBlocked = await api(`/api/flags/${flagId}`, {
    method: "PATCH",
    token: viewer.token,
    body: { key: "search_v2_viewer" },
  });
  assert.equal(viewerBlocked.status, 403);

  // 5. Developer can still update name/description on a production-enabled flag when key is omitted or unchanged
  const devMetadataOnly = await api(`/api/flags/${flagId}`, {
    method: "PATCH",
    token: dev.token,
    body: {
      name: "Search V2 Live",
      key: "  SEARCH_V2  ",
      description: "Updated description without changing key",
    },
  });
  assert.equal(devMetadataOnly.status, 200);
  assert.equal(devMetadataOnly.body.data.key, "search_v2");
  assert.equal(devMetadataOnly.body.data.name, "Search V2 Live");

  // 6. Admin is permitted to change the key on a production-enabled flag when valid
  const adminKeyRename = await api(`/api/flags/${flagId}`, {
    method: "PATCH",
    token: admin.token,
    body: {
      key: "search_v2_prod",
    },
  });
  assert.equal(adminKeyRename.status, 200);
  assert.equal(adminKeyRename.body.data.key, "search_v2_prod");
});
