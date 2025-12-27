import type { FastifyInstance } from "fastify";
import crypto from "crypto";

/**
 * ВСПОМОГАТЕЛЬНОЕ: форматирование/парсинг даты-времени
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

/**
 * ✅ GEO: расстояние между двумя координатами (метры)
 */
function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2);

  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * ✅ AUTH utils (скопировано по стилю из objects.ts)
 */
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
      include: { object: true },
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
      type: s.type,
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
      include: { object: true },
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
      type: s.type,
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
      include: { object: true },
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
      type: s.type,
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
          hot: false,
        },
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
      select: { id: true },
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
        hot,
      },
    });

    return reply.code(201).send(created);
  });

  /**
   * ✅ MVP: "Начать смену"
   * POST /slots/:id/start
   *
   * Текущая минимальная логика:
   * - пользователь должен быть авторизован
   * - слот должен быть забронирован им (booking.status === "booked")
   * - если у объекта есть lat/lng: проверяем дистанцию <= 120м
   * - не раньше чем за 15 минут до startTime
   * - переводим booking.status => "checkin_requested"
   *
   * ВАЖНО: это "первый шаг". Дальше добавим confirm-start от owner.
   */
  app.post("/:id/start", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const { id: slotId } = req.params as any;
    const body = req.body as any;

    const lat = Number(body?.lat);
    const lng = Number(body?.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return reply.code(400).send({ ok: false, error: "lat/lng required" });
    }

    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      include: { object: true, bookings: true },
    });

    if (!slot) return reply.code(404).send({ ok: false, error: "slot not found" });

    // Ищем бронь текущего юзера со статусом booked
    const booking = (slot.bookings ?? []).find((b: any) => b.userId === userId && b.status === "booked");
    if (!booking) return reply.code(403).send({ ok: false, error: "not your booked slot" });

    // Проверка времени: не раньше чем за 15 минут до старта
    const now = new Date();
    const earliest = new Date(slot.startTime.getTime() - 15 * 60000);
    if (now.getTime() < earliest.getTime()) {
      return reply.code(400).send({ ok: false, error: "too early" });
    }

    // Проверка гео: если у объекта есть координаты
    const oLat = slot.object?.lat;
    const oLng = slot.object?.lng;
    if (oLat != null && oLng != null) {
      const distM = haversineMeters(lat, lng, oLat, oLng);
      if (distM > 120) {
        return reply.code(400).send({ ok: false, error: "too far from object", distanceM: Math.round(distM) });
      }
    }

    // Переводим бронь в checkin_requested
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "checkin_requested" },
    });

    return reply.send({ ok: true });
  });
}
