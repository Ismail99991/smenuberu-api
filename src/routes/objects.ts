import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "crypto";

const urlOrEmpty = z
  .string()
  .trim()
  .min(1)
  .url();

const photosSchema = z.array(urlOrEmpty).max(3);

// ✅ координаты (nullable), валидируем диапазоны
const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

const createObjectSchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  address: z.string().optional().nullable(),

  // ✅ новые поля (optional)
  type: z.string().min(1).optional().nullable(),
  logoUrl: urlOrEmpty.optional().nullable(),
  photos: photosSchema.optional().nullable(),

  // ✅ lat/lng (optional)
  lat: latSchema.optional().nullable(),
  lng: lngSchema.optional().nullable(),
});

const updateObjectSchema = z.object({
  name: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  address: z.string().optional().nullable(),

  // ✅ новые поля (optional)
  type: z.string().min(1).optional().nullable(),
  logoUrl: urlOrEmpty.optional().nullable(),
  // если передали:
  // - массив => заменить
  // - null => очистить
  photos: photosSchema.optional().nullable(),

  // ✅ lat/lng (optional)
  lat: latSchema.optional().nullable(),
  lng: lngSchema.optional().nullable(),
});

function normalizeOptString(x: unknown): string | null | undefined {
  if (x === undefined) return undefined;
  if (x === null) return null;
  if (typeof x === "string") {
    const t = x.trim();
    return t.length ? t : null;
  }
  return undefined;
}

// ✅ auth utils (как в /auth/me)
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

export async function objectsRoutes(app: FastifyInstance) {
  /**
   * GET /objects
   */
  app.get("/", async () => {
    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const rows = await prisma.object.findMany({
      orderBy: [{ city: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        city: true,
        address: true,
        createdAt: true,

        type: true,
        logoUrl: true,

        // ✅ lat/lng
        lat: true,
        lng: true,

        photos: {
          orderBy: { position: "asc" },
          select: { url: true, position: true },
        },
      },
    });

    return rows.map((o: any) => ({
      ...o,
      photos: Array.isArray(o.photos) ? o.photos.map((p: any) => p.url) : [],
    }));
  });

  /**
   * GET /objects/:id
   */
  app.get("/:id", async (req, reply) => {
    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const { id } = req.params as any;

    const obj = await prisma.object.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        city: true,
        address: true,
        createdAt: true,

        type: true,
        logoUrl: true,

        // ✅ lat/lng
        lat: true,
        lng: true,

        photos: {
          orderBy: { position: "asc" },
          select: { url: true, position: true },
        },
      },
    });

    if (!obj) return reply.code(404).send({ ok: false, error: "not found" });

    return {
      ...obj,
      photos: Array.isArray((obj as any).photos) ? (obj as any).photos.map((p: any) => p.url) : [],
    };
  });

  /**
   * POST /objects
   */
  app.post("/", async (req, reply) => {
    // ✅ require auth for create
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const parsed = createObjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: "invalid payload",
        issues: parsed.error.issues,
      });
    }

    const type = normalizeOptString(parsed.data.type);
    const logoUrl = parsed.data.logoUrl == null ? null : String(parsed.data.logoUrl).trim();
    const photos = parsed.data.photos ?? undefined;

    // ✅ координаты
    const lat = parsed.data.lat ?? null;
    const lng = parsed.data.lng ?? null;

    // Если передали только одну координату — считаем это ошибкой (чтобы не плодить мусор)
    if ((lat === null) !== (lng === null)) {
      return reply.code(400).send({
        ok: false,
        error: "lat/lng must be both set or both null",
      });
    }

    const created = await prisma.object.create({
      data: {
        name: parsed.data.name.trim(),
        city: parsed.data.city.trim(),
        address: parsed.data.address == null ? null : parsed.data.address.trim(),

        type: type === undefined ? undefined : type,
        logoUrl: parsed.data.logoUrl === undefined ? undefined : logoUrl,

        // ✅ сохраняем lat/lng (если есть)
        lat: lat === null ? null : lat,
        lng: lng === null ? null : lng,

        photos:
          Array.isArray(photos) && photos.length > 0
            ? {
                create: photos.map((u, idx) => ({
                  url: String(u).trim(),
                  position: idx,
                })),
              }
            : undefined,
      },
      select: {
        id: true,
        name: true,
        city: true,
        address: true,
        createdAt: true,

        type: true,
        logoUrl: true,

        // ✅ lat/lng
        lat: true,
        lng: true,

        photos: {
          orderBy: { position: "asc" },
          select: { url: true, position: true },
        },
      },
    });

    return reply.code(201).send({
      ...created,
      photos: (created as any).photos.map((p: any) => p.url),
    });
  });

  /**
   * PATCH /objects/:id
   */
  app.patch("/:id", async (req, reply) => {
    // ✅ require auth for update
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const { id } = req.params as any;

    const parsed = updateObjectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: "invalid payload",
        issues: parsed.error.issues,
      });
    }

    const exists = await prisma.object.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) return reply.code(404).send({ ok: false, error: "not found" });

    const data: any = {};

    if (typeof parsed.data.name === "string") data.name = parsed.data.name.trim();
    if (typeof parsed.data.city === "string") data.city = parsed.data.city.trim();

    if ("address" in parsed.data) {
      const a = parsed.data.address;
      data.address = a == null ? null : String(a).trim();
    }

    if ("type" in parsed.data) {
      const t = normalizeOptString(parsed.data.type);
      data.type = t === undefined ? undefined : t;
    }

    if ("logoUrl" in parsed.data) {
      const l = parsed.data.logoUrl;
      data.logoUrl = l == null ? null : String(l).trim();
    }

    // ✅ lat/lng update
    const latProvided = "lat" in parsed.data;
    const lngProvided = "lng" in parsed.data;

    if (latProvided || lngProvided) {
      const lat = (parsed.data as any).lat ?? null;
      const lng = (parsed.data as any).lng ?? null;

      // если трогали координаты — должны трогать обе
      if ((lat === null) !== (lng === null)) {
        return reply.code(400).send({
          ok: false,
          error: "lat/lng must be both set or both null",
        });
      }

      // записываем (null тоже допустим — “очистить координаты”)
      if (latProvided) data.lat = lat;
      if (lngProvided) data.lng = lng;
    }

    const photosProvided = "photos" in parsed.data;

    // ВАЖНО: фото заменяем только если поле photos реально передали
    // - photos: [..] => заменить
    // - photos: null => очистить
    if (photosProvided) {
      const next = parsed.data.photos;

      // заменяем транзакционно
      await prisma.$transaction(async (tx: any) => {
        // update основных полей
        await tx.object.update({
          where: { id },
          data,
          select: { id: true },
        });

        // чистим старые
        await tx.objectPhoto.deleteMany({ where: { objectId: id } });

        // если массив — создаём новые
        if (Array.isArray(next) && next.length > 0) {
          await tx.objectPhoto.createMany({
            data: next.map((u, idx) => ({
              objectId: id,
              url: String(u).trim(),
              position: idx,
            })),
          });
        }
      });

      const updated = await prisma.object.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          city: true,
          address: true,
          createdAt: true,
          type: true,
          logoUrl: true,

          // ✅ lat/lng
          lat: true,
          lng: true,

          photos: { orderBy: { position: "asc" }, select: { url: true, position: true } },
        },
      });

      return reply.send({
        ...(updated as any),
        photos: Array.isArray((updated as any)?.photos) ? (updated as any).photos.map((p: any) => p.url) : [],
      });
    }

    // если photos не трогали — обычный update
    const updated = await prisma.object.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        city: true,
        address: true,
        createdAt: true,

        type: true,
        logoUrl: true,

        // ✅ lat/lng
        lat: true,
        lng: true,

        photos: { orderBy: { position: "asc" }, select: { url: true, position: true } },
      },
    });

    return reply.send({
      ...updated,
      photos: (updated as any).photos.map((p: any) => p.url),
    });
  });

  /**
   * DELETE /objects/:id
   *
   * Безопасно: если есть связанные записи — 409
   */
  app.delete("/:id", async (req, reply) => {
    // ✅ require auth for delete
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const { id } = req.params as any;

    const exists = await prisma.object.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) return reply.code(404).send({ ok: false, error: "not found" });

    const [slotsCount, feedbacksCount] = await Promise.all([
      prisma.slot.count({ where: { objectId: id } }),
      prisma.feedback.count({ where: { objectId: id } }),
    ]);

    if (slotsCount > 0 || feedbacksCount > 0) {
      return reply.code(409).send({
        ok: false,
        error: "object has related records",
        related: { slots: slotsCount, feedbacks: feedbacksCount },
      });
    }

    // фото удалятся каскадом (ObjectPhoto onDelete: Cascade)
    await prisma.object.delete({ where: { id } });

    return reply.send({ ok: true });
  });
}
