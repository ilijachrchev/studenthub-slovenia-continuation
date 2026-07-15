const express = require("express");
const catchAsync = require("../middleware/catchAsync");
const { requireAuth } = require("../middleware/auth");
const notificationService = require("../services/notification");

const router = express.Router();

router.get("/", requireAuth, catchAsync(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

  const result = await notificationService.getByUser(req.session.user.id, { page, limit });
  res.json(result);
}));

router.get("/unread-count", requireAuth, catchAsync(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.session.user.id);
  res.json({ count });
}));

router.patch("/:id/read", requireAuth, catchAsync(async (req, res) => {
  const updated = await notificationService.markAsRead(
    parseInt(req.params.id, 10),
    req.session.user.id
  );
  if (!updated) {
    return res.status(404).json({ error: "Notification not found" });
  }
  res.json({ message: "Marked as read" });
}));

router.patch("/read-all", requireAuth, catchAsync(async (req, res) => {
  const count = await notificationService.markAllAsRead(req.session.user.id);
  res.json({ message: "All notifications marked as read", count });
}));

router.delete("/:id", requireAuth, catchAsync(async (req, res) => {
  const removed = await notificationService.remove(
    parseInt(req.params.id, 10),
    req.session.user.id
  );
  if (!removed) {
    return res.status(404).json({ error: "Notification not found" });
  }
  res.json({ message: "Notification deleted" });
}));

module.exports = router;
