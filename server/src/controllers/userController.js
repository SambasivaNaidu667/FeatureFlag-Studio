const mongoose = require("mongoose");
const User = require("../models/User");
const { hashPassword, validatePassword } = require("../auth/auth");
const { recordAudit } = require("../services/auditService");

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

async function findTarget(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    badRequest(res, "Invalid user ID");
    return null;
  }
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ success: false, message: "User not found" });
    return null;
  }
  return user;
}

// Prevents removing the last active administrator.
async function isLastActiveAdmin(user) {
  if (user.role !== "admin" || user.status !== "active") return false;
  const others = await User.countDocuments({
    _id: { $ne: user._id },
    role: "admin",
    status: "active",
  });
  return others === 0;
}

async function listUsers(req, res, next) {
  try {
    const users = await User.find().sort({ createdAt: 1 });
    return res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    return next(error);
  }
}

async function createUser(req, res, next) {
  try {
    const { name, email, password, role = "viewer", ...rest } = req.body || {};
    if (Object.keys(rest).length) return badRequest(res, `Unexpected field: ${Object.keys(rest)[0]}`);
    const normalizedEmail = User.normalizeEmail(email);
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80) {
      return badRequest(res, "Name must be 2 to 80 characters");
    }
    if (!User.EMAIL_PATTERN.test(normalizedEmail)) return badRequest(res, "A valid email address is required");
    if (!User.ROLES.includes(role)) return badRequest(res, "Role must be admin, developer, or viewer");
    const passwordError = validatePassword(password);
    if (passwordError) return badRequest(res, passwordError);

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await hashPassword(password),
      role,
      status: "active",
    });
    await recordAudit(req.user, {
      action: "user.created",
      targetType: "user",
      targetId: user._id,
      targetLabel: user.email,
      summary: `Created ${role} account`,
    });
    return res.status(201).json({ success: true, message: "User created", data: user });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "A user with this email already exists" });
    }
    return next(error);
  }
}

async function updateRole(req, res, next) {
  try {
    const { role } = req.body || {};
    if (!User.ROLES.includes(role)) return badRequest(res, "Role must be admin, developer, or viewer");
    const user = await findTarget(req, res);
    if (!user) return;
    if (user.role === role) return res.status(200).json({ success: true, data: user });
    if (role !== "admin" && (await isLastActiveAdmin(user))) {
      return res.status(409).json({ success: false, message: "Cannot demote the last active administrator" });
    }
    if (user._id.equals(req.user._id)) return badRequest(res, "You cannot change your own role");
    const previous = user.role;
    user.role = role;
    await user.save();
    await recordAudit(req.user, {
      action: "user.role_changed",
      targetType: "user",
      targetId: user._id,
      targetLabel: user.email,
      summary: `Role changed from ${previous} to ${role}`,
    });
    return res.status(200).json({ success: true, message: "Role updated", data: user });
  } catch (error) {
    return next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    const { status } = req.body || {};
    if (!User.STATUSES.includes(status)) return badRequest(res, "Status must be active or deactivated");
    const user = await findTarget(req, res);
    if (!user) return;
    if (user.status === status) return res.status(200).json({ success: true, data: user });
    if (status === "deactivated" && (await isLastActiveAdmin(user))) {
      return res.status(409).json({ success: false, message: "Cannot deactivate the last active administrator" });
    }
    if (user._id.equals(req.user._id)) return badRequest(res, "You cannot change your own account status");
    const update = { $set: { status } };
    // Deactivation revokes every outstanding token immediately.
    if (status === "deactivated") update.$inc = { tokenVersion: 1 };
    const updated = await User.findByIdAndUpdate(user._id, update, { returnDocument: "after", runValidators: true });
    await recordAudit(req.user, {
      action: status === "deactivated" ? "user.deactivated" : "user.reactivated",
      targetType: "user",
      targetId: user._id,
      targetLabel: user.email,
      summary: status === "deactivated" ? "Account deactivated" : "Account reactivated",
    });
    return res.status(200).json({ success: true, message: "Status updated", data: updated });
  } catch (error) {
    return next(error);
  }
}

module.exports = { listUsers, createUser, updateRole, updateStatus };
