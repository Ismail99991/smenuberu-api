"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardRoutes = dashboardRoutes;
const crypto_1 = __importDefault(require("crypto"));
/* =========================
   Helpers (как у тебя в проекте)
   ========================= */
function cookieName() {
    return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}
function sha256Hex(s) {
    return crypto_1.default.createHash("sha256").update(s).digest("hex");
}
/**
 * Достаём userId из cookie-сессии
 */
async function getUserIdFromSession(app, req) {
    const sessionToken = req.cookies?.[cookieName()] ?? "";
    if (!sessionToken)
        return null;
    const tokenHash = sha256Hex(String(sessionToken));
    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;
    const now = new Date();
    const session = await prisma.session.findUnique({
        where: { tokenHash },
        select: { expiresAt: true, userId: true },
    });
    if (!session)
        return null;
    if (session.expiresAt.getTime() <= now.getTime()) {
        await prisma.session.delete({ where: { tokenHash } }).catch(() => { });
        return null;
    }
    return session.userId;
}
/* =========================
   Routes
   ========================= */
async function dashboardRoutes(app) {
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
        }
        catch (err) {
            app.log.error({ err }, "dashboard/stats failed");
            return reply.code(500).send({ error: "Failed to load dashboard stats" });
        }
    });
}
//# sourceMappingURL=dashboard.js.map