
const express = require("express");
const { requireAuth, requirePermission } = require("../auth/auth");
const { can } = require("../auth/permissions");
const { rateLimitFromEnv } = require("../middleware/rateLimiter");

const {
  createFlag,
  getAllFlags,
  getFlagById,
  updateFlag,
  deleteFlag,
  toggleFlag,
  updateEnvironment,
  toggleEnvironment,
  evaluate,
} = require("../controllers/featureFlagController");

const router = express.Router();
const evaluationRateLimiter = rateLimitFromEnv({
  maxEnv: "EVALUATION_RATE_LIMIT_MAX",
  windowEnv: "EVALUATION_RATE_LIMIT_WINDOW_MS",
  defaultMax: 300,
  defaultWindowMs: 60 * 1000,
  message: "Too many evaluation requests, please try again later",
});

// Production changes are restricted to roles holding "flags:production".
function requireEnvironmentAccess(req, res, next) {
  const environmentName =
    req.params.environmentName || req.body?.environment || "development";
  if (environmentName === "production" && !can(req.user.role, "flags:production")) {
    return res.status(403).json({
      success: false,
      message: "Only administrators can change production configuration",
    });
  }
  return next();
}

// Evaluation is intentionally public and returns only the boolean decision.
router.get(
  "/evaluate/:key/:environmentName",
  evaluationRateLimiter,
  evaluate
);

// All flag-management routes require an authenticated, active user.
// Permissions are checked per route against the role stored in the database.
router.use(requireAuth);
router.get("/", requirePermission("flags:read"), getAllFlags);
router.get("/:id", requirePermission("flags:read"), getFlagById);
router.post("/", requirePermission("flags:create"), createFlag);
router.patch("/:id", requirePermission("flags:update"), updateFlag);
router.patch(
  "/:id/toggle",
  requirePermission("flags:toggle"),
  requireEnvironmentAccess,
  toggleFlag
);
router.patch(
  "/:id/environments/:environmentName",
  requirePermission("flags:update"),
  requireEnvironmentAccess,
  updateEnvironment
);
router.patch(
  "/:id/environments/:environmentName/toggle",
  requirePermission("flags:toggle"),
  requireEnvironmentAccess,
  toggleEnvironment
);
router.delete("/:id", requirePermission("flags:delete"), deleteFlag);

module.exports = router;
