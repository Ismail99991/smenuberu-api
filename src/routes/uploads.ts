import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function cookieName() {
  return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * Достаём userId из cookie-сессии (как в /bookings/me).
 */
async function getUserIdFromSession(app: FastifyInstance, req: any): Promise<string | null> {
  const sessionToken = (req.cookies as any)?.[cookieName()] ?? "";
  if (!sessionToken) return null;

  const tokenHash = sha256Hex(String(sessionToken));

  // @ts-expect-error prisma is decorated in server.ts
  const prisma = app.prisma;

  const now = new Date();

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: { expiresAt: true, userId: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= now.getTime()) {
    await prisma.session.delete({ where: { tokenHash } }).catch(() => {});
    return null;
  }

  return session.userId;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env: ${name}`);
  return String(v).trim();
}

function getS3() {
  // Yandex Object Storage (S3-compatible)
  const endpoint = process.env.YOS_ENDPOINT?.trim() || "https://storage.yandexcloud.net";
  const region = process.env.YOS_REGION?.trim() || "ru-central1";
  const accessKeyId = requireEnv("YOS_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("YOS_SECRET_ACCESS_KEY");

  console.log('[DEBUG getS3] Endpoint:', endpoint);
  console.log('[DEBUG getS3] Region:', region);
  console.log('[DEBUG getS3] AccessKeyId length:', accessKeyId?.length || 0);
  console.log('[DEBUG getS3] SecretKey length:', secretAccessKey?.length || 0);

  return new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  });
}

function getBucket() {
  const bucket = process.env.YOS_BUCKET?.trim() || "smenuberu";
  console.log('[DEBUG getBucket] Bucket:', bucket);
  return bucket;
}

function getPublicBase(bucket: string) {
  const fromEnv = process.env.YOS_PUBLIC_BASE?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return `https://${bucket}.storage.yandexcloud.net`;
}

function extFromContentType(ct: string) {
  const c = ct.toLowerCase();
  if (c.includes("png")) return "png";
  if (c.includes("jpeg") || c.includes("jpg")) return "jpg";
  if (c.includes("webp")) return "webp";
  if (c.includes("gif")) return "gif";
  return "bin";
}

const uploadSchema = z.object({
  objectId: z.string().min(1),
  contentType: z.string().min(1),
});

export async function uploadsRoutes(app: FastifyInstance) {
  /**
   * POST /uploads/object-photo
   * body: { objectId, contentType }
   * -> { ok:true, uploadUrl, publicUrl, key }
   */
  app.post("/object-photo", async (req, reply) => {
    console.log('\n=== DEBUG UPLOAD START ===');
    console.log('[DEBUG] 1. Request received for /object-photo');

    const userId = await getUserIdFromSession(app, req);
    console.log('[DEBUG] 2. UserId from session:', userId);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const parsed = uploadSchema.safeParse(req.body);
    console.log('[DEBUG] 3. Parsed body:', JSON.stringify(parsed.data));
    if (!parsed.success) {
      console.log('[DEBUG] 3a. Parse error:', parsed.error.issues);
      return reply.code(400).send({ ok: false, error: "invalid payload", issues: parsed.error.issues });
    }

    try {
      // @ts-expect-error prisma is decorated in server.ts
      const prisma = app.prisma;

      const object = await prisma.object.findUnique({
        where: { id: parsed.data.objectId },
        select: { id: true },
      });

      console.log('[DEBUG] 4. Object found:', !!object);
      if (!object) return reply.code(404).send({ ok: false, error: "Object not found" });

      const bucket = getBucket();
      const s3 = getS3();

      const ct = parsed.data.contentType.trim();
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();

      const key = `objects/${parsed.data.objectId}/photos/${id}.${ext}`;
      console.log('[DEBUG] 5. Key:', key);
      console.log('[DEBUG] 6. ContentType:', ct);

      const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: ct,
        ChecksumAlgorithm: undefined,
      });
      console.log('[DEBUG] 7. Cmd created. ChecksumAlgorithm:', cmd.input.ChecksumAlgorithm);

      console.log('[DEBUG] 8. Generating signed URL...');
      const uploadUrl = await getSignedUrl(s3, cmd, {
        expiresIn: 120,
        signableHeaders: new Set(['host', 'content-type'])
      });
      console.log('[DEBUG] 9. Generated URL (first 200 chars):', uploadUrl.substring(0, 200));

      const publicBase = getPublicBase(bucket);
      const publicUrl = `${publicBase}/${key}`;
      console.log('[DEBUG] 10. Public URL:', publicUrl);
      console.log('[DEBUG] 11. Full presigned URL:', uploadUrl);
      console.log('=== DEBUG UPLOAD END ===\n');

      return reply.send({ ok: true, uploadUrl, publicUrl, key });
    } catch (err: any) {
      console.error('[DEBUG ERROR] Upload failed:', err);
      app.log.error({ err }, "uploads/object-photo failed");
      return reply.code(500).send({ ok: false, error: "upload presign failed", message: err?.message ?? String(err) });
    }
  });

  /**
   * POST /uploads/object-logo
   * body: { objectId, contentType }
   * -> { ok:true, uploadUrl, publicUrl, key }
   */
  app.post("/object-logo", async (req, reply) => {
    console.log('\n=== DEBUG LOGO UPLOAD START ===');
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid payload", issues: parsed.error.issues });
    }

    try {
      // @ts-expect-error prisma is decorated in server.ts
      const prisma = app.prisma;

      const object = await prisma.object.findUnique({
        where: { id: parsed.data.objectId },
        select: { id: true },
      });

      if (!object) return reply.code(404).send({ ok: false, error: "Object not found" });

      const bucket = getBucket();
      const s3 = getS3();

      const ct = parsed.data.contentType.trim();
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();

      const key = `objects/${parsed.data.objectId}/logo/${id}.${ext}`;

      const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: ct,
        ChecksumAlgorithm: undefined,
      });

      const uploadUrl = await getSignedUrl(s3, cmd, {
        expiresIn: 120,
        signableHeaders: new Set(['host', 'content-type'])
      });

      const publicBase = getPublicBase(bucket);
      const publicUrl = `${publicBase}/${key}`;

      console.log('=== DEBUG LOGO UPLOAD END ===');
      return reply.send({ ok: true, uploadUrl, publicUrl, key });
    } catch (err: any) {
      console.error('[DEBUG ERROR] Logo upload failed:', err);
      app.log.error({ err }, "uploads/object-logo failed");
      return reply.code(500).send({ ok: false, error: "upload presign failed", message: err?.message ?? String(err) });
    }
  });
}