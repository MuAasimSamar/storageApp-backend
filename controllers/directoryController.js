import { rm } from "fs/promises";
import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import User from "../models/userModel.js";
import { updateDirectoriesSize } from "../utils/updateDirectoriesSize.js";
import { recordActivity } from "../utils/logActivity.js";
import { deleteS3Files } from "../config/s3.js";

export const getDirectory = async (req, res) => {
  const user = req.user;
  const _id = req.params.id || user.rootDirId.toString();
  const directoryData = await Directory.findOne({ _id,userId: req.user._id }).populate("path", "name _id").lean();
  if (!directoryData) {
    return res
      .status(404)
      .json({ error: "Directory not found or you do not have access to it!" });
  }

  const files = await File.find({
    parentDirId: directoryData._id,
    isUploading: { $ne: true },
  }).lean();
  
  const directories = await Directory.aggregate([
    { $match: { parentDirId: directoryData._id } },
    {
      $lookup: {
        from: "files",
        let: { dirId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$parentDirId", "$$dirId"] } } },
          { $count: "count" }
        ],
        as: "fileCountData"
      }
    },
    {
      $lookup: {
        from: "directories",
        let: { dirId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$parentDirId", "$$dirId"] } } },
          { $count: "count" }
        ],
        as: "dirCountData"
      }
    },
    {
      $addFields: {
        fileCount: { $ifNull: [{ $arrayElemAt: ["$fileCountData.count", 0] }, 0] },
        directoryCount: { $ifNull: [{ $arrayElemAt: ["$dirCountData.count", 0] }, 0] },
        id: "$_id"
      }
    },
    {
      $project: {
        fileCountData: 0,
        dirCountData: 0
      }
    }
  ]);

  return res.status(200).json({
    ...directoryData,
    files: files.map((dir) => ({ ...dir, id: dir._id })),
    directories,
  });
};

export const createDirectory = async (req, res, next) => {
  const user = req.user;
  const isAdmin = user.role === "Admin" || user.role === "Owner";
  const parentDirId = req.params.parentDirId || user.rootDirId.toString();
  const dirname = req.headers.dirname || "New Folder";
  try {
    const parentDirQuery = isAdmin
      ? { _id: parentDirId }
      : { _id: parentDirId, userId: user._id };
    const parentDir = await Directory.findOne(parentDirQuery).lean();

    if (!parentDir)
      return res
        .status(404)
        .json({ message: "Parent Directory Does not exist!" });

    const newPath = [...(parentDir.path || []), parentDir._id];

    await Directory.create({
      name: dirname,
      parentDirId: parentDir._id,
      userId: parentDir.userId,
      path: newPath,
    });

    recordActivity({
      targetUserId: parentDir.userId,
      actor: user,
      action: "DIRECTORY_CREATE",
      itemName: dirname,
    });

    return res.status(201).json({ message: "Directory Created!" });
  } catch (err) {
    if (err.code === 121) {
      res
        .status(400)
        .json({ error: "Invalid input, please enter valid details" });
    } else {
      next(err);
    }
  }
};

export const renameDirectory = async (req, res, next) => {
  const user = req.user;
  const { id } = req.params;
  const { newDirName } = req.body;
  const isAdmin = user.role === "Admin" || user.role === "Owner";
  try {
    const directory = await Directory.findOneAndUpdate(
      isAdmin ? { _id: id } : { _id: id, userId: user._id },
      { name: newDirName },
    );

    if (directory) {
      recordActivity({
        targetUserId: directory.userId,
        actor: user,
        action: "DIRECTORY_RENAME",
        itemName: directory.name,
        details: `Renamed to '${newDirName}'`,
      });
    }

    res.status(200).json({ message: "Directory Renamed!" });
  } catch (err) {
    next(err);
  }
};

export const deleteDirectory = async (req, res, next) => {
  const { id } = req.params;
  const isAdmin = req.user?.role === "Admin" || req.user?.role === "Owner";

  try {
    const directoryData = await Directory.findOne(
      isAdmin ? { _id: id } : { _id: id, userId: req.user._id },
    ).lean();

    if (!directoryData) {
      return res.status(404).json({ error: "Directory not found!" });
    }

    async function getDirectoryContents(id) {
      let files = await File.find({ parentDirId: id })
        .select("extension")
        .lean();
      let directories = await Directory.find({ parentDirId: id })
        .select("_id")
        .lean();

      for (const { _id } of directories) {
        const { files: childFiles, directories: childDirectories } =
          await getDirectoryContents(_id);

        files = [...files, ...childFiles];
        directories = [...directories, ...childDirectories];
      }

      return { files, directories };
    }

    const { files, directories } = await getDirectoryContents(id);

    const keys = files.map(({ _id, extension }) => ({ Key: `${_id}${extension}` }));

    if (keys.length > 0) {
      await deleteS3Files(keys);
    }

    if (files.length > 0) {
      await File.deleteMany({
        _id: { $in: files.map(({ _id }) => _id) },
      });
    }

    await Directory.deleteMany({
      _id: { $in: [...directories.map(({ _id }) => _id), id] },
    });

    if (directoryData.parentDirId && directoryData.size) {
      await updateDirectoriesSize(directoryData.parentDirId, -directoryData.size);
    }

    recordActivity({
      targetUserId: directoryData.userId,
      actor: req.user,
      action: "DIRECTORY_DELETE",
      itemName: directoryData.name,
    });

    return res.json({ message: "Directory deleted successfully" });
  } catch (err) {
    return next(err);
  }
};

// Allows Admins & Managers to inspect another user's directory
export const getUserDirectory = async (req, res, next) => {
  const { userId, id } = req.params;

  try {
    const targetUser = await User.findById(userId).lean();
    if (!targetUser) {
      return res.status(404).json({ error: "Target user not found" });
    }

    // Default to the target user's root folder if no specific folder ID is given
    const _id = id || targetUser.rootDirId.toString();

    const directoryData = await Directory.findOne({ _id, userId: targetUser._id })
      .populate("path", "name _id")
      .lean();

    if (!directoryData) {
      return res.status(404).json({ error: "Directory not found!" });
    }

    const files = await File.find({
      parentDirId: directoryData._id,
      isUploading: { $ne: true },
    }).lean();

    const directories = await Directory.aggregate([
      { $match: { parentDirId: directoryData._id } },
      {
        $lookup: {
          from: "files",
          let: { dirId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$parentDirId", "$$dirId"] } } },
            { $count: "count" },
          ],
          as: "fileCountData",
        },
      },
      {
        $lookup: {
          from: "directories",
          let: { dirId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$parentDirId", "$$dirId"] } } },
            { $count: "count" },
          ],
          as: "dirCountData",
        },
      },
      {
        $addFields: {
          fileCount: { $ifNull: [{ $arrayElemAt: ["$fileCountData.count", 0] }, 0] },
          directoryCount: { $ifNull: [{ $arrayElemAt: ["$dirCountData.count", 0] }, 0] },
          id: "$_id",
        },
      },
      { $project: { fileCountData: 0, dirCountData: 0 } },
    ]);

    return res.status(200).json({
      ...directoryData,
      files: files.map((f) => ({ ...f, id: f._id })),
      directories,
      owner: {
        id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email,
      },
    });
  } catch (err) {
    next(err);
  }
};
