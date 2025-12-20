import type { FastifyInstance } from "fastify";

/**
 * Helpers
 */
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function fmtISODateUTC(dt: Date) {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function fmtTimeUTC(dt: Date) {
  return `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`;
}

function parseISODate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function parseTimeHHMM(t: string) {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return { h: +m[1], m: +m[2] };
}

function toUtcDateTime(date: string, time: string) {
  const d = parseISODate(date);
  const t = parseTimeHHMM(time);
  if (!d || !t) return null;
  return new Date(Date.UTC(d.y, d.m - 1, d.d, t.h, t.m, 0));
}

export async function slotsRoutes(app: FastifyInstance) {
  /**
   * GET /slots
   * (админка)
   */
  app.get("/", async () => {
    // @ts-expect-error prisma is injected globally
    const prisma = app.prisma;

    const rows = await prisma.slot.findMany({
      orderBy: [{ date: "desc" }, { startTime: "asc" }],
      include: { object: true }
    });

    return rows.map((s: any) => ({
      id: s.id,
      date: fmtISODateUTC(s.date),
      title: s.title,
      company: s.object.name,
      city: s.object.city,
      address: s.object.address,
      time: `${fmtTimeUTC(s.startTime)}–${fmtTimeUTC(s.endTime)}`,
      pay: s.pay,
      hot: s.hot,
      type: s.type
    }));
  });

  /**
   * GET /slots/ui
   * (web)
   */
  app.get("/ui", async () => {
    // @ts-expect-error prisma is injected globally
    const prisma = app.prisma;

    const rows = await prisma.slot.findMany({
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      include: { object: true }
    });

    return rows.map((s: any) => ({
      id: s.id,
      date: fmtISODateUTC(s.date),
      title: s.title,
      company: s.object.name,
      city: s.object.city,
      address: s.object.address,
      time: `${fmtTimeUTC(s.startTime)}–${fmtTimeUTC(s.endTime)}`,
      pay: s.pay,
      hot: s.hot,
      tags: [],
      type: s.type
    }));
  });

  /**
   * GET /slots/:id
   */
  app.get("/:id", async (req, reply) => {
    // @ts-expect-error prisma is injected globally
    const prisma = app.prisma;
    const { id } = req.params as any;

    const s = await prisma.slot.findUnique({
      where: { id },
      include: { object: true }
    });

    if (!s) return reply.code(404).send({ ok: false });

    return {
      id: s.id,
      date: fmtISODateUTC(s.date),
      title: s.title,
      company: s.object.name,
      city: s.object.city,
      address: s.object.address,
      time: `${fmtTimeUTC(s.startTime)}–${fmtTimeUTC(s.endTime)}`,
      pay: s.pay,
      hot: s.hot,
      type: s.type
    };
  });

  /**
   * POST /slots
   * (создание смены)
   */
  app.post("/", async (req, reply) => {
    // @ts-expect-error prisma is injected globally
    const prisma = app.prisma;
    const body = req.body as any;

    const {
      objectId,
      title,
      date,
      startTime,
      endTime,
      pay,
      type,
      hot = false
    } = body;

    if (!objectId || !title || !date || !startTime || !endTime || pay == null || !type) {
      return reply.code(400).send({ error: "invalid payload" });
    }

    const dateUTC = toUtcDateTime(date, "00:00");
    const startUTC = toUtcDateTime(date, startTime);
    const endUTC = toUtcDateTime(date, endTime);

    if (!dateUTC || !startUTC || !endUTC || endUTC <= startUTC) {
      return reply.code(400).send({ error: "invalid date/time" });
    }

    const exists = await prisma.object.findUnique({
      where: { id: objectId },
      select: { id: true }
    });

    if (!exists) {
      return reply.code(400).send({ error: "object not found" });
    }

    const created = await prisma.slot.create({
      data: {
        objectId,
        title,
        date: dateUTC,
        startTime: startUTC,
        endTime: endUTC,
        pay: Number(pay),
        type,
        hot: Boolean(hot)
      }
    });

    return reply.code(201).send(created);
  });
}
