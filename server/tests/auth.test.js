const assert = require("node:assert/strict");
const test = require("node:test");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { app } = require("../src/server");
const {
  authenticate,
  requireAuth,
  validateAuthConfig,
  verifyAccessToken,
} = require("../src/auth/auth");

const config = {
  username: "test-admin",
  passwordHash: bcrypt.hashSync("correct-password", 4),
  jwtSecret: "a-test-secret-that-is-at-least-32-characters-long",
  expiresIn: "15m",
};

test("login succeeds with valid credentials", async () => {
  const token = await authenticate("test-admin", "correct-password", config);
  assert.equal(typeof token, "string");
  assert.equal(verifyAccessToken(token, config).role, "admin");
});

test("login endpoint issues a token for valid credentials", async () => {
  const previous = {
    username: process.env.ADMIN_USERNAME,
    passwordHash: process.env.ADMIN_PASSWORD_HASH,
    jwtSecret: process.env.JWT_SECRET,
  };
  process.env.ADMIN_USERNAME = config.username;
  process.env.ADMIN_PASSWORD_HASH = config.passwordHash;
  process.env.JWT_SECRET = config.jwtSecret;
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: config.username,
        password: "correct-password",
      }),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(typeof result.data.accessToken, "string");
  } finally {
    server.close();
    for (const [key, value] of Object.entries({
      ADMIN_USERNAME: previous.username,
      ADMIN_PASSWORD_HASH: previous.passwordHash,
      JWT_SECRET: previous.jwtSecret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("login rejects an incorrect password without revealing which field failed", async () => {
  assert.equal(await authenticate("test-admin", "wrong-password", config), null);
});

test("login endpoint rejects missing or malformed credentials", async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin" }),
    });
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});

test("authentication configuration must be complete and use a strong JWT secret", () => {
  assert.throws(
    () => validateAuthConfig({ username: "admin", passwordHash: "hash" }),
    /Missing authentication configuration/
  );
  assert.throws(
    () =>
      validateAuthConfig({
        ...config,
        jwtSecret: "too-short",
      }),
    /at least 32 characters/
  );
});

test("expired and invalid-signature tokens are rejected", () => {
  const expired = jwt.sign(
    { sub: config.username, role: "admin" },
    config.jwtSecret,
    { expiresIn: -1, issuer: "featureflag-studio" }
  );
  assert.throws(() => verifyAccessToken(expired, config));
  assert.throws(() =>
    verifyAccessToken(`${expired}invalid`, config)
  );
});

test("tokens using another signing algorithm are rejected", () => {
  const wrongAlgorithm = jwt.sign(
    { sub: config.username, role: "admin" },
    config.jwtSecret,
    { algorithm: "HS512", issuer: "featureflag-studio" }
  );
  assert.throws(() => verifyAccessToken(wrongAlgorithm, config));
});

test("bearer headers with extra fields are rejected", () => {
  const previous = {
    username: process.env.ADMIN_USERNAME,
    passwordHash: process.env.ADMIN_PASSWORD_HASH,
    jwtSecret: process.env.JWT_SECRET,
  };
  process.env.ADMIN_USERNAME = config.username;
  process.env.ADMIN_PASSWORD_HASH = config.passwordHash;
  process.env.JWT_SECRET = config.jwtSecret;
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
  requireAuth(request, response, () => {
    throw new Error("malformed bearer header was accepted");
  });
  assert.equal(response.statusCode, 401);
  for (const [key, value] of Object.entries({
    ADMIN_USERNAME: previous.username,
    ADMIN_PASSWORD_HASH: previous.passwordHash,
    JWT_SECRET: previous.jwtSecret,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("management routes reject requests without a bearer token", async () => {
  const previous = {
    username: process.env.ADMIN_USERNAME,
    passwordHash: process.env.ADMIN_PASSWORD_HASH,
    jwtSecret: process.env.JWT_SECRET,
  };
  process.env.ADMIN_USERNAME = config.username;
  process.env.ADMIN_PASSWORD_HASH = config.passwordHash;
  process.env.JWT_SECRET = config.jwtSecret;
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/flags`);
    assert.equal(response.status, 401);
  } finally {
    server.close();
    for (const [key, value] of Object.entries({
      ADMIN_USERNAME: previous.username,
      ADMIN_PASSWORD_HASH: previous.passwordHash,
      JWT_SECRET: previous.jwtSecret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("login fails safely when authentication configuration is missing", async () => {
  const previous = {
    username: process.env.ADMIN_USERNAME,
    passwordHash: process.env.ADMIN_PASSWORD_HASH,
    jwtSecret: process.env.JWT_SECRET,
  };
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD_HASH;
  delete process.env.JWT_SECRET;
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "password" }),
    });
    assert.equal(response.status, 503);
  } finally {
    server.close();
    for (const [key, value] of Object.entries({
      ADMIN_USERNAME: previous.username,
      ADMIN_PASSWORD_HASH: previous.passwordHash,
      JWT_SECRET: previous.jwtSecret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
