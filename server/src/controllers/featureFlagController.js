
const mongoose = require("mongoose");
const FeatureFlag = require("../models/FeatureFlag");

async function createFlag(req, res, next) {
  try {
    const { name, key, description, enabled, environment } = req.body;

    const flag = await FeatureFlag.create({
      name,
      key,
      description,
      enabled,
      environment,
    });

    res.status(201).json({
      success: true,
      message: "Feature flag created successfully",
      data: flag,
    });
  } catch (error) {
    next(error);
  }
}

async function getAllFlags(req, res, next) {
  try {
    const flags = await FeatureFlag.find().sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: flags.length,
      data: flags,
    });
  } catch (error) {
    next(error);
  }
}

async function getFlagById(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid feature flag ID",
      });
    }

    const flag = await FeatureFlag.findById(id);

    if (!flag) {
      return res.status(404).json({
        success: false,
        message: "Feature flag not found",
      });
    }

    res.status(200).json({
      success: true,
      data: flag,
    });
  } catch (error) {
    next(error);
  }
}

async function updateFlag(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid feature flag ID",
      });
    }

    const allowedFields = [
      "name",
      "key",
      "description",
      "enabled",
      "environment",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (Object.hasOwn(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one valid field to update",
      });
    }

    const flag = await FeatureFlag.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!flag) {
      return res.status(404).json({
        success: false,
        message: "Feature flag not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Feature flag updated successfully",
      data: flag,
    });
  } catch (error) {
    next(error);
  }
}

async function deleteFlag(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid feature flag ID",
      });
    }

    const flag = await FeatureFlag.findByIdAndDelete(id);

    if (!flag) {
      return res.status(404).json({
        success: false,
        message: "Feature flag not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Feature flag deleted successfully",
    });
  } catch (error) {
    next(error);
  }
}

async function toggleFlag(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid feature flag ID",
      });
    }

    const flag = await FeatureFlag.findById(id);

    if (!flag) {
      return res.status(404).json({
        success: false,
        message: "Feature flag not found",
      });
    }

    flag.enabled = !flag.enabled;
    await flag.save();

    res.status(200).json({
      success: true,
      message: `Feature flag ${flag.enabled ? "enabled" : "disabled"} successfully`,
      data: flag,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createFlag,
  getAllFlags,
  getFlagById,
  updateFlag,
  deleteFlag,
  toggleFlag,
};
