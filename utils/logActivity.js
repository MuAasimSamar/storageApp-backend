import Activity from "../models/activityModel.js";
import User from "../models/userModel.js";

export async function recordActivity({
  targetUserId,
  actor,
  action,
  itemName,
  details = "",
}) {
  try {
    if (!targetUserId || !actor) return;

    let realName = actor.name;
    let realRole = actor.role;

    // If actor.name is missing (e.g. from existing sessions), fetch real name directly from User model
    if (!realName && actor._id) {
      const u = await User.findById(actor._id).select("name role").lean();
      if (u) {
        realName = u.name;
        if (!realRole) realRole = u.role;
      }
    }

    // Only notify if someone else (e.g. Admin or Manager) performed the action on this drive
    const isOtherActor = actor._id.toString() !== targetUserId.toString();

    await Activity.create({
      targetUserId,
      actorId: actor._id,
      actorName: realName || "User",
      actorRole: realRole || "User",
      action,
      itemName,
      details,
      isRead: !isOtherActor,
    });
  } catch (err) {
    console.error("Failed to record activity log:", err);
  }
}

// Backfill real names for any past activities stored with "Admin"
export async function backfillActivityActorNames() {
  try {
    const activitiesWithAdmin = await Activity.find({ actorName: "Admin" }).lean();
    if (!activitiesWithAdmin || activitiesWithAdmin.length === 0) return;

    for (const act of activitiesWithAdmin) {
      if (act.actorId) {
        const u = await User.findById(act.actorId).select("name").lean();
        if (u?.name) {
          await Activity.updateOne(
            { _id: act._id },
            { $set: { actorName: u.name } }
          );
        }
      }
    }
    console.log(`[Activity] Backfilled real names for ${activitiesWithAdmin.length} activities.`);
  } catch (err) {
    console.error("Error backfilling activity actor names:", err);
  }
}
