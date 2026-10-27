import User from "./models/userModel.js";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGO_URI);

const result = await User.updateMany(
  { maxStorageInBytes: 1073741824 }, // match users with old 1 GB
  { $set: { maxStorageInBytes: 100 * 1024 * 1024 } } // update to 100 MB
);

console.log("Users updated successfully:", result);

await mongoose.disconnect();
process.exit(0);
