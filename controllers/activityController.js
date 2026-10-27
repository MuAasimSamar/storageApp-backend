import Activity from "../models/activityModel.js";

export const getActivities = async (req, res, next) => {
  try {
    const targetUserId = req.query.userId || req.user._id;

    // Non-admins / non-owners can only see activities for their own drive
    if (
      req.user.role !== "Admin" &&
      req.user.role !== "Owner" &&
      targetUserId.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    const activities = await Activity.find({ targetUserId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const unreadCount = await Activity.countDocuments({
      targetUserId: req.user._id,
      isRead: false,
    });

    const formattedActivities = activities.map((act) => {
      const isSelf = act.actorId.toString() === req.user._id.toString();
      let actorDisplay = "You";
      if (!isSelf) {
        actorDisplay =
          act.actorRole === "Owner" || act.actorRole === "Admin"
            ? act.actorRole
            : act.actorName;
      }
      return {
        ...act,
        actorDisplay,
      };
    });

    return res.status(200).json({
      activities: formattedActivities,
      unreadCount,
    });
  } catch (err) {
    next(err);
  }
};

export const markActivitiesAsRead = async (req, res, next) => {
  try {
    await Activity.updateMany(
      { targetUserId: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );
    return res.status(200).json({ message: "Activities marked as read" });
  } catch (err) {
    next(err);
  }
};
