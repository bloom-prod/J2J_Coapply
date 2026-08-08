import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// Resumes are stored in MinIO/S3 (not baked into the image). Lazy client so
// `next build` works without S3 creds; env is only read on first use.
let client: S3Client | null = null;
let bucket = "";

function getClient(): S3Client {
  if (!client) {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error("Missing S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY — resumes need MinIO/S3.");
    }
    bucket = process.env.S3_BUCKET || "jobless-resumes";
    client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

export async function ensureBucket(): Promise<void> {
  const c = getClient();
  try {
    await c.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch {
    /* bucket missing — try to create */
  }
  try {
    await c.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch {
    /* raced with another creator, or permission issue; leave it */
  }
}

export async function putResume(key: string, body: Buffer): Promise<void> {
  await getClient().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/pdf" })
  );
}

export async function getResumeBuffer(key: string): Promise<Buffer | null> {
  try {
    const res = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  } catch {
    return null;
  }
}

export async function deleteResume(key: string): Promise<void> {
  try {
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    /* already gone — ignore */
  }
}