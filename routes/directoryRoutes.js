import express from "express";
import validateIdMiddleware from "../middlewares/validateIdMiddleware.js";

import {
  createDirectory,
  deleteDirectory,
  getDirectory,
  getUserDirectory,
  renameDirectory,
} from "../controllers/directoryController.js";
import checkAuth from "../middlewares/authMiddleware.js";
import { can } from "../middlewares/rbacMiddleware.js";
import { PERMISSIONS } from "../config/permissions.js";

const router = express.Router();

router.param("parentDirId", validateIdMiddleware);
router.param("userId", validateIdMiddleware);
router.param("id", validateIdMiddleware);

router.get(
  "/user/:userId/:id?",
  can(PERMISSIONS.FILES_READ_ALL),
  getUserDirectory,
);

router.get("/:id?", getDirectory);

router.post("/:parentDirId?", createDirectory);

router.patch("/:id", renameDirectory);

router.delete("/:id", deleteDirectory);

export default router;
