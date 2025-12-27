// routes/bookings-me.ts
import type { FastifyInstance } from "fastify";
import crypto from "crypto";
import { z } from "zod";

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
  return reply.code(401).send({ ok: false, error: "Unauthorized", bookings: [] });
}

export async function bookingsMeRoutes(app: FastifyInstance) {
  /**
   * GET /bookings/me?status=booked|cancelled|...
   * По умолчанию отдаём ТОЛЬКО "booked" (как было).
   */
  app.get("/me", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return unauthorized(reply);

    const { status } = z.object({ status: z.string().optional() }).parse(req.query);

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const bookings = await prisma.booking.findMany({
      where: {
        userId,
        status: status ?? "booked",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,

        // ✅ ФАКТ (реальное время)
        startsAt: true,
        endsAt: true,

        // ✅ ПЛАН (расписание слота)
        slot: {
          select: {
            id: true,
            date: true,
            startTime: true,
            endTime: true,
            object: {
              select: {
                id: true,
                name: true,
                address: true,
                city: true,
                lat: true,
                lng: true,
              },
            },
          },
        },
      },
    });

    return reply.send({ ok: true, bookings });
  });
}
