import type { FastifyInstance } from "fastify";
import crypto from "crypto";

/* =========================
   Helpers (как у тебя в проекте)
   ========================= */

function cookieName() {
  return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * Достаём userId из cookie-сессии
 */
async function getUserIdFromSession(
  app: FastifyInstance,
  req: any
): Promise<string | null> {
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

/* =========================
   Routes
   ========================= */

export async function dashboardRoutes(app: FastifyInstance) {
  /**
   * GET /dashboard/stats
   * -> { objects, activeShifts, applications }
   */
  app.get("/dashboard/stats", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    try {
      const [objects, activeShifts, applications] = await Promise.all([
        prisma.object.count({
          where: {
            ownerId: userId,
          },
        }),

        prisma.shift.count({
          where: {
            ownerId: userId,
            status: "active", // ⚠️ если у тебя другое имя статуса — поменяй
          },
        }),

        prisma.application.count({
          where: {
            ownerId: userId,
          },
        }),
      ]);

      return {
        objects,
        activeShifts,
        applications,
      };
    } catch (err) {
      app.log.error({ err }, "dashboard/stats failed");
      return reply.code(500).send({ error: "Failed to load dashboard stats" });
    }
  });
}
