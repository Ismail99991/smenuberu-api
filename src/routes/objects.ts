import type { FastifyInstance } from "fastify";
import { z } from "zod";

const urlOrEmpty = z
  .string()
  .trim()
  .min(1)
  .url();

const photosSchema = z.array(urlOrEmpty).max(3);

const createObjectSchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  address: z.string().optional().nullable(),

  // ✅ новые поля (optional)
  type: z.string().min(1).optional().nullable(),
  logoUrl: urlOrEmpty.optional().nullable(),
  photos: photosSchema.optional().nullable(),
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

    const created = await prisma.object.create({
      data: {
        name: parsed.data.name.trim(),
        city: parsed.data.city.trim(),
        address: parsed.data.address == null ? null : parsed.data.address.trim(),

        type: type === undefined ? undefined : type,
        logoUrl: parsed.data.logoUrl === undefined ? undefined : logoUrl,

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
