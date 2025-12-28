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

/**
 * Расстояние между координатами (метры)
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

    const list = await prisma.slot.findMany({
      include: { object: true },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    return {
      ok: true,
      slots: list.map((s: any) => ({
        id: s.id,
        objectId: s.objectId,
        title: s.title,
        date: fmtISODateUTC(s.date),
        startTime: fmtTimeUTC(s.startTime),
        endTime: fmtTimeUTC(s.endTime),
        city: s.object?.city ?? "",
        address: s.object?.address ?? "",
        time: `${fmtTimeUTC(s.startTime)}–${fmtTimeUTC(s.endTime)}`,
        pay: s.pay,
        hot: s.hot,
        type: s.type,
      })),
    };
  });

  /**
   * ✅ НОВОЕ: GET /slots/created
   * Слоты, созданные текущим пользователем (заказчик/старший смены).
   * Нужно для client-приложения: страница управления сменами.
   */
  app.get("/created", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const list = await prisma.slot.findMany({
      where: { createdById: userId },
      orderBy: [{ date: "desc" }, { startTime: "desc" }],
      select: {
        id: true,
        title: true,
        date: true,
        startTime: true,
        endTime: true,
        pay: true,
        hot: true,
        type: true,
        object: {
          select: {
            id: true,
            name: true,
            city: true,
            address: true,
            lat: true,
            lng: true,
          },
        },
        bookings: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            createdAt: true,

            // ФАКТ (реальное время прихода/ухода исполнителя)
            startsAt: true,
            endsAt: true,

            // подтверждения
            startConfirmedAt: true,
            startConfirmedById: true,
            endConfirmedAt: true,
            endConfirmedById: true,

            user: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    return reply.send({
      ok: true,
      slots: list.map((s: any) => ({
        id: s.id,
        title: s.title,
        date: s.date,
        startTime: s.startTime, // ПЛАН
        endTime: s.endTime,     // ПЛАН
        pay: s.pay,
        hot: s.hot,
        type: s.type,
        object: s.object,
        bookings: s.bookings,
      })),
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
        error: "Missing fields: objectId,title,date,startTime,endTime,pay,type",
      });
    }

    // ✅ важно: createdById (кто создал смену)
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const [y, m, d] = dateStr.split("-").map((x) => Number(x));
    const [sh, sm] = startStr.split(":").map((x) => Number(x));
    const [eh, em] = endStr.split(":").map((x) => Number(x));

    if (![y, m, d, sh, sm, eh, em].every((n) => Number.isFinite(n))) {
      return reply.code(400).send({ ok: false, error: "Bad date/time format" });
    }

    const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const startTime = new Date(Date.UTC(y, m - 1, d, sh, sm, 0));
    const endTime = new Date(Date.UTC(y, m - 1, d, eh, em, 0));

    const slot = await prisma.slot.create({
      data: {
        objectId,
        title,
        date,
        startTime,
        endTime,
        pay: Math.round(payNum),
        type,
        hot,
        createdById: userId,
      },
    });

    return reply.send({ ok: true, slot });
  });

  /**
   * POST /slots/:id/start
   * Исполнитель “пришёл на смену” → отправляет lat/lng и просит чек-ин.
   * (QR покажет параллельно, а подтверждение будет у старшего через /bookings/confirm-start)
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

    // Временное окно: не раньше чем за 15 минут до планового старта
    const now = new Date();
    const startWindow = new Date(slot.startTime.getTime() - 15 * 60 * 1000);
    if (now.getTime() < startWindow.getTime()) {
      return reply.code(400).send({ ok: false, error: "too early" });
    }

    // Геопроверка (200м) — по координатам объекта
    const oLat = slot.object?.lat ?? null;
    const oLng = slot.object?.lng ?? null;
    if (Number.isFinite(oLat) && Number.isFinite(oLng)) {
      const distM = haversineMeters(lat, lng, oLat, oLng);
      if (distM > 200) {
        return reply.code(400).send({ ok: false, error: "too far from object", distanceM: Math.round(distM) });
      }
    }

    // ✅ сохраняем геопинг исполнителя (для последующего подтверждения QR-сканом)
    await prisma.userGeoPing.create({
      data: { userId, lat, lng },
    });

    // Переводим бронь в checkin_requested (как у тебя было)
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "checkin_requested" },
    });

    return reply.send({ ok: true });
  });
}
