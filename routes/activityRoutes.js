import express from "express";
import {
  getActivities,
  markActivitiesAsRead,
} from "../controllers/activityController.js";

const router = express.Router();

router.get("/", getActivities);
router.patch("/read", markActivitiesAsRead);

export default router;
