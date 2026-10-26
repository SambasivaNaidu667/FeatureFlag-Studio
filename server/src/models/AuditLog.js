const mongoose = require("mongoose");

// Append-only record of administrative and feature-flag changes.
// Never store passwords, hashes, tokens, or secrets here.
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    actorEmail: { type: String, required: true },
    action: { type: String, required: true, maxlength: 64 },
    targetType: { type: String, enum: ["flag", "user"], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    targetLabel: { type: String, default: "", maxlength: 200 },
    summary: { type: String, default: "", maxlength: 500 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    strict: "throw",
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

auditLogSchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
