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

function getSupabaseAdmin() {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY"); // важно: service role, только на сервере

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getBucket() {
  return process.env.SUPABASE_BUCKET?.trim() || "uploads";
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
  const supabase = getSupabaseAdmin();
  const bucket = getBucket();

  /**
   * Хелпер: создать signed upload URL + public URL
   */
  async function makeUpload(objectId: string, contentType: string, kind: "photos" | "logo") {
    const ct = contentType.trim();
    const ext = extFromContentType(ct);
    const id = crypto.randomUUID();

    const path =
      kind === "photos"
        ? `objects/${objectId}/photos/${id}.${ext}`
        : `objects/${objectId}/logo/${id}.${ext}`;

    // Supabase выдаёт URL для загрузки (обычно валиден ~ 60 сек; можно задавать expiresIn)
    // Важно: content-type не “подписывается” как в S3 — просто при PUT укажи тот же Content-Type.
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path, 120); // секунды

    if (error || !data) {
      throw new Error(error?.message ?? "createSignedUploadUrl failed");
    }

    // publicUrl будет работать только если bucket public.
    // Если bucket private — вместо publicUrl выдавай signed download url.
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);

    return {
      uploadUrl: data.signedUrl, // сюда фронт делает PUT
      token: data.token,         // полезно, если захочешь подтверждать upload (см. примечание ниже)
      publicUrl: pub.publicUrl,
      path,
    };
  }

  /**
   * POST /uploads/object-photo
   * body: { objectId, contentType }
   * -> { ok:true, uploadUrl, publicUrl, path }
   */
  app.post("/object-photo", async (req, reply) => {
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

      const r = await makeUpload(parsed.data.objectId, parsed.data.contentType, "photos");
      return reply.send({ ok: true, uploadUrl: r.uploadUrl, publicUrl: r.publicUrl, path: r.path });
    } catch (err: any) {
      app.log.error({ err }, "uploads/object-photo failed");
      return reply.code(500).send({ ok: false, error: "upload presign failed", message: err?.message ?? String(err) });
    }
  });

  /**
   * POST /uploads/object-logo
   */
  app.post("/object-logo", async (req, reply) => {
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

      const r = await makeUpload(parsed.data.objectId, parsed.data.contentType, "logo");
      return reply.send({ ok: true, uploadUrl: r.uploadUrl, publicUrl: r.publicUrl, path: r.path });
    } catch (err: any) {
      app.log.error({ err }, "uploads/object-logo failed");
      return reply.code(500).send({ ok: false, error: "upload presign failed", message: err?.message ?? String(err) });
    }
  });
}
