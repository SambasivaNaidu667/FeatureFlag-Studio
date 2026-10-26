const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const {
  createRateLimiter,
  rateLimitFromEnv,
} = require("../src/middleware/rateLimiter");
const { publicEvaluationResult } = require("../src/controllers/featureFlagController");
const {
  resolveTrustProxy,
  configureTrustProxy,
} = require("../src/server");

function responseRecorder() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: null,
    set(name, value) {
      headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function invoke(limiter, ip = "test-client") {
  const response = responseRecorder();
  let continued = false;
  limiter({ ip }, response, () => {
    continued = true;
  });
  return { response, continued };
}

test("public evaluation responses contain only the boolean value", () => {
  assert.deepEqual(
    publicEvaluationResult({
      value: true,
      reason: "USER_ALLOWLISTED",
    }),
    { value: true }
  );
  assert.deepEqual(
    publicEvaluationResult({
      value: false,
      reason: "USER_DENYLISTED",
    }),
    { value: false }
  );
});

test("rate limiter permits requests below the limit and rejects the next request", () => {
  const limiter = createRateLimiter({
    max: 2,
    windowMs: 60_000,
    keyGenerator: (req) => req.ip,
  });

  assert.equal(invoke(limiter).continued, true);
  assert.equal(invoke(limiter).continued, true);
  const blocked = invoke(limiter);
  assert.equal(blocked.continued, false);
  assert.equal(blocked.response.statusCode, 429);
  assert.equal(blocked.response.body.message.includes("Too many"), true);
  assert.equal(blocked.response.headers["RateLimit-Remaining"], "0");
});

test("separate limiter instances keep login and evaluation budgets independent", () => {
  const loginLimiter = createRateLimiter({ max: 1, keyGenerator: (req) => req.ip });
  const evaluationLimiter = createRateLimiter({ max: 1, keyGenerator: (req) => req.ip });

  assert.equal(invoke(loginLimiter).continued, true);
  assert.equal(invoke(loginLimiter).continued, false);
  assert.equal(invoke(evaluationLimiter).continued, true);
});

test("malformed, fractional, zero, and negative limits use safe defaults", () => {
  const previous = process.env.TEST_RATE_LIMIT;
  process.env.TEST_RATE_LIMIT = "2requests";
  const malformed = rateLimitFromEnv({
    maxEnv: "TEST_RATE_LIMIT",
    windowEnv: "TEST_RATE_WINDOW",
    defaultMax: 2,
    defaultWindowMs: 60_000,
  });
  assert.equal(invoke(malformed).continued, true);
  assert.equal(invoke(malformed).continued, true);
  assert.equal(invoke(malformed).continued, false);

  process.env.TEST_RATE_LIMIT = "0";
  const zero = rateLimitFromEnv({
    maxEnv: "TEST_RATE_LIMIT",
    windowEnv: "TEST_RATE_WINDOW",
    defaultMax: 2,
    defaultWindowMs: 60_000,
  });
  assert.equal(invoke(zero).continued, true);
  assert.equal(invoke(zero).continued, true);
  assert.equal(invoke(zero).continued, false);

  if (previous === undefined) delete process.env.TEST_RATE_LIMIT;
  else process.env.TEST_RATE_LIMIT = previous;
  delete process.env.TEST_RATE_WINDOW;
});

test("resolveTrustProxy defaults to disabled and validates explicit hop counts and subnets", () => {
  assert.equal(resolveTrustProxy(undefined), false);
  assert.equal(resolveTrustProxy(""), false);
  assert.equal(resolveTrustProxy("false"), false);
  assert.equal(resolveTrustProxy("FALSE"), false);
  assert.equal(resolveTrustProxy("0"), false);
  assert.equal(resolveTrustProxy(false), false);

  assert.equal(resolveTrustProxy(1), 1);
  assert.equal(resolveTrustProxy("1"), 1);
  assert.equal(resolveTrustProxy(" 2 "), 2);
  assert.equal(resolveTrustProxy("loopback"), "loopback");
  assert.equal(resolveTrustProxy("LINKLOCAL"), "linklocal");
  assert.equal(resolveTrustProxy("uniquelocal"), "uniquelocal");

  for (const unsafeValue of ["true", true, "*", "-1", "01", "all", 0, -2, 1.5]) {
    assert.throws(
      () => resolveTrustProxy(unsafeValue),
      /Invalid TRUST_PROXY value/i
    );
  }
});

test("proxy-aware rate limiting ignores X-Forwarded-For by default and uses it only when TRUST_PROXY is enabled", async () => {
  async function withServer(trustProxySetting, fn) {
    const proxyApp = express();
    configureTrustProxy(proxyApp, trustProxySetting);
    proxyApp.use(
      createRateLimiter({
        max: 1,
        windowMs: 60_000,
      })
    );
    proxyApp.get("/probe", (req, res) => {
      res.status(200).json({ ip: req.ip });
    });

    const server = await new Promise((resolve) => {
      const instance = proxyApp.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const { port } = server.address();
    try {
      await fn(`http://127.0.0.1:${port}/probe`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // Default (TRUST_PROXY=false): spoofed X-Forwarded-For headers cannot bypass rate limiting
  await withServer(false, async (url) => {
    const first = await fetch(url, {
      headers: { "X-Forwarded-For": "203.0.113.10" },
    });
    assert.equal(first.status, 200);

    const secondWithDifferentSpoofedIp = await fetch(url, {
      headers: { "X-Forwarded-For": "198.51.100.25" },
    });
    assert.equal(secondWithDifferentSpoofedIp.status, 429);
  });

  // Explicit single-hop proxy (TRUST_PROXY=1): distinct forwarded client IPs have separate buckets
  await withServer(1, async (url) => {
    const clientAFirst = await fetch(url, {
      headers: { "X-Forwarded-For": "203.0.113.10" },
    });
    assert.equal(clientAFirst.status, 200);
    const bodyA = await clientAFirst.json();
    assert.equal(bodyA.ip, "203.0.113.10");

    const clientBFirst = await fetch(url, {
      headers: { "X-Forwarded-For": "198.51.100.25" },
    });
    assert.equal(clientBFirst.status, 200);
    const bodyB = await clientBFirst.json();
    assert.equal(bodyB.ip, "198.51.100.25");

    const clientASecond = await fetch(url, {
      headers: { "X-Forwarded-For": "203.0.113.10" },
    });
    assert.equal(clientASecond.status, 429);
  });
});
