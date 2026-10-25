const crypto = require("node:crypto");

const ENVIRONMENTS = ["development", "staging", "production"];

function evaluateFlag({ key, environment, userId, config }) {
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`Unsupported environment: ${environment}`);
  }

  if (!config || typeof config !== "object") {
    throw new Error("A valid environment configuration is required");
  }

  if (!config.enabled) {
    return { value: false, reason: "ENV_DISABLED" };
  }

  const normalizedId =
    typeof userId === "string" ? userId.trim() : "";
  const denylist = Array.isArray(config.denylist) ? config.denylist : [];
  const allowlist = Array.isArray(config.allowlist) ? config.allowlist : [];

  if (denylist.includes(normalizedId) && normalizedId) {
    return { value: false, reason: "USER_DENYLISTED" };
  }

  if (allowlist.includes(normalizedId) && normalizedId) {
    return { value: true, reason: "USER_ALLOWLISTED" };
  }

  if (!normalizedId) {
    return { value: false, reason: "MISSING_IDENTITY" };
  }

  const percentage = config.rolloutPercentage;
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("Rollout percentage must be a finite number between 0 and 100");
  }

  const input = `${String(key).trim().toLowerCase()}:${environment}:${normalizedId}`;
  const digest = crypto.createHash("sha256").update(input).digest();
  const bucket = digest.readUInt32BE(0) / 0x100000000 * 100;

  return bucket < percentage
    ? { value: true, reason: "ROLLOUT_MATCH" }
    : { value: false, reason: "ROLLOUT_MISS" };
}

module.exports = { ENVIRONMENTS, evaluateFlag };
