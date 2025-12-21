import type { FastifyInstance } from "fastify";
import { z } from "zod";

const createObjectSchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  address: z.string().optional().nullable()
});

const updateObjectSchema = z.object({
  name: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  address: z.string().optional().nullable()
});

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
        createdAt: true
      }
    });

    return rows;
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
        createdAt: true
      }
    });

    if (!obj) return reply.code(404).send({ ok: false, error: "not found" });

    return obj;
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
        issues: parsed.error.issues
      });
    }

    const created = await prisma.object.create({
      data: {
        name: parsed.data.name.trim(),
        city: parsed.data.city.trim(),
        address: parsed.data.address == null ? null : parsed.data.address.trim()
      },
      select: {
        id: true,
        name: true,
        city: true,
        address: true,
        createdAt: true
      }
    });

    return reply.code(201).send(created);
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
        issues: parsed.error.issues
      });
    }

    const exists = await prisma.object.findUnique({
      where: { id },
      select: { id: true }
    });

    if (!exists) return reply.code(404).send({ ok: false, error: "not found" });

    const data: any = {};
    if (typeof parsed.data.name === "string") data.name = parsed.data.name.trim();
    if (typeof parsed.data.city === "string") data.city = parsed.data.city.trim();
    if ("address" in parsed.data) {
      const a = parsed.data.address;
      data.address = a == null ? null : a.trim();
    }

    const updated = await prisma.object.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        city: true,
        address: true,
        createdAt: true
      }
    });

    return reply.send(updated);
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
      select: { id: true }
    });

    if (!exists) return reply.code(404).send({ ok: false, error: "not found" });

    const [slotsCount, feedbacksCount] = await Promise.all([
      prisma.slot.count({ where: { objectId: id } }),
      prisma.feedback.count({ where: { objectId: id } })
    ]);

    if (slotsCount > 0 || feedbacksCount > 0) {
      return reply.code(409).send({
        ok: false,
        error: "object has related records",
        related: { slots: slotsCount, feedbacks: feedbacksCount }
      });
    }

    await prisma.object.delete({ where: { id } });

    return reply.send({ ok: true });
  });
}
