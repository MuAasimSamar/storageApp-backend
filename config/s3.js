import {
  Bucket$,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const s3Client = new S3Client({ profile: "default" });

const bucketName = "mask-storage-s3";
export const createUploadSignedUrl = async ({ key, contentType }) => {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(s3Client, command, {
    expiresIn: 300,
    signableHeaders: new Set(["content-type"]),
  });

  return url;
};

export const createGetSignedUrl = async ({
  key,
  download = false,
  filename,
}) => {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
    ResponseContentDisposition: `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(filename)}"`,
  });

  const url = await getSignedUrl(s3Client, command, {
    expiresIn: 300,
  });

  return url;
};

export const getS3FileMetaData = async (key) => {
  const command = new HeadObjectCommand({
    Bucket: bucketName,
    Key: key
  });
  return await s3Client.send(command);
};

export const deleteS3File = async (key) => {
  if (!key) return;
  const command = new DeleteObjectCommand ({
    Bucket: bucketName,
    Key: key
  });
  return await s3Client.send(command);
};

export const deleteS3Files = async (keys) => {
  if (!keys || keys.length === 0) {
    return { Deleted: [] };
  }
  const command = new DeleteObjectsCommand ({
    Bucket: bucketName,
    Delete: {
      Objects: keys,
      Quiet: false
    }
  });
  return await s3Client.send(command);
};