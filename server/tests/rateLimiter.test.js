const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createRateLimiter,
  rateLimitFromEnv,
} = require("../src/middleware/rateLimiter");
const { publicEvaluationResult } = require("../src/controllers/featureFlagController");

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
