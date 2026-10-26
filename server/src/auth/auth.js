const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const REQUIRED_CLAIMS = ["sub", "role"];

function getAuthConfig(env = process.env) {
  return {
    username: env.ADMIN_USERNAME,
    passwordHash: env.ADMIN_PASSWORD_HASH,
    jwtSecret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN || "15m",
  };
}

function validateAuthConfig(config = getAuthConfig()) {
  const missing = ["username", "passwordHash", "jwtSecret"].filter(
    (key) => !config[key]
  );
  if (missing.length) {
    throw new Error(`Missing authentication configuration: ${missing.join(", ")}`);
  }
  if (config.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long");
  }
}

async function authenticate(username, password, config = getAuthConfig()) {
  validateAuthConfig(config);
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length === 0 ||
    password.length === 0
  ) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, config.passwordHash);
  if (!passwordMatches || username !== config.username) {
    return null;
  }

  return jwt.sign(
    { sub: config.username, role: "admin" },
    config.jwtSecret,
    { expiresIn: config.expiresIn, issuer: "featureflag-studio" }
  );
}

function verifyAccessToken(token, config = getAuthConfig()) {
  validateAuthConfig(config);
  const payload = jwt.verify(token, config.jwtSecret, {
    issuer: "featureflag-studio",
    algorithms: ["HS256"],
  });
  if (
    !payload ||
    typeof payload !== "object" ||
    REQUIRED_CLAIMS.some((claim) => typeof payload[claim] !== "string") ||
    payload.role !== "admin"
  ) {
    throw new Error("Invalid token claims");
  }
  return payload;
}

function requireAuth(req, res, next) {
  let config;
  try {
    config = getAuthConfig();
    validateAuthConfig(config);
  } catch (error) {
    return res.status(503).json({
      success: false,
      message: "Authentication is not configured",
    });
  }

  const header = req.get("authorization") || "";
  const parts = header.split(" ");
  const [scheme, token] = parts;
  if (parts.length !== 2 || scheme !== "Bearer" || !token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  try {
    req.user = verifyAccessToken(token, config);
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}

module.exports = {
  authenticate,
  getAuthConfig,
  requireAuth,
  validateAuthConfig,
  verifyAccessToken,
};
