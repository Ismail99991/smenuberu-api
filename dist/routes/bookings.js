"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingsRoutes = void 0;
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
// ---- session utils (same logic as /auth/me) ----
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
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
}
function haversineMeters(aLat, aLng, bLat, bLng) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const x = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2);
    return 2 * R * Math.asin(Math.sqrt(x));
}
const PING_MAX_AGE_MS = 2 * 60 * 1000; // свежесть геопинга исполнителя
const bookingsRoutes = async (app) => {
    /**
     * GET /bookings/state
     * -> mapping slotId -> status
     */
    app.get("/state", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return unauthorized(reply);
        // @ts-expect-error prisma is decorated in server.ts
        const prisma = app.prisma;
        const list = await prisma.booking.findMany({
            where: { userId },
            select: { slotId: true, status: true },
        });
        const out = {};
        for (const b of list)
            out[b.slotId] = b.status;
        return reply.send({ ok: true, state: out });
    });
    /**
     * POST /bookings
     * Body: { slotId }
     */
    app.post("/", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return unauthorized(reply);
        const body = zod_1.z.object({ slotId: zod_1.z.string() }).parse(req.body);
        // @ts-expect-error prisma is decorated in server.ts
        const prisma = app.prisma;
        const slot = await prisma.slot.findUnique({
            where: { id: body.slotId },
            select: {
                id: true,
                date: true,
                startTime: true,
                endTime: true,
            },
        });
        if (!slot)
            return reply.code(404).send({ ok: false, error: "Slot not found" });
        const existing = await prisma.booking.findFirst({
            where: { userId, slotId: body.slotId, status: "booked" },
            select: { id: true },
        });
        if (existing)
            return reply.code(400).send({ ok: false, error: "Already booked" });
        const booking = await prisma.booking.create({
            data: {
                userId,
                slotId: body.slotId,
                status: "booked",
            },
        });
        return reply.send({ ok: true, booking });
    });
    /**
     * POST /bookings/cancel
     * Body: { slotId }
     */
    app.post("/cancel", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return unauthorized(reply);
        const body = zod_1.z.object({ slotId: zod_1.z.string() }).parse(req.body);
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
        await prisma.booking.update({
            where: { id: booking.id },
            data: { status: "cancelled" },
        });
        return reply.send({ ok: true });
    });
    /**
     * GET /bookings/list?status=...
     */
    app.get("/list", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return unauthorized(reply);
        const status = typeof req.query?.status === "string" ? String(req.query.status) : null;
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
    /**
     * ✅ НОВОЕ: POST /bookings/confirm-start
     * Старший смены сканирует QR исполнителя и подтверждает начало смены.
     * Body: { slotId, qrToken }
     */
    app.post("/confirm-start", async (req, reply) => {
        const seniorId = await getUserIdFromSession(app, req);
        if (!seniorId)
            return unauthorized(reply);
        const body = zod_1.z
            .object({
            slotId: zod_1.z.string().min(1),
            qrToken: zod_1.z.string().min(1),
        })
            .parse(req.body);
        // @ts-expect-error prisma is decorated in server.ts
        const prisma = app.prisma;
        const performer = await prisma.user.findUnique({
            where: { performerQrToken: body.qrToken },
            select: { id: true },
        });
        if (!performer)
            return reply.code(404).send({ ok: false, error: "Performer not found by qrToken" });
        const booking = await prisma.booking.findFirst({
            where: {
                slotId: body.slotId,
                userId: performer.id,
                status: { in: ["booked", "checkin_requested"] },
                startConfirmedAt: null,
            },
            select: {
                id: true,
                status: true,
                slot: {
                    select: {
                        id: true,
                        createdById: true,
                        startTime: true,
                        endTime: true,
                        object: { select: { lat: true, lng: true } },
                    },
                },
            },
        });
        if (!booking)
            return reply.code(404).send({ ok: false, error: "Booking not found" });
        if (booking.slot.createdById !== seniorId) {
            return reply.code(403).send({ ok: false, error: "Only slot creator can confirm" });
        }
        const now = new Date();
        // окно старта: не раньше чем за 15 минут до планового старта
        const startWindow = new Date(booking.slot.startTime.getTime() - 15 * 60 * 1000);
        if (now.getTime() < startWindow.getTime()) {
            return reply.code(400).send({ ok: false, error: "too early" });
        }
        // берём самый свежий геопинг исполнителя
        const ping = await prisma.userGeoPing.findFirst({
            where: {
                userId: performer.id,
                createdAt: { gte: new Date(now.getTime() - PING_MAX_AGE_MS) },
            },
            orderBy: { createdAt: "desc" },
            select: { lat: true, lng: true, createdAt: true },
        });
        if (!ping) {
            return reply.code(400).send({ ok: false, error: "no fresh geo ping from performer" });
        }
        // геопроверка 200м по координатам объекта
        const oLat = booking.slot.object?.lat ?? null;
        const oLng = booking.slot.object?.lng ?? null;
        if (Number.isFinite(oLat) && Number.isFinite(oLng)) {
            const distM = haversineMeters(ping.lat, ping.lng, oLat, oLng);
            if (distM > 200) {
                return reply.code(400).send({ ok: false, error: "too far from object", distanceM: Math.round(distM) });
            }
        }
        await prisma.booking.update({
            where: { id: booking.id },
            data: {
                status: "started",
                // факт прибытия
                startsAt: now,
                startConfirmedAt: now,
                startConfirmedById: seniorId,
                startLat: ping.lat,
                startLng: ping.lng,
            },
        });
        return reply.send({ ok: true });
    });
    /**
     * ✅ НОВОЕ: POST /bookings/confirm-end
     * Подтверждение окончания смены (по твоему окну до 4 часов после планового endTime).
     * Body: { slotId, qrToken }
     */
    app.post("/confirm-end", async (req, reply) => {
        const seniorId = await getUserIdFromSession(app, req);
        if (!seniorId)
            return unauthorized(reply);
        const body = zod_1.z
            .object({
            slotId: zod_1.z.string().min(1),
            qrToken: zod_1.z.string().min(1),
        })
            .parse(req.body);
        // @ts-expect-error prisma is decorated in server.ts
        const prisma = app.prisma;
        const performer = await prisma.user.findUnique({
            where: { performerQrToken: body.qrToken },
            select: { id: true },
        });
        if (!performer)
            return reply.code(404).send({ ok: false, error: "Performer not found by qrToken" });
        const booking = await prisma.booking.findFirst({
            where: {
                slotId: body.slotId,
                userId: performer.id,
                status: { in: ["started", "booked", "checkin_requested"] },
                endConfirmedAt: null,
            },
            select: {
                id: true,
                slot: {
                    select: {
                        id: true,
                        createdById: true,
                        endTime: true,
                        object: { select: { lat: true, lng: true } },
                    },
                },
            },
        });
        if (!booking)
            return reply.code(404).send({ ok: false, error: "Booking not found" });
        if (booking.slot.createdById !== seniorId) {
            return reply.code(403).send({ ok: false, error: "Only slot creator can confirm" });
        }
        const now = new Date();
        // окно окончания: до 4 часов после планового конца смены
        const endDeadline = new Date(booking.slot.endTime.getTime() + 4 * 60 * 60 * 1000);
        if (now.getTime() > endDeadline.getTime()) {
            return reply.code(400).send({ ok: false, error: "too late to confirm end" });
        }
        // свежий геопинг исполнителя
        const ping = await prisma.userGeoPing.findFirst({
            where: {
                userId: performer.id,
                createdAt: { gte: new Date(now.getTime() - PING_MAX_AGE_MS) },
            },
            orderBy: { createdAt: "desc" },
            select: { lat: true, lng: true, createdAt: true },
        });
        if (!ping) {
            return reply.code(400).send({ ok: false, error: "no fresh geo ping from performer" });
        }
        // геопроверка 200м
        const oLat = booking.slot.object?.lat ?? null;
        const oLng = booking.slot.object?.lng ?? null;
        if (Number.isFinite(oLat) && Number.isFinite(oLng)) {
            const distM = haversineMeters(ping.lat, ping.lng, oLat, oLng);
            if (distM > 200) {
                return reply.code(400).send({ ok: false, error: "too far from object", distanceM: Math.round(distM) });
            }
        }
        await prisma.booking.update({
            where: { id: booking.id },
            data: {
                status: "ended",
                // факт убытия
                endsAt: now,
                endConfirmedAt: now,
                endConfirmedById: seniorId,
                endLat: ping.lat,
                endLng: ping.lng,
            },
        });
        return reply.send({ ok: true });
    });
};
exports.bookingsRoutes = bookingsRoutes;
//# sourceMappingURL=bookings.js.map