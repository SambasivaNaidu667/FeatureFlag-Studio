const AuditLog = require("../models/AuditLog");

/**
 * Records an audit event. The change itself has already been committed, so a
 * failure here is logged rather than turned into a failed request.
 * Callers must pass only safe, non-secret summaries.
 */
async function recordAudit(actor, { action, targetType, targetId, targetLabel = "", summary = "" }) {
  try {
    await AuditLog.create({
      actor: actor._id,
      actorEmail: actor.email,
      action,
      targetType,
      targetId,
      targetLabel: String(targetLabel).slice(0, 200),
      summary: String(summary).slice(0, 500),
    });
  } catch (error) {
    console.error("Failed to record audit event:", action, error.message);
  }
}

module.exports = { recordAudit };
