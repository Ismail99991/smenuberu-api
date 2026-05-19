import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import { uploadToS3 } from "../lib/s3";

function cookieName() {
  return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

async function getUserIdFromSession(app: FastifyInstance, req: any): Promise<string | null> {
  const sessionToken = (req.cookies as any)?.[cookieName()] ?? "";
  if (!sessionToken) return null;

  const tokenHash = sha256Hex(String(sessionToken));
  const prisma = (app as any).prisma;
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

export async function uploadsRoutes(app: FastifyInstance) {

  // DRAFT LOGO
  app.post("/draft-logo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ ok: false, error: "No file uploaded" });
    }

    try {
      const fileBuffer = await data.toBuffer();
      const draftId = (data as any).fields?.draftId?.value || crypto.randomUUID();
      const ct = data.mimetype;
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();
      const key = `drafts/${userId}/${draftId}/logo/${id}.${ext}`;
      
      const publicUrl = await uploadToS3(fileBuffer, key, ct);
      
      return reply.send({
        ok: true,
        publicUrl,
        path: key,
      });
    } catch (err: any) {
      app.log.error({ err }, "uploads/draft-logo failed");
      return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
    }
  });

  // DRAFT PHOTO
  app.post("/draft-photo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ ok: false, error: "No file uploaded" });
    }

    try {
      const fileBuffer = await data.toBuffer();
      const draftId = (data as any).fields?.draftId?.value || crypto.randomUUID();
      const ct = data.mimetype;
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();
      const key = `drafts/${userId}/${draftId}/photos/${id}.${ext}`;
      
      const publicUrl = await uploadToS3(fileBuffer, key, ct);
      
      return reply.send({
        ok: true,
        publicUrl,
        path: key,
      });
    } catch (err: any) {
      app.log.error({ err }, "uploads/draft-photo failed");
      return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
    }
  });

  // OBJECT LOGO
  app.post("/object-logo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ ok: false, error: "No file uploaded" });
    }

    try {
      const fileBuffer = await data.toBuffer();
      const objectId = (data as any).fields?.objectId?.value;
      if (!objectId) {
        return reply.code(400).send({ ok: false, error: "objectId required" });
      }

      const prisma = (app as any).prisma;
      const object = await prisma.object.findUnique({
        where: { id: objectId },
        select: { id: true },
      });

      if (!object) return reply.code(404).send({ ok: false, error: "Object not found" });

      const ct = data.mimetype;
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();
      const key = `objects/${objectId}/logo/${id}.${ext}`;
      
      const publicUrl = await uploadToS3(fileBuffer, key, ct);
      
      return reply.send({
        ok: true,
        publicUrl,
        path: key,
      });
    } catch (err: any) {
      app.log.error({ err }, "uploads/object-logo failed");
      return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
    }
  });

  // OBJECT PHOTO
  app.post("/object-photo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ ok: false, error: "No file uploaded" });
    }

    try {
      const fileBuffer = await data.toBuffer();
      const objectId = (data as any).fields?.objectId?.value;
      if (!objectId) {
        return reply.code(400).send({ ok: false, error: "objectId required" });
      }

      const prisma = (app as any).prisma;
      const object = await prisma.object.findUnique({
        where: { id: objectId },
        select: { id: true },
      });

      if (!object) return reply.code(404).send({ ok: false, error: "Object not found" });

      const ct = data.mimetype;
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();
      const key = `objects/${objectId}/photos/${id}.${ext}`;
      
      const publicUrl = await uploadToS3(fileBuffer, key, ct);
      
      return reply.send({
        ok: true,
        publicUrl,
        path: key,
      });
    } catch (err: any) {
      app.log.error({ err }, "uploads/object-photo failed");
      return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
    }
  });
}