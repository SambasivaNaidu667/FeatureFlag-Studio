const assert = require("node:assert/strict");
const test = require("node:test");
const { evaluateFlag } = require("../src/services/evaluationEngine");

const baseConfig = {
  enabled: true,
  rolloutPercentage: 50,
  allowlist: [],
  denylist: [],
};

function evaluate(userId, overrides = {}) {
  return evaluateFlag({
    key: "checkout_v1",
    environment: "production",
    userId,
    config: { ...baseConfig, ...overrides },
  });
}

test("disabled environments always return false", () => {
  assert.deepEqual(evaluate("user-1", { enabled: false }), {
    value: false,
    reason: "ENV_DISABLED",
  });
});

test("denylist wins when a user is on both lists", () => {
  assert.deepEqual(
    evaluate("user-1", { allowlist: ["user-1"], denylist: ["user-1"] }),
    { value: false, reason: "USER_DENYLISTED" }
  );
});

test("allowlist bypasses a zero percent rollout", () => {
  assert.deepEqual(
    evaluate("user-1", { rolloutPercentage: 0, allowlist: ["user-1"] }),
    { value: true, reason: "USER_ALLOWLISTED" }
  );
});

test("ordinary users miss at zero percent and match at 100 percent", () => {
  assert.equal(evaluate("user-1", { rolloutPercentage: 0 }).reason, "ROLLOUT_MISS");
  assert.equal(evaluate("user-1", { rolloutPercentage: 100 }).reason, "ROLLOUT_MATCH");
});

test("missing identity does not participate in rollout", () => {
  assert.deepEqual(evaluate(undefined), {
    value: false,
    reason: "MISSING_IDENTITY",
  });
});

test("rollout match and miss are deterministic", () => {
  let match;
  let miss;
  for (let index = 0; index < 1000 && (!match || !miss); index += 1) {
    const userId = `user-${index}`;
    const result = evaluate(userId, { rolloutPercentage: 50 });
    if (result.value) match = userId;
    else miss = userId;
  }
  assert.ok(match && miss);
  assert.deepEqual(evaluate(match), evaluate(match));
  assert.deepEqual(evaluate(miss), evaluate(miss));
});

test("identity normalization trims whitespace without changing case", () => {
  assert.deepEqual(
    evaluate(" user-1 ", { allowlist: ["user-1"] }),
    evaluate("user-1", { allowlist: ["user-1"] })
  );
  assert.deepEqual(
    evaluate("User-1", { allowlist: ["user-1"] }),
    { value: false, reason: "ROLLOUT_MISS" }
  );
});

test("environment is part of the deterministic bucket", () => {
  const input = {
    key: "checkout_v1",
    userId: "user-1",
    config: { ...baseConfig, rolloutPercentage: 50 },
  };
  const production = evaluateFlag({ ...input, environment: "production" });
  const staging = evaluateFlag({ ...input, environment: "staging" });
  assert.ok(["ROLLOUT_MATCH", "ROLLOUT_MISS"].includes(production.reason));
  assert.ok(["ROLLOUT_MATCH", "ROLLOUT_MISS"].includes(staging.reason));
});

test("invalid environments and rollout values are rejected", () => {
  assert.throws(
    () => evaluateFlag({ key: "x", environment: "qa", userId: "u", config: baseConfig }),
    /Unsupported environment/
  );
  assert.throws(() => evaluate("user-1", { rolloutPercentage: 101 }), /between 0 and 100/);
  assert.throws(() => evaluate("user-1", { rolloutPercentage: Number.NaN }), /between 0 and 100/);
});
