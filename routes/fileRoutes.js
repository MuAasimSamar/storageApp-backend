import express from "express";
import validateIdMiddleware from "../middlewares/validateIdMiddleware.js";
import {
  deleteFile,
  getFile,
  renameFile,
  uploadComplete,
  uploadInitiate,
} from "../controllers/fileController.js";
import slowDown from "express-slow-down";

const router = express.Router();

// file throttler
const fileThrottler = slowDown({
  windowMs: 1 * 60 * 1000, // 1 minute
  delayAfter: 3, // Allow 3 quick uploads
  delayMs: (hits) => (hits - 3) * 500, // slow them down by 2 seconds for each subsequent file
});

router.param("parentDirId", validateIdMiddleware);
router.param("id", validateIdMiddleware);

router.post("/upload/initiate",uploadInitiate);
router.post("/upload/complete",uploadComplete);

router.get("/:id", getFile);

router.patch("/:id", renameFile);

router.delete("/:id", deleteFile);

export default router;
