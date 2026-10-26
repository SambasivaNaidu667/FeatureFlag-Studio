const express = require("express");
const User = require("../models/User");
const {
  getAuthConfig,
  hashPassword,
  publicUser,
  requireAuth,
  signAccessToken,
  validateAuthConfig,
  validatePassword,
  verifyCredentials,
} = require("../auth/auth");
const { rateLimitFromEnv } = require("../middleware/rateLimiter");

const router = express.Router();

const loginRateLimiter = rateLimitFromEnv({
  maxEnv: "LOGIN_RATE_LIMIT_MAX",
  windowEnv: "LOGIN_RATE_LIMIT_WINDOW_MS",
  defaultMax: 10,
  defaultWindowMs: 15 * 60 * 1000,
  message: "Too many login attempts, please try again later",
});
const registerRateLimiter = rateLimitFromEnv({
  maxEnv: "REGISTER_RATE_LIMIT_MAX",
  windowEnv: "REGISTER_RATE_LIMIT_WINDOW_MS",
  defaultMax: 5,
  defaultWindowMs: 60 * 60 * 1000,
  message: "Too many registration attempts, please try again later",
});

const REGISTRATION_RESPONSE =
  "Registration received. If this email was not already registered, you can now sign in.";

function registrationEnabled() {
  return process.env.ALLOW_PUBLIC_REGISTRATION === "true";
}

function authNotConfigured(res) {
  return res.status(503).json({ success: false, message: "Authentication is not configured" });
}

function sessionResponse(user, config) {
  return {
    accessToken: signAccessToken(user, config),
    expiresIn: config.expiresIn,
    user: publicUser(user),
  };
}

router.get("/config", (req, res) => {
  res.status(200).json({ success: true, data: { registrationEnabled: registrationEnabled() } });
});

router.post("/register", registerRateLimiter, async (req, res, next) => {
  try {
    if (!registrationEnabled()) {
      return res.status(403).json({ success: false, message: "Public registration is disabled" });
    }
    const { name, email, password } = req.body || {};
    const normalizedEmail = User.normalizeEmail(email);
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80) {
      return res.status(400).json({ success: false, message: "Name must be 2 to 80 characters" });
    }
    if (!User.EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 254) {
      return res.status(400).json({ success: false, message: "A valid email address is required" });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ success: false, message: passwordError });
    }

    // Hash before the existence check so both paths cost the same.
    const passwordHash = await hashPassword(password);
    try {
      // Any client-supplied role is ignored: public accounts are always viewers.
      await User.create({
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
        role: "viewer",
        status: "active",
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      // Duplicate email: respond identically to avoid account enumeration.
    }
    return res.status(202).json({ success: true, message: REGISTRATION_RESPONSE });
  } catch (error) {
    return next(error);
  }
});

router.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const config = getAuthConfig();
    try {
      validateAuthConfig(config);
    } catch {
      return authNotConfigured(res);
    }

    const { email, password } = req.body || {};
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.trim() === "" ||
      password === ""
    ) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const result = await verifyCredentials(email, password);
    if (!result) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    if (result.deactivated) {
      return res.status(403).json({ success: false, message: "This account has been deactivated" });
    }
    return res.status(200).json({ success: true, data: sessionResponse(result.user, config) });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.status(200).json({ success: true, data: publicUser(req.user) });
});

// Tokens are stateless, so logout revokes every session of this user by
// bumping tokenVersion (the client also discards its in-memory token).
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    return res.status(200).json({ success: true, message: "Signed out" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
