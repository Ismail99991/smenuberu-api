import type { FastifyInstance } from "fastify";

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
  return { y: +m[1], mo: +m[2], d: +m[3] };
}

function parseTimeHHMM(t: string) {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const hh = +m[1];
  const mm = +m[2];
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function toUtcDateTime(date: string, hhmm: string): Date | null {
  const d = parseISODate(date);
  const t = parseTimeHHMM(hhmm);
  if (!d || !t) return null;
  return new Date(Date.UTC(d.y, d.mo - 1, d.d, t.hh, t.mm, 0));
}

export async function slotsRoutes(app: FastifyInstance) {
  /**
   * GET /slots
   * (prefix /slots) + (path "/") = "/slots"
   */
  app.get("/", async () => {
    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const rows = await prisma.slot.findMany({
      orderBy: [{ date: "desc" }, { startTime: "asc" }],
      include: { object: true }
    });

    return rows.map((s: any) => ({
      id: s.id,
      date: fmtISODateUTC(s.date),
      title: s.title,
      company: s.object?.name ?? "",
      city: s.object?.city ?? "",
      address: s.object?.address ?? "",
      time: `${fmtTimeUTC(s.startTime)}–${fmtTimeUTC(s.endTime)}`,
      pay: s.pay,
      hot: s.hot,
      type: s.type
    }));
  });

  /**
   * GET /slots/ui
   */
  app.get("/ui", async () => {
    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const rows = await prisma.slot.findMany({
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      include: { object: true }
    });

    return rows.map((s: any) => ({
      id: s.id,
      date: fmtISODateUTC(s.date),
      title: s.title,
      company: s.object?.name ?? "",
      city: s.object?.city ?? "",
      address: s.object?.address ?? "",
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
    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const { id } = req.params as any;

    const s = await prisma.slot.findUnique({
      where: { id },
      include: { object: true }
    });

    if (!s) return reply.code(404).send({ ok: false, error: "not found" });

    return reply.send({
      id: s.id,
      date: fmtISODateUTC(s.date),
      title: s.title,
      company: s.object?.name ?? "",
      city: s.object?.city ?? "",
      address: s.object?.address ?? "",
      time: `${fmtTimeUTC(s.startTime)}–${fmtTimeUTC(s.endTime)}`,
      pay: s.pay,
      hot: s.hot,
      type: s.type
    });
  });

  /**
   * POST /slots   ✅ ВОТ ОН
   * (prefix /slots) + (path "/") = "/slots"
   */
  app.post("/", async (req, reply) => {
    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const body = req.body as any;

    const objectId = String(body?.objectId ?? "");
    const title = String(body?.title ?? "");
    const dateStr = String(body?.date ?? ""); // YYYY-MM-DD
    const startStr = String(body?.startTime ?? ""); // HH:MM
    const endStr = String(body?.endTime ?? ""); // HH:MM
    const payNum = Number(body?.pay ?? NaN);
    const type = body?.type;
    const hot = Boolean(body?.hot ?? false);

    if (!objectId || !title || !dateStr || !startStr || !endStr || !Number.isFinite(payNum) || !type) {
      return reply.code(400).send({
        ok: false,
        error: "invalid payload",
        example: {
          objectId: "Object.id",
          title: "string",
          date: "YYYY-MM-DD",
          startTime: "HH:MM",
          endTime: "HH:MM",
          pay: 3500,
          type: "loader",
          hot: false
        }
      });
    }

    const date = toUtcDateTime(dateStr, "00:00");
    const startTime = toUtcDateTime(dateStr, startStr);
    const endTime = toUtcDateTime(dateStr, endStr);

    if (!date || !startTime || !endTime) {
      return reply.code(400).send({ ok: false, error: "invalid date/startTime/endTime" });
    }

    if (endTime.getTime() <= startTime.getTime()) {
      return reply.code(400).send({ ok: false, error: "endTime must be after startTime" });
    }

    const obj = await prisma.object.findUnique({
      where: { id: objectId },
      select: { id: true }
    });

    if (!obj) return reply.code(400).send({ ok: false, error: "object not found" });

    const created = await prisma.slot.create({
      data: {
        objectId,
        title,
        date,
        startTime,
        endTime,
        pay: Math.round(payNum),
        type,
        hot
      }
    });

    return reply.code(201).send(created);
  });
}
