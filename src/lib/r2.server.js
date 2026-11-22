import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client;
function config() {
  const endpoint = process.env.R2_S3_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Armazenamento R2 não configurado. Confira os Secrets R2 no Supabase/Vercel.");
  }
  return { endpoint, accessKeyId, secretAccessKey, bucket };
}
function getClient() {
  if (!client) {
    const c = config();
    client = new S3Client({
      region: "auto",
      endpoint: c.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    });
  }
  return client;
}
export function videoObjectKey(userId, videoId) {
  return userId + "/" + videoId + ".mp4";
}
export async function createVideoUploadUrl(userId, videoId, contentLength) {
  if (!Number.isSafeInteger(contentLength) || contentLength < 64 * 1024 || contentLength > 5 * 1024 * 1024 * 1024) {
    throw new Error("O tamanho do MP4 é inválido para armazenamento no R2.");
  }
  const c = config();
  const key = videoObjectKey(userId, videoId);
  const command = new PutObjectCommand({
    Bucket: c.bucket, Key: key, ContentType: "video/mp4",
  });
  const uploadUrl = await getSignedUrl(getClient(), command, { expiresIn: 900 });
  return { uploadUrl, key, requiredHeaders: { "Content-Type": "video/mp4" } };
}
export async function finalizeVideoUpload(userId, videoId, key) {
  const expectedKey = videoObjectKey(userId, videoId);
  if (key !== expectedKey) throw new Error("A chave do arquivo não corresponde ao vídeo autenticado.");
  const c = config();
  await getClient().send(new HeadObjectCommand({ Bucket: c.bucket, Key: key }));
  const objectUrl = "r2://" + key;
  const downloadUrl = await createVideoDownloadUrl(key);
  return { objectUrl, downloadUrl };
}
export async function createVideoDownloadUrl(key) {
  const c = config();
  if (typeof key !== "string" || !key.endsWith(".mp4") || key.startsWith("/") || key.includes("..")) {
    throw new Error("Referência de MP4 inválida.");
  }
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: c.bucket, Key: key, ResponseContentType: "video/mp4" }), { expiresIn: 3600 });
}
export async function deleteVideoObject(key) {
  const c = config();
  if (typeof key !== "string" || !key.endsWith(".mp4") || key.startsWith("/") || key.includes("..")) {
    throw new Error("Referência de MP4 inválida.");
  }
  await getClient().send(new DeleteObjectCommand({ Bucket: c.bucket, Key: key }));
}
