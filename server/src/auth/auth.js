const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const { can, permissionsFor } = require("./permissions");

const ISSUER = "featureflag-studio";
const PASSWORD_MIN_LENGTH = 8;
// bcrypt ignores input beyond 72 bytes; reject longer passwords explicitly.
const PASSWORD_MAX_BYTES = 72;

function cleanEnvString(value) {
  if (typeof value !== "string") return value;
  let cleaned = value.trim();
  if (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

function getAuthConfig(env = process.env) {
  let jwtSecret = cleanEnvString(env.JWT_SECRET);
  if (typeof jwtSecret === "string" && /^JWT_SECRET\s*=/i.test(jwtSecret)) {
    jwtSecret = cleanEnvString(jwtSecret.replace(/^JWT_SECRET\s*=/i, ""));
  }
  const expiresIn = cleanEnvString(env.JWT_EXPIRES_IN) || "15m";
  return {
    jwtSecret,
    expiresIn,
  };
}

function validateAuthConfig(config = getAuthConfig()) {
  if (!config.jwtSecret) {
    throw new Error("Missing authentication configuration: jwtSecret");
  }
  if (config.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long");
  }
}

function bcryptRounds() {
  const rounds = Number(process.env.BCRYPT_ROUNDS);
  return Number.isInteger(rounds) && rounds >= 4 && rounds <= 15 ? rounds : 12;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    return `Password cannot exceed ${PASSWORD_MAX_BYTES} bytes`;
  }
  return null;
}

function hashPassword(password) {
  return bcrypt.hash(password, bcryptRounds());
}

// Used so that unknown emails cost the same bcrypt work as known ones.
let dummyHash;
function getDummyHash() {
  if (!dummyHash) dummyHash = bcrypt.hashSync("dummy-password-for-timing", bcryptRounds());
  return dummyHash;
}

function signAccessToken(user, config = getAuthConfig()) {
  validateAuthConfig(config);
  return jwt.sign(
    { sub: String(user._id), ver: user.tokenVersion || 0 },
    config.jwtSecret,
    { expiresIn: config.expiresIn, issuer: ISSUER, algorithm: "HS256" }
  );
}

function verifyAccessToken(token, config = getAuthConfig()) {
  validateAuthConfig(config);
  const payload = jwt.verify(token, config.jwtSecret, {
    issuer: ISSUER,
    algorithms: ["HS256"],
  });
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.sub !== "string" ||
    !mongoose.isValidObjectId(payload.sub) ||
    !Number.isInteger(payload.ver)
  ) {
    throw new Error("Invalid token claims");
  }
  return payload;
}

/**
 * Checks an email/password pair.
 * Returns { user } on success, { deactivated: true } when the password is
 * correct but the account is disabled, and null otherwise.
 */
async function verifyCredentials(email, password) {
  const normalized = User.normalizeEmail(email);
  const user = normalized
    ? await User.findOne({ email: normalized }).select("+passwordHash +tokenVersion")
    : null;
  const matches = await bcrypt.compare(
    password,
    user ? user.passwordHash : getDummyHash()
  );
  if (!user || !matches) return null;
  if (user.status !== "active") return { deactivated: true };
  return { user };
}

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    permissions: permissionsFor(user.role),
  };
}

async function requireAuth(req, res, next) {
  let config;
  try {
    config = getAuthConfig();
    validateAuthConfig(config);
  } catch {
    return res.status(503).json({
      success: false,
      message: "Authentication is not configured",
    });
  }

  const header = req.get("authorization") || "";
  const parts = header.split(" ");
  const [scheme, token] = parts;
  if (parts.length !== 2 || scheme !== "Bearer" || !token) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  let payload;
  try {
    payload = verifyAccessToken(token, config);
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }

  try {
    // Role and status always come from the database, never from the token.
    const user = await User.findById(payload.sub).select("+tokenVersion");
    if (!user || user.tokenVersion !== payload.ver) {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }
    if (user.status !== "active") {
      return res.status(401).json({ success: false, message: "This account has been deactivated" });
    }
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requirePermission(permission) {
  return function permissionGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (!can(req.user.role, permission)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }
    return next();
  };
}

module.exports = {
  getAuthConfig,
  hashPassword,
  publicUser,
  requireAuth,
  requirePermission,
  signAccessToken,
  validateAuthConfig,
  validatePassword,
  verifyAccessToken,
  verifyCredentials,
};
