import type { FastifyInstance } from "fastify";
import crypto from "crypto";
import { z } from "zod";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function cookieName() {
  return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * Достаём userId из текущей cookie-сессии (как в /auth/me)
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

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function sanitizeExtFromContentType(contentType: string) {
  const ct = contentType.toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  return "bin";
}

function makeS3() {
  const endpoint = process.env.YC_S3_ENDPOINT ?? "https://storage.yandexcloud.net";

  return new S3Client({
    region: process.env.YC_S3_REGION ?? "ru-central1",
    endpoint,
    credentials: {
      accessKeyId: mustEnv("YC_S3_ACCESS_KEY_ID"),
      secretAccessKey: mustEnv("YC_S3_SECRET_ACCESS_KEY"),
    },
  });
}

/**
 * ✅ ВАЖНО: экспорт называется uploadsRoutes
 */
export async function uploadsRoutes(app: FastifyInstance) {
  /**
   * POST /uploads/object-photo
   * Body: { objectId, contentType }
   * -> { ok: true, uploadUrl, publicUrl }
   */
  app.post("/object-photo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const body = z
      .object({
        objectId: z.string().min(1),
        contentType: z.string().min(1),
      })
      .parse(req.body);

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const obj = await prisma.object.findUnique({
      where: { id: body.objectId },
      select: { id: true },
    });
    if (!obj) return reply.code(404).send({ ok: false, error: "Object not found" });

    // max 3 фото (как в objectsRoutes)
    const photosCount = await prisma.objectPhoto.count({
      where: { objectId: body.objectId },
    });
    if (photosCount >= 3) {
      return reply.code(409).send({ ok: false, error: "Photos limit reached (max 3)" });
    }

    const bucket = mustEnv("YC_S3_BUCKET"); // smenuberu
    const publicBase = mustEnv("YC_S3_PUBLIC_BASE_URL"); // например https://storage.yandexcloud.net

    const ext = sanitizeExtFromContentType(body.contentType);
    const key = `objects/${body.objectId}/${crypto.randomUUID()}.${ext}`;

    const s3 = makeS3();

    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: body.contentType,
    });

    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 });

    const publicUrl = `${publicBase.replace(/\/+$/, "")}/${bucket}/${key}`
      .replace(/\/{2,}/g, "/")
      .replace(":/", "://");

    return reply.send({
      ok: true,
      uploadUrl,
      publicUrl,
    });
  });
}
