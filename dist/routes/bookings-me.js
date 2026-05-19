"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingsMeRoutes = bookingsMeRoutes;
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
function cookieName() {
    return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}
function sha256Hex(s) {
    return crypto_1.default.createHash("sha256").update(s).digest("hex");
}
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
function unauthorized(reply) {
    return reply.code(401).send({ ok: false, error: "Unauthorized", bookings: [] });
}
async function bookingsMeRoutes(app) {
    /**
     * GET /bookings/me?status=booked|cancelled|...
     * По умолчанию отдаём ТОЛЬКО "booked" (как было).
     */
    app.get("/me", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return unauthorized(reply);
        const { status } = zod_1.z.object({ status: zod_1.z.string().optional() }).parse(req.query);
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
//# sourceMappingURL=bookings-me.js.map