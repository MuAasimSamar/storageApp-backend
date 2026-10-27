import Directory from "../models/directoryModel.js";

export async function updateDirectoriesSize(parentId, deltaSize) {
  const numericDelta = Number(deltaSize);

  while (parentId) {
    const dir = await Directory.findById(parentId);
    if (!dir) break;

    // Clamp new size to minimum 0:
    const newSize = Math.max(0, (dir.size || 0) + numericDelta);

    await Directory.findByIdAndUpdate(parentId, { size: newSize });

    parentId = dir.parentDirId;
  }
}
