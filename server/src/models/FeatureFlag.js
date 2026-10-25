
const mongoose = require("mongoose");

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

    enabled: {
      type: Boolean,
      default: false,
    },

    environment: {
      type: String,
      enum: ["development", "staging", "production"],
      default: "development",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("FeatureFlag", featureFlagSchema);
