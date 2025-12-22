// routes/bookings.ts
import { FastifyPluginAsync, type FastifyInstance } from "fastify";
import crypto from "crypto";
import { z } from "zod";

// ---- session utils (same logic as /auth/me) ----
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

function unauthorized(reply: any) {
  return reply.code(401).send({ ok: false, error: "Unauthorized" });
}

// ---- routes ----
export const bookingsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /bookings/state
   * Возвращает map slotId -> status для текущего пользователя
   */
  app.get("/state", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return unauthorized(reply);

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const list = await prisma.booking.findMany({
      where: { userId },
      select: { slotId: true, status: true },
    });

    const out: Record<string, string> = {};
    for (const b of list) out[b.slotId] = b.status;

    return reply.send({ ok: true, state: out });
  });

  /**
   * POST /bookings
   * Body: { slotId }
   * Создаёт booking для текущего пользователя (userId берём из cookie-сессии)
   */
  app.post("/", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return unauthorized(reply);

    const body = z.object({ slotId: z.string() }).parse(req.body);

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const slot = await prisma.slot.findUnique({
      where: { id: body.slotId },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        startsAt: true,
        endsAt: true,
      },
    });

    if (!slot) {
      return reply.code(404).send({ ok: false, error: "Slot not found" });
    }

    // Проверка конфликта по времени (поддерживаем обе схемы: date/startTime/endTime или startsAt/endsAt)
    const overlap = await prisma.booking.findFirst({
      where: {
        userId,
        status: "booked",
        slot: slot.startsAt && slot.endsAt
          ? {
              // datetime variant
              startsAt: { lt: slot.endsAt },
              endsAt: { gt: slot.startsAt },
            }
          : {
              // date + time variant
              date: slot.date,
              startTime: { lt: slot.endTime },
              endTime: { gt: slot.startTime },
            },
      },
      select: { id: true },
    });

    if (overlap) {
      return reply.code(409).send({ ok: false, error: "Time conflict" });
    }

    const booking = await prisma.booking.create({
      data: {
        userId,
        slotId: body.slotId,
        status: "booked",
      },
      include: { slot: { include: { object: true } } },
    });

    return reply.send({ ok: true, booking });
  });

  /**
   * POST /bookings/cancel
   * Body: { slotId }
   * Отменяет активную booking текущего пользователя
   */
  app.post("/cancel", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return unauthorized(reply);

    const body = z.object({ slotId: z.string() }).parse(req.body);

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const booking = await prisma.booking.findFirst({
      where: {
        userId,
        slotId: body.slotId,
        status: "booked",
      },
      select: { id: true },
    });

    if (!booking) {
      return reply.code(404).send({ ok: false, error: "Active booking not found" });
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "cancelled" },
      include: { slot: { include: { object: true } } },
    });

    return reply.send({ ok: true, booking: updated });
  });

  /**
   * GET /bookings?status=booked|cancelled|...
   * (оставлено для совместимости; возвращает брони ТЕКУЩЕГО пользователя)
   */
  app.get("/", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return unauthorized(reply);

    const { status } = z.object({ status: z.string().optional() }).parse(req.query);

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const bookings = await prisma.booking.findMany({
      where: {
        userId,
        ...(status ? { status } : {}),
      },
      include: { slot: { include: { object: true } } },
      orderBy: { createdAt: "desc" },
    });

    return reply.send({ ok: true, bookings });
  });
};
