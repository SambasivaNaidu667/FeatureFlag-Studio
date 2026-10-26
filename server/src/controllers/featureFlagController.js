const mongoose = require("mongoose");
const FeatureFlag = require("../models/FeatureFlag");
const { ENVIRONMENTS, evaluateFlag } = require("../services/evaluationEngine");
const { can } = require("../auth/permissions");
const { recordAudit } = require("../services/auditService");

const metadataFields = ["name", "key", "description"];
const environmentFields = [
  "enabled",
  "rolloutPercentage",
  "allowlist",
  "denylist",
];

function publicEvaluationResult(result) {
  return { value: result.value };
}

function invalidId(res, id) {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ success: false, message: "Invalid feature flag ID" });
    return true;
  }
  return false;
}

function validateEnvironment(environmentName, res) {
  if (!ENVIRONMENTS.includes(environmentName)) {
    res.status(400).json({
      success: false,
      message: "Environment must be development, staging, or production",
    });
    return false;
  }
  return true;
}

function validateEnvironmentPayload(body) {
  const keys = Object.keys(body || {});
  if (!keys.length || keys.some((key) => !environmentFields.includes(key))) {
    return "Only enabled, rolloutPercentage, allowlist, and denylist may be updated";
  }
  if (
    Object.hasOwn(body, "enabled") &&
    typeof body.enabled !== "boolean"
  ) {
    return "enabled must be a boolean";
  }
  if (
    Object.hasOwn(body, "rolloutPercentage") &&
    (!Number.isFinite(body.rolloutPercentage) ||
      body.rolloutPercentage < 0 ||
      body.rolloutPercentage > 100)
  ) {
    return "rolloutPercentage must be a number between 0 and 100";
  }
  for (const field of ["allowlist", "denylist"]) {
    if (Object.hasOwn(body, field)) {
      if (
        !Array.isArray(body[field]) ||
        body[field].length > FeatureFlag.MAX_TARGETING_IDS ||
        body[field].some(
          (id) => typeof id !== "string" || !id.trim() || id.trim() !== id
        ) ||
        new Set(body[field]).size !== body[field].length
      ) {
        return `${field} must contain at most ${FeatureFlag.MAX_TARGETING_IDS} unique, non-empty user IDs`;
      }
    }
  }
  return null;
}

// True when a create payload configures production beyond the safe defaults.
function configuresProduction(environments) {
  const production = environments?.production;
  if (!production || typeof production !== "object") return false;
  const allowedKeys = new Set([
    "enabled",
    "rolloutPercentage",
    "allowlist",
    "denylist",
  ]);
  if (Object.keys(production).some((key) => !allowedKeys.has(key))) {
    return true;
  }
  if (production.enabled !== undefined && production.enabled !== false) {
    return true;
  }
  if (
    production.rolloutPercentage !== undefined &&
    production.rolloutPercentage !== 0
  ) {
    return true;
  }
  if (
    production.allowlist !== undefined &&
    (!Array.isArray(production.allowlist) || production.allowlist.length > 0)
  ) {
    return true;
  }
  if (
    production.denylist !== undefined &&
    (!Array.isArray(production.denylist) || production.denylist.length > 0)
  ) {
    return true;
  }
  return false;
}

function describeTargeting(body) {
  return environmentFields
    .filter((field) => Object.hasOwn(body, field))
    .map((field) =>
      Array.isArray(body[field])
        ? `${field}: ${body[field].length} ID(s)`
        : `${field}: ${body[field]}`
    )
    .join(", ");
}

async function createFlag(req, res, next) {
  try {
    const body = req.body || {};
    const unexpected = Object.keys(body).filter(
      (field) => !metadataFields.includes(field) && field !== "environments"
    );
    if (unexpected.length) {
      return res.status(400).json({
        success: false,
        message: `Unexpected field: ${unexpected[0]}`,
      });
    }
    if (configuresProduction(body.environments) && !can(req.user.role, "flags:production")) {
      return res.status(403).json({
        success: false,
        message: "Only administrators can change production configuration",
      });
    }
    const flag = await FeatureFlag.create({
      name: body.name,
      key: body.key,
      description: body.description,
      environments: body.environments,
    });
    await recordAudit(req.user, {
      action: "flag.created",
      targetType: "flag",
      targetId: flag._id,
      targetLabel: flag.key,
      summary: `Created "${flag.name}"`,
    });
    return res.status(201).json({
      success: true,
      message: "Feature flag created successfully",
      data: flag,
    });
  } catch (error) {
    return next(error);
  }
}

async function getAllFlags(req, res, next) {
  try {
    const flags = await FeatureFlag.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: flags.length, data: flags });
  } catch (error) {
    return next(error);
  }
}

async function getFlagById(req, res, next) {
  try {
    if (invalidId(res, req.params.id)) return;
    const flag = await FeatureFlag.findById(req.params.id);
    if (!flag) {
      return res.status(404).json({ success: false, message: "Feature flag not found" });
    }
    return res.status(200).json({ success: true, data: flag });
  } catch (error) {
    return next(error);
  }
}

async function updateFlag(req, res, next) {
  try {
    if (invalidId(res, req.params.id)) return;
    const body = req.body || {};
    const updates = {};
    for (const field of metadataFields) {
      if (Object.hasOwn(body, field)) updates[field] = body[field];
    }
    if (!Object.keys(updates).length || Object.keys(body).some((field) => !metadataFields.includes(field))) {
      return res.status(400).json({
        success: false,
        message: "Only name, key, and description may be updated",
      });
    }
    const flag = await FeatureFlag.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
      context: "query",
    });
    if (!flag) {
      return res.status(404).json({ success: false, message: "Feature flag not found" });
    }
    await recordAudit(req.user, {
      action: "flag.updated",
      targetType: "flag",
      targetId: flag._id,
      targetLabel: flag.key,
      summary: `Updated ${Object.keys(updates).join(", ")}`,
    });
    return res.status(200).json({
      success: true,
      message: "Feature flag updated successfully",
      data: flag,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateEnvironment(req, res, next) {
  try {
    if (invalidId(res, req.params.id)) return;
    if (!validateEnvironment(req.params.environmentName, res)) return;
    if (
      req.params.environmentName === "production" &&
      !can(req.user?.role, "flags:production")
    ) {
      return res.status(403).json({
        success: false,
        message: "Only administrators can change production configuration",
      });
    }
    const validationMessage = validateEnvironmentPayload(req.body);
    if (validationMessage) {
      return res.status(400).json({ success: false, message: validationMessage });
    }
    const updates = {};
    for (const field of environmentFields) {
      if (Object.hasOwn(req.body, field)) {
        updates[`environments.${req.params.environmentName}.${field}`] =
          req.body[field];
      }
    }
    const flag = await FeatureFlag.findOneAndUpdate(
      { _id: req.params.id },
      { $set: updates },
      { new: true, runValidators: true, context: "query" }
    );
    if (!flag) {
      return res.status(404).json({ success: false, message: "Feature flag not found" });
    }
    await recordAudit(req.user, {
      action: "flag.targeting_updated",
      targetType: "flag",
      targetId: flag._id,
      targetLabel: flag.key,
      summary: `${req.params.environmentName}: ${describeTargeting(req.body)}`,
    });
    return res.status(200).json({
      success: true,
      message: "Environment configuration updated successfully",
      data: flag,
      configuration: flag.environments[req.params.environmentName],
    });
  } catch (error) {
    return next(error);
  }
}

async function toggleEnvironment(req, res, next) {
  try {
    if (invalidId(res, req.params.id)) return;
    if (!validateEnvironment(req.params.environmentName, res)) return;
    if (
      req.params.environmentName === "production" &&
      !can(req.user?.role, "flags:production")
    ) {
      return res.status(403).json({
        success: false,
        message: "Only administrators can change production configuration",
      });
    }
    const flag = await FeatureFlag.findById(req.params.id);
    if (!flag) {
      return res.status(404).json({ success: false, message: "Feature flag not found" });
    }
    const path = `environments.${req.params.environmentName}.enabled`;
    const updated = await FeatureFlag.findOneAndUpdate(
      { _id: req.params.id },
      { $set: { [path]: !flag.environments[req.params.environmentName].enabled } },
      { new: true, runValidators: true }
    );
    const enabled = updated.environments[req.params.environmentName].enabled;
    await recordAudit(req.user, {
      action: enabled ? "flag.enabled" : "flag.disabled",
      targetType: "flag",
      targetId: updated._id,
      targetLabel: updated.key,
      summary: `${enabled ? "Enabled" : "Disabled"} in ${req.params.environmentName}`,
    });
    return res.status(200).json({
      success: true,
      message: "Environment status updated successfully",
      data: updated,
      configuration: updated.environments[req.params.environmentName],
    });
  } catch (error) {
    return next(error);
  }
}

async function toggleFlag(req, res, next) {
  req.params.environmentName = req.body?.environment || "development";
  return toggleEnvironment(req, res, next);
}

async function evaluate(req, res, next) {
  try {
    const flag = await FeatureFlag.findOne({ key: req.params.key });
    if (!flag) return res.status(404).json({ success: false, message: "Feature flag not found" });
    if (!validateEnvironment(req.params.environmentName, res)) return;
    const result = evaluateFlag({
      key: flag.key,
      environment: req.params.environmentName,
      userId: req.query.userId,
      config: flag.environments[req.params.environmentName],
    });
    return res.status(200).json({
      success: true,
      data: publicEvaluationResult(result),
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteFlag(req, res, next) {
  try {
    if (invalidId(res, req.params.id)) return;
    const flag = await FeatureFlag.findByIdAndDelete(req.params.id);
    if (!flag) return res.status(404).json({ success: false, message: "Feature flag not found" });
    await recordAudit(req.user, {
      action: "flag.deleted",
      targetType: "flag",
      targetId: flag._id,
      targetLabel: flag.key,
      summary: `Deleted "${flag.name}"`,
    });
    return res.status(200).json({ success: true, message: "Feature flag deleted successfully" });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createFlag,
  getAllFlags,
  getFlagById,
  updateFlag,
  updateEnvironment,
  toggleEnvironment,
  toggleFlag,
  evaluate,
  deleteFlag,
  publicEvaluationResult,
};
