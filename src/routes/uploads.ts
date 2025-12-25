import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env: ${name}`);
  return String(v).trim();
}

function getBucket() {
  return process.env.SUPABASE_BUCKET?.trim() || "uploads";
}

function getSupabaseAdmin() {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY"); // только сервер

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

type PresignResponse = { ok: true; uploadUrl: string; publicUrl: string; path: string };

export async function uploadsRoutes(app: FastifyInstance) {
  const supabase = getSupabaseAdmin();
  const bucket = getBucket();

  async function createSignedUpload(path: string, contentType: string): Promise<PresignResponse> {
    // createSignedUploadUrl не “запирает” Content-Type как S3, но мы всё равно передаём ct клиенту.
    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "createSignedUploadUrl failed");

    // publicUrl работает только если bucket public.
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);

    return {
      ok: true,
      uploadUrl: data.signedUrl,
      publicUrl: pub.publicUrl,
      path,
    };
  }

  // -----------------------
  // DRAFT UPLOADS (без БД)
  // -----------------------

  /**
   * POST /uploads/draft-logo
   * body: { draftId, contentType }
   * -> { ok:true, uploadUrl, publicUrl, path }
   */
  app.post("/draft-logo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const parsed = draftUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid payload", issues: parsed.error.issues });
    }

    try {
      const ct = parsed.data.contentType.trim();
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();

      const path = `drafts/${userId}/${parsed.data.draftId}/logo/${id}.${ext}`;
      const r = await createSignedUpload(path, ct);
      return reply.send(r);
    } catch (err: any) {
      app.log.error({ err }, "uploads/draft-logo failed");
      return reply.code(500).send({ ok: false, error: "upload presign failed", message: err?.message ?? String(err) });
    }
  });

  /**
   * POST /uploads/draft-photo
   * body: { draftId, contentType }
   * -> { ok:true, uploadUrl, publicUrl, path }
   */
  app.post("/draft-photo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const parsed = draftUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid payload", issues: parsed.error.issues });
    }

    try {
      const ct = parsed.data.contentType.trim();
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();

      const path = `drafts/${userId}/${parsed.data.draftId}/photos/${id}.${ext}`;
      const r = await createSignedUpload(path, ct);
      return reply.send(r);
    } catch (err: any) {
      app.log.error({ err }, "uploads/draft-photo failed");
      return reply.code(500).send({ ok: false, error: "upload presign failed", message: err?.message ?? String(err) });
    }
  });

  // -----------------------
  // OBJECT UPLOADS (как было)
  // -----------------------

  /**
   * POST /uploads/object-photo
   * body: { objectId, contentType }
   * -> { ok:true, uploadUrl, publicUrl, path }
   */
  app.post("/object-photo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const parsed = objectUploadSchema.safeParse(req.body);
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

      const ct = parsed.data.contentType.trim();
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();

      const path = `objects/${parsed.data.objectId}/photos/${id}.${ext}`;
      const r = await createSignedUpload(path, ct);
      return reply.send(r);
    } catch (err: any) {
      app.log.error({ err }, "uploads/object-photo failed");
      return reply.code(500).send({ ok: false, error: "upload presign failed", message: err?.message ?? String(err) });
    }
  });

  /**
   * POST /uploads/object-logo
   * body: { objectId, contentType }
   * -> { ok:true, uploadUrl, publicUrl, path }
   */
  app.post("/object-logo", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const parsed = objectUploadSchema.safeParse(req.body);
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

      const ct = parsed.data.contentType.trim();
      const ext = extFromContentType(ct);
      const id = crypto.randomUUID();

      const path = `objects/${parsed.data.objectId}/logo/${id}.${ext}`;
      const r = await createSignedUpload(path, ct);
      return reply.send(r);
    } catch (err: any) {
      app.log.error({ err }, "uploads/object-logo failed");
      return reply.code(500).send({ ok: false, error: "upload presign failed", message: err?.message ?? String(err) });
    }
  });
}
