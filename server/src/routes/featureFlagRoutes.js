
const express = require("express");

const {
  createFlag,
  getAllFlags,
  getFlagById,
  updateFlag,
  deleteFlag,
  toggleFlag,
} = require("../controllers/featureFlagController");

const router = express.Router();

// Create a feature flag
router.post("/", createFlag);

// Get all feature flags
router.get("/", getAllFlags);

// Get one feature flag by ID
router.get("/:id", getFlagById);

// Update a feature flag
router.patch("/:id", updateFlag);

// Enable or disable a feature flag
router.patch("/:id/toggle", toggleFlag);

// Delete a feature flag
router.delete("/:id", deleteFlag);

module.exports = router;
