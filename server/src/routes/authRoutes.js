const express = require("express");
const { authenticate } = require("../auth/auth");
const { rateLimitFromEnv } = require("../middleware/rateLimiter");

const router = express.Router();
const loginRateLimiter = rateLimitFromEnv({
  maxEnv: "LOGIN_RATE_LIMIT_MAX",
  windowEnv: "LOGIN_RATE_LIMIT_WINDOW_MS",
  defaultMax: 10,
  defaultWindowMs: 15 * 60 * 1000,
  message: "Too many login attempts, please try again later",
});

router.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      username.trim() === "" ||
      password === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    const token = await authenticate(username, password);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    return res.status(200).json({
      success: true,
      data: { accessToken: token, expiresIn: process.env.JWT_EXPIRES_IN || "15m" },
    });
  } catch (error) {
    if (
      error.message?.startsWith("Missing authentication configuration") ||
      error.message?.startsWith("JWT_SECRET")
    ) {
      return res.status(503).json({
        success: false,
        message: "Authentication is not configured",
      });
    }
    return next(error);
  }
});

module.exports = router;
