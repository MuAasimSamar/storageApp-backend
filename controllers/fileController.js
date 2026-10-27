import { createWriteStream } from "fs";
import { PERMISSIONS, ROLE_PERMISSIONS } from "../config/permissions.js";
import path from "path";
import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import { updateDirectoriesSize } from "../utils/updateDirectoriesSize.js";
import { recordActivity } from "../utils/logActivity.js";
import User from "../models/userModel.js";
import {
  createGetSignedUrl,
  createUploadSignedUrl,
  deleteS3File,
  getS3FileMetaData,
} from "../config/s3.js";

export const getFile = async (req, res) => {
  const { id } = req.params;
  const permissions = ROLE_PERMISSIONS[req.user?.role] || [];
  const canReadAll =
    permissions.includes("*") ||
    permissions.includes(PERMISSIONS.FILES_READ_ALL);
  const fileQuery = canReadAll
    ? { _id: id }
    : { _id: id, userId: req.user._id };

  const fileData = await File.findOne(fileQuery).lean();
  // Check if file exists
  if (!fileData) {
    return res.status(404).json({ error: "File not found!" });
  }

  const isDownload = req.query.action === "download";
  const fileUrl = await createGetSignedUrl({
    key: `${id}${fileData.extension}`,
    download: isDownload,
    filename: fileData.name,
  });

  if (req.query.json === "true" || req.headers.accept?.includes("application/json")) {
    return res.json({ url: fileUrl, filename: fileData.name });
  }

  return res.redirect(fileUrl);
};

export const renameFile = async (req, res, next) => {
  const { id } = req.params;
  const isAdmin = req.user?.role === "Admin" || req.user?.role === "Owner";
  const file = await File.findOne(
    isAdmin ? { _id: id } : { _id: id, userId: req.user._id },
  );

  // Check if file exists
  if (!file) {
    return res.status(404).json({ error: "File not found!" });
  }

  try {
    const oldName = file.name;
    file.name = req.body.newFilename;
    await file.save();
    recordActivity({
      targetUserId: file.userId,
      actor: req.user,
      action: "FILE_RENAME",
      itemName: oldName,
      details: `Renamed to '${req.body.newFilename}'`,
    });
    return res.status(200).json({ message: "Renamed" });
  } catch (err) {
    console.log(err);
    err.status = 500;
    next(err);
  }
};

export const deleteFile = async (req, res, next) => {
  const { id } = req.params;
  const isAdmin = req.user?.role === "Admin" || req.user?.role === "Owner";
  const file = await File.findOne(
    isAdmin ? { _id: id } : { _id: id, userId: req.user._id },
  );

  if (!file) {
    return res.status(404).json({ error: "File not found!" });
  }

  try {
    const fileName = file.name;
    const fileUserId = file.userId;
    await file.deleteOne();
    if (!file.isUploading && file.size > 0) {
      await updateDirectoriesSize(file.parentDirId, -file.size);
    }
    await deleteS3File(`${file.id}${file.extension}`);
    recordActivity({
      targetUserId: fileUserId,
      actor: req.user,
      action: "FILE_DELETE",
      itemName: fileName,
    });
    return res.status(200).json({ message: "File Deleted Successfully" });
  } catch (err) {
    next(err);
  }
};

export const uploadInitiate = async (req, res) => {
  const parentDirId = req.body.parentDirId || req.user.rootDirId;
  const isAdmin = req.user?.role === "Admin" || req.user?.role === "Owner";
  try {
    const parentDirQuery = isAdmin
      ? { _id: parentDirId }
      : { _id: parentDirId, userId: req.user._id };
    const parentDirData = await Directory.findOne(parentDirQuery);

    // Check if parent directory exists
    if (!parentDirData) {
      return res.status(404).json({ error: "Parent directory not found!" });
    }

    const filename = req.body.name
      ? decodeURIComponent(req.body.name)
      : "untitled";
    const filesize = req.body.size ? Number(req.body.size) : 0;

    const targetUserId = parentDirData.userId;
    const targetUser = await User.findById(targetUserId);
    const rootDir = await Directory.findById(targetUser.rootDirId);

    const remainingSpace = targetUser.maxStorageInBytes - rootDir.size;

    if (filesize > remainingSpace) {
      console.log("file too large");
      return res.status(507).json({ error: "Not Enough Storage." });
    }

    if (filesize > 900 * 1024 * 1024) return res.destroy(); //file size limit

    const extension = path.extname(filename);

    const insertedFile = await File.create({
      extension,
      name: filename,
      size: filesize,
      parentDirId: parentDirData._id,
      userId: targetUserId,
      isUploading: true,
    });

    const uploadSignedUrl = await createUploadSignedUrl({
      key: `${insertedFile._id}${extension}`,
      contentType: req.body.contentType,
    });

    res.json({ uploadSignedUrl, fileId: insertedFile._id });
  } catch (err) {
    console.error("Initiate file upload error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Failed to initiate file upload" });
  }
};

export const uploadComplete = async (req, res, next) => {
  const file = await File.findById(req.body.fileId);
  if (!file) {
    return res.status(404).json({ error: "File not found!" });
  }

  try {
    const fileData = await getS3FileMetaData(`${file._id}${file.extension}`);
    if (fileData.ContentLength !== file.size) {
      await file.deleteOne();
      return res.status(400).json({ error: "File size does not match." });
    }
    file.isUploading = false;
    await file.save();
    await updateDirectoriesSize(file.parentDirId, file.size);
    recordActivity({
      targetUserId: file.userId,
      actor: req.user,
      action: "FILE_UPLOAD",
      itemName: file.name,
    });
    res.json({ message: "Upload completed" });
  } catch (error) {
    await file.deleteOne();
    return res
      .status(404)
      .json({ error: "File was could not be uploaded properly" });
  }
};
