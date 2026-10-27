import { model, Schema } from "mongoose";

const activitySchema = new Schema(
  {
    targetUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actorName: {
      type: String, // e.g. "Aasim"
      required: true,
    },
    actorRole: {
      type: String, // e.g. "Admin"
      required: true,
    },
    action: {
      type: String,
      enum: [
        "FILE_UPLOAD",
        "FILE_DELETE",
        "FILE_RENAME",
        "DIRECTORY_CREATE",
        "DIRECTORY_DELETE",
        "DIRECTORY_RENAME",
      ],
      required: true,
    },
    itemName: {
      type: String,
      required: true,
    },
    details: {
      type: String,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Activity = model("Activity", activitySchema);
export default Activity;
