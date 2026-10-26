
const express = require("express");
const { requireAuth } = require("../auth/auth");
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

// Evaluation is intentionally public and returns only the boolean decision.
router.get(
  "/evaluate/:key/:environmentName",
  evaluationRateLimiter,
  evaluate
);

// All flag-management and configuration routes require an admin token.
router.use(requireAuth);
router.post("/", createFlag);
router.get("/", getAllFlags);
router.get("/:id", getFlagById);
router.patch("/:id", updateFlag);
router.patch("/:id/toggle", toggleFlag);
router.patch("/:id/environments/:environmentName", updateEnvironment);
router.patch("/:id/environments/:environmentName/toggle", toggleEnvironment);
router.delete("/:id", deleteFlag);

module.exports = router;
