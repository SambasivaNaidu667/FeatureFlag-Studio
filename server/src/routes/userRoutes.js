const express = require("express");
const AuditLog = require("../models/AuditLog");
const { requireAuth, requirePermission } = require("../auth/auth");
const {
  listUsers,
  createUser,
  updateRole,
  updateStatus,
} = require("../controllers/userController");

const userRouter = express.Router();
userRouter.use(requireAuth, requirePermission("users:manage"));
userRouter.get("/", listUsers);
userRouter.post("/", createUser);
userRouter.patch("/:id/role", updateRole);
userRouter.patch("/:id/status", updateStatus);

const auditRouter = express.Router();
auditRouter.use(requireAuth, requirePermission("audit:read"));
auditRouter.get("/", async (req, res, next) => {
  try {
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 200) : 50;
    const events = await AuditLog.find().sort({ createdAt: -1 }).limit(limit);
    return res.status(200).json({ success: true, count: events.length, data: events });
  } catch (error) {
    return next(error);
  }
});

module.exports = { userRouter, auditRouter };
