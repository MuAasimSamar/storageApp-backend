import Directory from "../models/directoryModel.js";
import User from "../models/userModel.js";
import mongoose, { Types } from "mongoose";
import Session from "../models/sessionModel.js";
import File from "../models/fileModel.js";
import OTP from "../models/otpModel.js";
import redisClient from "../config/redis.js";
import { loginSchema, registerSchema } from "../validators/authSchema.js";

export const register = async (req, res, next) => {
  const { success, data, error } = registerSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: z.flattenError(error) });
  }
  const { name, email, password, otp } = data;
  //   const otpRecord = await OTP.findOne({ email, otp });
  //
  //   if (!otpRecord) {
  //     return res.status(400).json({ error: "Invalid or Expired OTP!" });
  //   }
  //
  //   await otpRecord.deleteOne();

  const session = await mongoose.startSession();

  try {
    const rootDirId = new Types.ObjectId();
    const userId = new Types.ObjectId();

    session.startTransaction();

    await Directory.insertOne(
      {
        _id: rootDirId,
        name: `root-${email}`,
        parentDirId: null,
        userId,
        path: [],
      },
      { session },
    );

    await User.insertOne(
      {
        _id: userId,
        name,
        email,
        password,
        rootDirId,
      },
      { session },
    );

    session.commitTransaction();

    res.status(201).json({ message: "User Registered" });
  } catch (err) {
    session.abortTransaction();
    console.log(err);
    if (err.code === 121) {
      res
        .status(400)
        .json({ error: "Invalid input, please enter valid details" });
    } else if (err.code === 11000) {
      if (err.keyValue.email) {
        return res.status(409).json({
          error: "This email already exists",
          message:
            "A user with this email address already exists. Please try logging in or use a different email.",
        });
      }
    } else {
      next(err);
    }
  }
};

export const login = async (req, res, next) => {
  const { success, data, error } = loginSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: "invalid credentials" });
  }
  const { email, password } = data;
  const user = await User.findOne({ email });

  if (!user) {
    return res.status(404).json({ error: "Invalid Credentials" });
  }

  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    return res.status(404).json({ error: "Invalid Credentials" });
  }

  if (user.deleted) {
    return res.status(403).json({
      error: "Account Deactivated",
      message:
        "Your account has been deactivated. Please contact our support team at aasim.work7@gmail.com to reactivate your account.",
    });
  }

  const allSessions = await redisClient.ft.search(
    "userIdIdx",
    `@userId:{${user.id}}`,
    {
      RETURN: [],
    },
  );

  if (allSessions.total >= 2) {
    await redisClient.del(allSessions.documents[0].id);
  }

  const sessionId = crypto.randomUUID();
  const redisKey = `session:${sessionId}`;
  await redisClient.json.set(redisKey, "$", {
    userId: user._id,
    rootDirId: user.rootDirId,
    role: user.role,
    name: user.name,
  });

  const sessionExpiryTime = 60 * 1000 * 60 * 24 * 7;
  await redisClient.expire(redisKey, sessionExpiryTime / 1000);

  res.cookie("sid", sessionId, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    maxAge: sessionExpiryTime,
  });
  res.json({ message: "logged in" });
};

export const getAllUsers = async (req, res) => {
  const allUsers = await User.find({}).populate("rootDirId", "size").lean();

  const allSessionsUserIdSet = new Set();
  const sessionKeys = await redisClient.keys("session:*");
  if (sessionKeys.length > 0) {
    for (const key of sessionKeys) {
      const session = await redisClient.json.get(key);
      if (session && session.userId) {
        allSessionsUserIdSet.add(session.userId.toString());
      }
    }
  }

  const transformedUsers = allUsers.map(
    ({
      _id,
      name,
      email,
      role,
      subscriptionPlan,
      subscriptionStatus,
      cancellationReason,
      deleted,
      rootDirId,
      maxStorageInBytes,
    }) => ({
      id: _id,
      name,
      email,
      role: role || "User",
      subscriptionPlan: subscriptionPlan || "Starter",
      subscriptionStatus: subscriptionStatus || "none",
      cancellationReason: cancellationReason || null,
      deleted: Boolean(deleted),
      usedStorageInBytes: Math.max(0, rootDirId?.size || 0),
      maxStorageInBytes: maxStorageInBytes || 100 * 1024 ** 2,
      rootDirId: rootDirId?._id,
      isLoggedIn: allSessionsUserIdSet.has(_id.toString()),
    }),
  );
  res.status(200).json(transformedUsers);
};

export const getCurrentUser = async (req, res) => {
  const user = await User.findById(req.user._id).lean();
  if (!user)
    return res
      .status(404)
      .json({ error: "User not foundUser no longer exists in database" });
  const rootDir = await Directory.findById(user.rootDirId).lean();
  if (!rootDir) {
    return res.status(404).json({ error: "Root directory missing" });
  }

  res.status(200).json({
    id: user._id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    role: user.role,
    subscriptionPlan: user.subscriptionPlan || "Starter",
    subscriptionStatus: user.subscriptionStatus || "none",
    maxStorageInBytes: user.maxStorageInBytes,
    usedStorageInBytes: rootDir.size,
  });
};

export const logout = async (req, res) => {
  const { sid } = req.signedCookies;
  await redisClient.del(`session:${sid}`);
  res.clearCookie("sid");
  res.status(204).end();
};

export const logoutById = async (req, res, next) => {
  try {
    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }
    // Only the Owner can terminate another Owner's session
    if (targetUser.role === "Owner" && req.user.role !== "Owner") {
      return res.status(403).json({ error: "Cannot terminate Owner's session." });
    }

    const allSessions = await redisClient.ft.search(
      "userIdIdx",
      `@userId:{${req.params.userId}}`,
      { RETURN: [] },
    );
    if (allSessions.total > 0) {
      await redisClient.del(allSessions.documents.map(({ id }) => id));
    }
    await Session.deleteMany({ userId: req.params.userId });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

export const logoutAll = async (req, res) => {
  const { sid } = req.signedCookies;
  if (!sid) {
    return res.status(204).end();
  }
  const session = await redisClient.json.get(`session:${sid}`);
  if (!session || !session.userId) {
    return res.status(204).end();
  }
  const allSessions = await redisClient.ft.search(
    "userIdIdx",
    `@userId:{${session.userId}}`,
    {
      RETURN: [],
    },
  );
  if (allSessions?.documents?.length) {
    await redisClient.del(allSessions.documents.map(({ id }) => id));
  }
  res.status(204).end();
};

// soft delete
export const deleteUser = async (req, res, next) => {
  const { userId } = req.params;
  if (req.user._id.toString() === userId) {
    return res.status(403).json({ error: "You can not delete yourself." });
  }
  try {
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Owner cannot be deleted
    if (targetUser.role === "Owner") {
      return res.status(403).json({ error: "The Owner account cannot be deleted." });
    }

    // Admins cannot delete other Admins or Owner
    if (req.user.role === "Admin" && (targetUser.role === "Admin" || targetUser.role === "Owner")) {
      return res.status(403).json({ error: "Admins cannot delete other Admins." });
    }

    const allSessions = await redisClient.ft.search(
      "userIdIdx",
      `@userId:{${userId}}`,
      { RETURN: [] },
    );
    if (allSessions.total > 0) {
      await redisClient.del(allSessions.documents.map(({ id }) => id));
    }
    await Session.deleteMany({ userId });
    await User.findByIdAndUpdate(userId, { deleted: true });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

export const updateUserRole = async (req, res, next) => {
  const { userId } = req.params;
  const { role } = req.body;
  const callerRole = req.user.role;

  // Deadlock protection: Users cannot change their own role!
  if (req.user._id.toString() === userId) {
    return res.status(400).json({ error: "You cannot change your own role!" });
  }

  // Nobody can assign the "Owner" role
  if (role === "Owner") {
    return res.status(403).json({ error: "Cannot assign Owner role. There is only one Owner." });
  }

  try {
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ error: "User not found." });
    }

    // Owner's role is protected and immutable
    if (targetUser.role === "Owner") {
      return res.status(403).json({ error: "Owner role cannot be modified." });
    }

    // Hierarchy & permission rules
    if (callerRole === "Owner") {
      // Owner can make anyone Admin, Manager, User
      const allowedRolesForOwner = ["Admin", "Manager", "User"];
      if (!allowedRolesForOwner.includes(role)) {
        return res.status(400).json({ error: "Invalid role specified." });
      }
    } else if (callerRole === "Admin") {
      // Admin cannot change another Admin's role or Owner's role
      if (targetUser.role === "Admin" || targetUser.role === "Owner") {
        return res.status(403).json({ error: "Admins cannot modify Admin or Owner roles." });
      }
      // Admin can only assign Manager or User
      const allowedRolesForAdmin = ["Manager", "User"];
      if (!allowedRolesForAdmin.includes(role)) {
        return res.status(403).json({ error: "Admins can only assign Manager or User roles." });
      }
    } else {
      // Managers and regular users cannot change roles
      return res.status(403).json({ error: "You do not have permission to change user roles." });
    }

    // Update in MongoDB
    targetUser.role = role;
    await targetUser.save();

    // Instantly update their active session in Redis!
    const sessionKeys = await redisClient.keys("session:*");
    for (const key of sessionKeys) {
      const session = await redisClient.json.get(key);
      if (session && session.userId?.toString() === userId.toString()) {
        await redisClient.json.set(key, "$.role", role);
      }
    }

    res.status(200).json({
      message: `User role successfully updated to ${role}`,
      role: targetUser.role,
    });
  } catch (err) {
    next(err);
  }
};

export const recoverUser = async (req, res, next) => {
  const { userId } = req.params;
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { deleted: false },
      { new: true },
    );
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.status(200).json({ message: "User account recovered successfully" });
  } catch (err) {
    next(err);
  }
};
