import Razorpay from "razorpay";
import crypto from "crypto";
import User from "../models/userModel.js";

const rzpInstance = new Razorpay({
  key_id: process.env.RAZORPAY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

export const PLAN_QUOTAS = {
  free: 100 * 1024 * 1024,

  // Pro Plans (Shows 500 MB on card -> gives 200 MB actual)
  plan_TaP4pR1KzOjoAC: 200 * 1024 * 1024, // Monthly
  plan_TaPCBIKWZDXmH2: 200 * 1024 * 1024, // Yearly

  // Ultimate Plans (Shows 1 GB on card -> gives 350 MB actual)
  plan_TaP6lULZnkYYi0: 350 * 1024 * 1024, // Monthly
  plan_TaPDMHVj5WRBYW: 350 * 1024 * 1024, // Yearly
};

const PLAN_TIER_BY_ID = {
  plan_TaP4pR1KzOjoAC: 1, // Pro Monthly
  plan_TaPCBIKWZDXmH2: 1, // Pro Yearly
  plan_TaP6lULZnkYYi0: 2, // Ultimate Monthly
  plan_TaPDMHVj5WRBYW: 2, // Ultimate Yearly
};

const PLAN_NAME_TIERS = {
  starter: 0,
  pro: 1,
  ultimate: 2,
};

export const createSubscription = async (req, res, next) => {
  try {
    const { planId } = req.body;
    if (!planId) {
      return res.status(400).json({ error: "planId is required" });
    }

    const targetTier = PLAN_TIER_BY_ID[planId];
    if (targetTier === undefined) {
      return res.status(400).json({ error: "Invalid plan ID selected." });
    }

    // Verify user doesn't already hold an equal or higher active plan
    const currentUser = await User.findById(req.user._id).select(
      "subscriptionPlan subscriptionStatus maxStorageInBytes",
    );

    if (currentUser) {
      const currentTier =
        PLAN_NAME_TIERS[
          (currentUser.subscriptionPlan || "Starter").toLowerCase()
        ] || 0;

      if (currentUser.subscriptionStatus === "active") {
        if (currentTier === targetTier) {
          return res.status(400).json({
            error: `You are already actively subscribed to the ${currentUser.subscriptionPlan} plan.`,
          });
        }
        if (currentTier > targetTier) {
          return res.status(400).json({
            error: `You are already on the ${currentUser.subscriptionPlan} plan. Purchasing a lower plan is disabled while your higher tier is active.`,
          });
        }
      }
    }

    const newSubscription = await rzpInstance.subscriptions.create({
      plan_id: planId,
      total_count: 6,
      quantity: 1,
      customer_notify: 1,
      notes: {
        userId: req.user._id,
      },
    });
    res.json({ subscriptionId: newSubscription.id });
  } catch (err) {
    console.log(err);
    next(err);
  }
};

export const verifySubscription = async (req, res, next) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
      planId,
    } = req.body;

    // Guard clause: Ensure all cryptographic tokens were received
    if (
      !razorpay_payment_id ||
      !razorpay_subscription_id ||
      !razorpay_signature ||
      !planId
    ) {
      return res
        .status(400)
        .json({ error: "Missing required payment verification parameters" });
    }

    // Compute expected HMAC-SHA256 signature
    const payload = `${razorpay_payment_id}|${razorpay_subscription_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(payload)
      .digest("hex");

    // Constant-time comparison (prevents timing attacks)
    const isAuthentic =
      expectedSignature.length === razorpay_signature.length &&
      crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(razorpay_signature),
      );

    if (!isAuthentic) {
      return res
        .status(400)
        .json({ error: "Invalid signature! Payment verification rejected." });
    }

    // Resolve the real storage quota in bytes & plan name
    const quotaInBytes = PLAN_QUOTAS[planId] || 100 * 1024 * 1024;

    let planName = "Starter";
    if (planId === "plan_TaP4pR1KzOjoAC" || planId === "plan_TaPCBIKWZDXmH2") {
      planName = "Pro";
    } else if (
      planId === "plan_TaP6lULZnkYYi0" ||
      planId === "plan_TaPDMHVj5WRBYW"
    ) {
      planName = "Ultimate";
    }

    // Update the user document atomically
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          maxStorageInBytes: quotaInBytes,
          subscriptionId: razorpay_subscription_id,
          subscriptionPlan: planName,
          subscriptionStatus: "active",
        },
      },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      message: `Successfully upgraded to ${planName}!`,
      user: {
        maxStorageInBytes: updatedUser.maxStorageInBytes,
        subscriptionPlan: updatedUser.subscriptionPlan,
        subscriptionStatus: updatedUser.subscriptionStatus,
      },
    });
  } catch (err) {
    console.error("Subscription verification failed:", err);
    next(err);
  }
};

export const handleWebhook = async (req, res) => {
  const webhookSignature = req.headers["x-razorpay-signature"];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSignature || !webhookSecret) {
    return res
      .status(400)
      .json({ error: "Missing webhook signature or secret" });
  }

  // Verify the signature against the raw body
  try {
    const rawPayload = req.rawBody
      ? req.rawBody.toString()
      : JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawPayload)
      .digest("hex");

    const isAuthentic =
      expectedSignature.length === webhookSignature.length &&
      crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(webhookSignature),
      );

    if (!isAuthentic) {
      console.warn("Webhook signature mismatch! Unauthorized request.");
      return res.status(400).json({ error: "Invalid webhook signature" });
    }
  } catch (err) {
    console.error("Webhook signature check error:", err);
    return res.status(400).json({ error: "Verification failed" });
  }

  // Process events
  const { event, payload } = req.body;
  console.log(`Razorpay Webhook Event: ${event}`);

  try {
    if (event === "subscription.charged") {
      const subscription = payload.subscription.entity;
      const planId = subscription.plan_id;
      const userId = subscription.notes?.userId;

      if (userId) {
        const quotaInBytes = PLAN_QUOTAS[planId] || 100 * 1024 * 1024;

        let planName = "Starter";
        if (
          planId === "plan_TaP4pR1KzOjoAC" ||
          planId === "plan_TaPCBIKWZDXmH2"
        ) {
          planName = "Pro";
        } else if (
          planId === "plan_TaP6lULZnkYYi0" ||
          planId === "plan_TaPDMHVj5WRBYW"
        ) {
          planName = "Ultimate";
        }

        await User.findByIdAndUpdate(userId, {
          $set: {
            maxStorageInBytes: quotaInBytes,
            subscriptionId: subscription.id,
            subscriptionPlan: planName,
            subscriptionStatus: "active",
          },
        });
        console.log(
          `✅ User ${userId} upgraded/renewed to ${planName} via Webhook`,
        );
      }
    } else if (event === "subscription.halted") {
      const subscription = payload.subscription.entity;
      const userId = subscription.notes?.userId;

      if (userId) {
        await User.findByIdAndUpdate(userId, {
          $set: { subscriptionStatus: "halted" },
        });
        console.log(`User ${userId} subscription halted`);
      }
    } else if (event === "subscription.cancelled") {
      const subscription = payload.subscription.entity;
      const userId = subscription.notes?.userId;

      if (userId) {
        // Downgrade user back to free Starter plan
        await User.findByIdAndUpdate(userId, {
          $set: {
            maxStorageInBytes: 100 * 1024 * 1024, // 100 MB
            subscriptionPlan: "Starter",
            subscriptionStatus: "cancelled",
          },
        });
        console.log(
          `User ${userId} downgraded to Starter due to cancellation`,
        );
      }
    }

    // Always return 200 OK fast so Razorpay knows you received it
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Error processing webhook:", err);
    return res.status(500).json({ error: "Failed to process webhook" });
  }
};

export const cancelSubscription = async (req, res, next) => {
  try {
    const { reason, feedback } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (
      user.subscriptionPlan === "Starter" ||
      user.subscriptionStatus !== "active"
    ) {
      return res
        .status(400)
        .json({ error: "No active paid subscription to cancel." });
    }

    // Cancel in Razorpay immediately
    if (user.subscriptionId) {
      try {
        // cancel_at_cycle_end: 0 cancels immediately in Razorpay
        await rzpInstance.subscriptions.cancel(user.subscriptionId, 0);
      } catch (rzpErr) {
        console.warn(
          "Razorpay subscription cancel warning:",
          rzpErr.error || rzpErr.message || rzpErr,
        );
      }
    }

    // Immediately revert user to free 100 MB Starter tier
    user.subscriptionPlan = "Starter";
    user.subscriptionStatus = "cancelled";
    user.maxStorageInBytes = 100 * 1024 * 1024; // 100 MB
    user.cancellationReason = reason || "Not specified";
    user.cancellationFeedback = feedback || "";
    await user.save();

    return res.status(200).json({
      success: true,
      message:
        "Subscription cancelled successfully. Your plan has been reverted to Starter.",
      user: {
        subscriptionPlan: user.subscriptionPlan,
        subscriptionStatus: user.subscriptionStatus,
        maxStorageInBytes: user.maxStorageInBytes,
      },
    });
  } catch (err) {
    console.error("Cancel subscription error:", err);
    next(err);
  }
};

