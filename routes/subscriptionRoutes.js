import express from "express";
import checkAuth from "../middlewares/authMiddleware.js";
import {
  createSubscription,
  verifySubscription,
  cancelSubscription,
  handleWebhook,
} from "../controllers/subscriptionController.js";

const router = express.Router();

// User-facing endpoints (Requires login)
router.post("/", checkAuth, createSubscription);
router.post("/verify", checkAuth, verifySubscription);
router.post("/cancel", checkAuth, cancelSubscription);

// Razorpay Server-to-Server Webhook (Unauthenticated, verified via HMAC secret)
router.post("/webhook", handleWebhook);

export default router;
