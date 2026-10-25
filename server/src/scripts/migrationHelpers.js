const ENVIRONMENTS = ["development", "staging", "production"];
const MAX_TARGETING_IDS = 1000;
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const DOCUMENT_FIELDS = new Set([
  "_id",
  "name",
  "key",
  "description",
  "environments",
  "createdAt",
  "updatedAt",
  "__v",
]);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function buildEnvironmentConfigs(flag) {
  const configs = {};
  for (const environment of ENVIRONMENTS) {
    const isLegacyActive =
      environment === flag.environment && flag.enabled === true;
    configs[environment] = {
      enabled: isLegacyActive,
      rolloutPercentage: isLegacyActive ? 100 : 0,
      allowlist: [],
      denylist: [],
    };
  }
  return configs;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateTargetingList(value, path) {
  if (!Array.isArray(value)) return `${path} must be an array`;
  if (value.length > MAX_TARGETING_IDS) {
    return `${path} exceeds ${MAX_TARGETING_IDS} IDs`;
  }
  if (
    value.some(
      (id) => typeof id !== "string" || !id.trim() || id.trim() !== id
    )
  ) {
    return `${path} contains an invalid user ID`;
  }
  if (new Set(value).size !== value.length) {
    return `${path} contains duplicate user IDs`;
  }
  return null;
}

function validateEnvironmentConfig(config, environment) {
  if (!isPlainObject(config)) {
    return `${environment} configuration must be an object`;
  }
  const required = ["enabled", "rolloutPercentage", "allowlist", "denylist"];
  for (const field of required) {
    if (!hasOwn(config, field)) {
      return `${environment}.${field} is required`;
    }
  }
  if (typeof config.enabled !== "boolean") {
    return `${environment}.enabled must be a boolean`;
  }
  if (
    typeof config.rolloutPercentage !== "number" ||
    !Number.isFinite(config.rolloutPercentage) ||
    config.rolloutPercentage < 0 ||
    config.rolloutPercentage > 100
  ) {
    return `${environment}.rolloutPercentage must be a finite number between 0 and 100`;
  }
  return (
    validateTargetingList(config.allowlist, `${environment}.allowlist`) ||
    validateTargetingList(config.denylist, `${environment}.denylist`)
  );
}

function validateLegacyDocument(flag) {
  if (!isPlainObject(flag)) return "document must be an object";
  const unexpected = Object.keys(flag).find((field) => !DOCUMENT_FIELDS.has(field) &&
    field !== "environment" && field !== "enabled");
  if (unexpected) return `unexpected field "${unexpected}"`;
  if (typeof flag.name !== "string" || flag.name.trim().length < 2 || flag.name.length > 100) {
    return "name is invalid";
  }
  if (
    typeof flag.key !== "string" ||
    flag.key.trim() !== flag.key ||
    flag.key.length > 100 ||
    !KEY_PATTERN.test(flag.key)
  ) {
    return "key is invalid";
  }
  if (flag.description !== undefined &&
      (typeof flag.description !== "string" || flag.description.length > 500)) {
    return "description is invalid";
  }
  if (!ENVIRONMENTS.includes(flag.environment)) {
    return `unsupported environment "${flag.environment}"`;
  }
  if (typeof flag.enabled !== "boolean") return "enabled must be a boolean";
  return null;
}

function validateMigratedDocument(flag) {
  if (!isPlainObject(flag) || !hasOwn(flag, "environments")) {
    return "environments is missing";
  }
  for (const field of ["enabled", "environment"]) {
    if (hasOwn(flag, field)) return `legacy field "${field}" is still present`;
  }
  if (!isPlainObject(flag.environments)) return "environments must be an object";
  const unexpected = Object.keys(flag).find((field) => !DOCUMENT_FIELDS.has(field));
  if (unexpected) return `unexpected field "${unexpected}"`;
  for (const name of Object.keys(flag.environments)) {
    if (!ENVIRONMENTS.includes(name)) return `unsupported environment "${name}"`;
  }
  for (const environment of ENVIRONMENTS) {
    const error = validateEnvironmentConfig(
      flag.environments[environment],
      environment
    );
    if (error) return error;
  }
  return validateLegacyDocument({
    ...flag,
    enabled: true,
    environment: "development",
  });
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date &&
      left.getTime() === right.getTime();
  }
  if (left && right && typeof left.equals === "function") {
    return left.equals(right);
  }
  if (left && right && typeof right.equals === "function") {
    return right.equals(left);
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => hasOwn(right, key) && deepEqual(left[key], right[key]));
}

module.exports = {
  ENVIRONMENTS,
  MAX_TARGETING_IDS,
  buildEnvironmentConfigs,
  deepEqual,
  validateLegacyDocument,
  validateMigratedDocument,
};
