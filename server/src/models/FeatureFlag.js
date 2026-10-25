const mongoose = require("mongoose");

const ENVIRONMENTS = ["development", "staging", "production"];
const MAX_TARGETING_IDS = 1000;

function normalizedUserId(value) {
  return typeof value === "string" ? value.trim() : value;
}

function uniqueTargetingIds(value) {
  return Array.isArray(value) && new Set(value).size === value.length;
}

const targetingList = {
  type: [String],
  default: [],
  set: (value) =>
    Array.isArray(value) ? value.map(normalizedUserId) : value,
  validate: [
    {
      validator: uniqueTargetingIds,
      message: "Targeting lists must not contain duplicate user IDs",
    },
    {
      validator: (value) => value.length <= MAX_TARGETING_IDS,
      message: `Targeting lists cannot contain more than ${MAX_TARGETING_IDS} IDs`,
    },
    {
      validator: (value) =>
        value.every((item) => typeof item === "string" && item.length > 0),
      message: "Targeting IDs must be non-empty strings",
    },
  ],
};

const environmentConfigSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    rolloutPercentage: {
      type: Number,
      default: 0,
      min: [0, "Rollout percentage cannot be below 0"],
      max: [100, "Rollout percentage cannot exceed 100"],
      validate: {
        validator: Number.isFinite,
        message: "Rollout percentage must be a finite number",
      },
    },
    allowlist: targetingList,
    denylist: targetingList,
  },
  { _id: false, strict: "throw" }
);

const featureFlagSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Feature flag name is required"],
      trim: true,
      minlength: [2, "Name must contain at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    key: {
      type: String,
      required: [true, "Feature flag key is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^[a-z][a-z0-9_]*$/,
        "Key must start with a letter and contain only lowercase letters, numbers, and underscores",
      ],
      maxlength: [100, "Key cannot exceed 100 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    environments: {
      development: { type: environmentConfigSchema, default: () => ({}) },
      staging: { type: environmentConfigSchema, default: () => ({}) },
      production: { type: environmentConfigSchema, default: () => ({}) },
    },
  },
  {
    timestamps: true,
    strict: "throw",
  }
);

featureFlagSchema.path("environments").validate((value) => {
  return value && ENVIRONMENTS.every((environment) => value[environment]);
}, "All supported environments are required");

featureFlagSchema.statics.ENVIRONMENTS = ENVIRONMENTS;
featureFlagSchema.statics.MAX_TARGETING_IDS = MAX_TARGETING_IDS;

module.exports = mongoose.model("FeatureFlag", featureFlagSchema);
