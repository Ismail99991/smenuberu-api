import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import { uploadToS3, generateFileKey, deleteFromS3 } from "../lib/s3";

function cookieName() {
  return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * Достаём userId из cookie-сессии.
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

function extFromContentType(ct: string) {
  const c = (ct || "").toLowerCase();
  if (c.includes("png")) return "png";
  if (c.includes("jpeg") || c.includes("jpg")) return "jpg";
  if (c.includes("webp")) return "webp";
  if (c.includes("gif")) return "gif";
  return "bin";
}

const objectUploadSchema = z.object({
  objectId: z.string().min(1),
  contentType: z.string().min(1),
});

const draftUploadSchema = z.object({
  draftId: z.string().min(1),
  contentType: z.string().min(1),
});

type UploadResponse = { ok: true; publicUrl: string; path: string };

export async function uploadsRoutes(app: FastifyInstance) {

  // -----------------------
  // DRAFT UPLOADS (без БД)
  // -----------------------

  /**
   * POST /uploads/draft-logo
   * body: { draftId, contentType }
   * NOTE: Теперь ожидаем, что файл приходит в body как buffer
   * Для упрощения: клиент должен отправить файл напрямую
   */
  app.post("/draft-logo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    // Ожидаем multipart/form-data с файлом
    const data = req.body as any;
    const file = data?.file;
    
    if (!file || !file.data) {
      return reply.code(400).send({ ok: false, error: "No file uploaded" });
    }

    const parsed = draftUploadSchema.safeParse(data);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid payload", issues: parsed.error.issues });
    }

    try {
      const ct = file.mimetype || "image/jpeg";
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();
      const key = `drafts/${userId}/${parsed.data.draftId}/logo/${id}.${ext}`;
      
      const publicUrl = await uploadToS3(file.data, key, ct);
      
      return reply.send({
        ok: true,
        publicUrl,
        path: key,
      } as UploadResponse);
    } catch (err: any) {
      app.log.error({ err }, "uploads/draft-logo failed");
      return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
    }
  });

  /**
   * POST /uploads/draft-photo
   * body: { draftId, contentType }
   */
  app.post("/draft-photo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const data = req.body as any;
    const file = data?.file;
    
    if (!file || !file.data) {
      return reply.code(400).send({ ok: false, error: "No file uploaded" });
    }

    const parsed = draftUploadSchema.safeParse(data);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid payload", issues: parsed.error.issues });
    }

    try {
      const ct = file.mimetype || "image/jpeg";
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();
      const key = `drafts/${userId}/${parsed.data.draftId}/photos/${id}.${ext}`;
      
      const publicUrl = await uploadToS3(file.data, key, ct);
      
      return reply.send({
        ok: true,
        publicUrl,
        path: key,
      } as UploadResponse);
    } catch (err: any) {
      app.log.error({ err }, "uploads/draft-photo failed");
      return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
    }
  });

  // -----------------------
  // OBJECT UPLOADS
  // -----------------------

  /**
   * POST /uploads/object-photo
   * body: { objectId, contentType }
   */
  app.post("/object-photo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const data = req.body as any;
    const file = data?.file;
    
    if (!file || !file.data) {
      return reply.code(400).send({ ok: false, error: "No file uploaded" });
    }

    const parsed = objectUploadSchema.safeParse(data);
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

      const ct = file.mimetype || "image/jpeg";
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();
      const key = `objects/${parsed.data.objectId}/photos/${id}.${ext}`;
      
      const publicUrl = await uploadToS3(file.data, key, ct);
      
      return reply.send({
        ok: true,
        publicUrl,
        path: key,
      } as UploadResponse);
    } catch (err: any) {
      app.log.error({ err }, "uploads/object-photo failed");
      return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
    }
  });

  /**
   * POST /uploads/object-logo
   * body: { objectId, contentType }
   */
  app.post("/object-logo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const data = req.body as any;
    const file = data?.file;
    
    if (!file || !file.data) {
      return reply.code(400).send({ ok: false, error: "No file uploaded" });
    }

    const parsed = objectUploadSchema.safeParse(data);
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

      const ct = file.mimetype || "image/jpeg";
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();
      const key = `objects/${parsed.data.objectId}/logo/${id}.${ext}`;
      
      const publicUrl = await uploadToS3(file.data, key, ct);
      
      return reply.send({
        ok: true,
        publicUrl,
        path: key,
      } as UploadResponse);
    } catch (err: any) {
      app.log.error({ err }, "uploads/object-logo failed");
      return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
    }
  });
}