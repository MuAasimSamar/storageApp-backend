import express from "express";
import checkAuth from "../middlewares/authMiddleware.js";
import { can } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../config/permissions.js";
import {
  deleteUser,
  getAllUsers,
  getCurrentUser,
  login,
  logout,
  logoutAll,
  logoutById,
  recoverUser,
  register,
  updateUserRole,
} from "../controllers/userController.js";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";

// auth throttler
const authThrottler = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // Allow 3 requests to go at full speed
  delayMs: (hits) => (hits - 1) * 1000, // 4th request has a 1-second delay, 5th has 2-sec delay, etc.
});

// strict limiter for Auth routes
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // Limit each IP to 10 requests per hour!
  message:
    "Too many login attempts from this IP, please try again after an hour",
});

const router = express.Router();

router.post("/user/register", authThrottler, authLimiter, register);

router.post("/user/login", login);

router.get("/user", checkAuth, getCurrentUser);

router.post("/user/logout", logout);
router.post("/user/logout-all", logoutAll);

router.get("/users", checkAuth, can(PERMISSIONS.USERS_READ), getAllUsers);

router.post(
  "/users/:userId/logout",
  checkAuth,
  can(PERMISSIONS.USERS_SESSION_TERMINATE),
  logoutById,
);

router.patch(
  "/users/:userId/role",
  checkAuth,
  can(PERMISSIONS.USERS_UPDATE),
  updateUserRole,
);

router.delete(
  "/users/:userId",
  checkAuth,
  can(PERMISSIONS.USERS_DELETE),
  deleteUser,
);

router.patch(
  "/users/:userId/recover",
  checkAuth,
  can(PERMISSIONS.USERS_UPDATE),
  recoverUser,
);

export default router;
