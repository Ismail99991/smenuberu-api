import type { FastifyInstance } from "fastify";
import crypto from "crypto";

function cookieName() {
  return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * Достаём userId из текущей cookie-сессии (как в /auth/me),
 * без дублирования бизнес-логики на фронте.
 */
async function getUserIdFromSession(app: FastifyInstance, req: any): Promise<string | null> {
  const sessionToken = (req.cookies as any)?.[cookieName()] ?? "";
  if (!sessionToken) return null;

  const tokenHash = sha256Hex(String(sessionToken));

  // @ts-expect-error prisma is decorated in server.ts
  const prisma = app.prisma;

  const now = new Date();

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: {
      expiresAt: true,
      userId: true,
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= now.getTime()) {
    await prisma.session.delete({ where: { tokenHash } }).catch(() => {});
    return null;
  }

  return session.userId;
}

export async function bookingsMeRoutes(app: FastifyInstance) {
  /**
   * GET /bookings/me
   * Возвращает брони текущего пользователя
   */
  app.get("/me", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(200).send({ ok: true, bookings: [] });

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    /**
     * ⚠️ Важно:
     * Я не знаю точную Prisma-модель bookings/slots у тебя в схеме,
     * поэтому использую максимально типичный вариант:
     * booking.userId -> slot -> object
     *
     * Если названия полей отличаются — скажи, и я подгоню под твою схему.
     */
    const bookings = await prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,

        slot: {
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            object: {
              select: {
                id: true,
                name: true,
                address: true,
              },
            },
          },
        },
      },
    });

    return reply.send({ ok: true, bookings });
  });
}
