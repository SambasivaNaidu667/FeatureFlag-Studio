/*
 * Safe, idempotent administrator bootstrap and recovery script.
 *
 * Usage (from the server directory):
 *   npm run bootstrap-admin                                         # dry-run (default)
 *   npm run bootstrap-admin -- --apply                              # create initial admin if missing
 *   npm run bootstrap-admin -- --apply --reset-password --confirm-reset
 *
 * Reads ADMIN_EMAIL, ADMIN_NAME, and ADMIN_PASSWORD_HASH from server/.env.
 * Never interprets ADMIN_USERNAME as an email, never runs automatically on
 * server startup, never deletes feature flags, and never logs secrets.
 */
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const SUPPORTED_FLAGS = new Set([
  "--dry-run",
  "--apply",
  "--reset-password",
  "--confirm-reset",
]);

function parseBootstrapArgs(args = []) {
  const unknown = args.filter((arg) => !SUPPORTED_FLAGS.has(arg));
  if (unknown.length) {
    throw new Error(
      `Unknown argument(s): ${unknown.join(", ")}. Usage: node src/scripts/bootstrapAdmin.js [--dry-run|--apply] [--reset-password --confirm-reset]`
    );
  }
  if (args.includes("--dry-run") && args.includes("--apply")) {
    throw new Error("Cannot combine --dry-run and --apply");
  }
  const apply = args.includes("--apply");
  const resetPassword = args.includes("--reset-password");
  const confirmReset = args.includes("--confirm-reset");

  if (confirmReset && !resetPassword) {
    throw new Error("--confirm-reset requires --reset-password");
  }
  if (apply && resetPassword && !confirmReset) {
    throw new Error(
      "Password reset requires explicit confirmation: pass both --reset-password and --confirm-reset with --apply"
    );
  }

  return {
    apply,
    dryRun: !apply,
    resetPassword,
    confirmReset,
  };
}

function validateBootstrapConfig(env = process.env) {
  const rawEmail = typeof env.ADMIN_EMAIL === "string" ? env.ADMIN_EMAIL.trim() : "";
  if (!rawEmail) {
    throw new Error(
      "ADMIN_EMAIL is required in server/.env for administrator bootstrap (ADMIN_USERNAME is not used as an email)"
    );
  }
  const email = User.normalizeEmail(rawEmail);
  if (!User.EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new Error("ADMIN_EMAIL must be a valid email address");
  }

  const name =
    typeof env.ADMIN_NAME === "string" && env.ADMIN_NAME.trim()
      ? env.ADMIN_NAME.trim()
      : "Studio Admin";
  if (name.length < 2 || name.length > 80) {
    throw new Error("ADMIN_NAME must be between 2 and 80 characters");
  }

  const passwordHash =
    typeof env.ADMIN_PASSWORD_HASH === "string" ? env.ADMIN_PASSWORD_HASH.trim() : "";
  if (!passwordHash || !BCRYPT_HASH_PATTERN.test(passwordHash)) {
    throw new Error(
      "ADMIN_PASSWORD_HASH must be a valid 60-character bcrypt hash in server/.env"
    );
  }

  return { email, name, passwordHash };
}

async function bootstrapAdmin({
  env = process.env,
  apply = false,
  resetPassword = false,
  confirmReset = false,
  logger = console,
} = {}) {
  if (apply && resetPassword && !confirmReset) {
    throw new Error(
      "Password reset requires explicit confirmation: pass both --reset-password and --confirm-reset with --apply"
    );
  }

  const config = validateBootstrapConfig(env);
  const existing = await User.findOne({ email: config.email }).select("+passwordHash +tokenVersion");

  if (!existing) {
    if (!apply) {
      logger.log(
        `[DRY-RUN] Would create administrator account for ${config.email} (${config.name}). Pass --apply to write changes.`
      );
      return {
        mode: "dry-run",
        action: "would_create",
        email: config.email,
        name: config.name,
      };
    }

    const created = await User.create({
      name: config.name,
      email: config.email,
      passwordHash: config.passwordHash,
      role: "admin",
      status: "active",
    });
    logger.log(
      `[APPLIED] Created administrator account for ${created.email} (id: ${created._id}).`
    );
    return {
      mode: "apply",
      action: "created",
      email: created.email,
      userId: String(created._id),
    };
  }

  if (!resetPassword) {
    logger.log(
      `[${apply ? "APPLIED" : "DRY-RUN"}] Administrator account ${existing.email} already exists (role: ${existing.role}, status: ${existing.status}). No changes made.`
    );
    return {
      mode: apply ? "apply" : "dry-run",
      action: "already_exists",
      email: existing.email,
      userId: String(existing._id),
    };
  }

  if (!apply) {
    logger.log(
      `[DRY-RUN] Would reset password hash and ensure active admin role for ${existing.email}. Pass --apply --reset-password --confirm-reset to apply.`
    );
    return {
      mode: "dry-run",
      action: "would_reset_password",
      email: existing.email,
      userId: String(existing._id),
    };
  }

  existing.passwordHash = config.passwordHash;
  existing.name = config.name;
  existing.role = "admin";
  existing.status = "active";
  existing.tokenVersion = (existing.tokenVersion || 0) + 1;
  await existing.save();

  logger.log(
    `[APPLIED] Reset password hash, reactivated, and revoked prior sessions for administrator ${existing.email}.`
  );
  return {
    mode: "apply",
    action: "password_reset",
    email: existing.email,
    userId: String(existing._id),
  };
}

async function runCli() {
  try {
    const options = parseBootstrapArgs(process.argv.slice(2));
    validateBootstrapConfig(process.env);
    await connectDB();
    await bootstrapAdmin({
      env: process.env,
      apply: options.apply,
      resetPassword: options.resetPassword,
      confirmReset: options.confirmReset,
    });
    await mongoose.disconnect();
  } catch (error) {
    console.error("Administrator bootstrap failed:", error.message);
    try {
      await mongoose.disconnect();
    } catch {
      // ignore disconnect errors on failure
    }
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  BCRYPT_HASH_PATTERN,
  bootstrapAdmin,
  parseBootstrapArgs,
  validateBootstrapConfig,
};
