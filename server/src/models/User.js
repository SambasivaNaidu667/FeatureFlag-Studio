const mongoose = require("mongoose");

const ROLES = ["admin", "developer", "viewer"];
const STATUSES = ["active", "deactivated"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must contain at least 2 characters"],
      maxlength: [80, "Name cannot exceed 80 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: [254, "Email cannot exceed 254 characters"],
      match: [EMAIL_PATTERN, "Email must be a valid email address"],
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: "viewer", required: true },
    status: { type: String, enum: STATUSES, default: "active", required: true },
    // Incremented to revoke every token issued before the change.
    tokenVersion: { type: Number, default: 0, select: false },
  },
  {
    timestamps: true,
    strict: "throw",
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.tokenVersion;
        delete ret.__v;
        return ret;
      },
    },
  }
);

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

userSchema.statics.ROLES = ROLES;
userSchema.statics.STATUSES = STATUSES;
userSchema.statics.EMAIL_PATTERN = EMAIL_PATTERN;
userSchema.statics.normalizeEmail = normalizeEmail;

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
