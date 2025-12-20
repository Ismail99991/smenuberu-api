import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma";

export const slotsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    const query = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    const slots = await prisma.slot.findMany({
      where: from && to ? { date: { gte: from, lte: to } } : undefined,
      include: { object: true },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    return slots;
  });

  app.get("/ui", async (req) => {
  const query = z
    .object({
      from: z.string().optional(), // YYYY-MM-DD or ISO
      to: z.string().optional(),
    })
    .parse(req.query);

  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;

  const rows = await prisma.slot.findMany({
    where: from && to ? { date: { gte: from, lte: to } } : undefined,
    include: { object: true },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toISODate = (d: Date) =>
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

  const toHHMM = (d: Date) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;

  return rows.map((s) => ({
    id: s.id,
    date: toISODate(s.date),
    title: s.title,
    company: s.object.name,
    city: s.object.city,
    address: s.object.address ?? "",
    time: `${toHHMM(s.startTime)}–${toHHMM(s.endTime)}`,
    pay: s.pay,
    hot: s.hot,
    tags: [] as string[],
    type: s.type,
  }));
});

  app.get("/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);

    const slot = await prisma.slot.findUnique({
      where: { id },
      include: { object: true },
    });

    if (!slot) return reply.code(404).send({ error: "Slot not found" });
    return slot;
  });
};
