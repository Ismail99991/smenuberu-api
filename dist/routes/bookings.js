"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingsRoutes = void 0;
const zod_1 = require("zod");
const prisma_1 = require("../prisma");
const bookingsRoutes = async (app) => {
    // GET /bookings/state?userId=...
    app.get("/state", async (req) => {
        const { userId } = zod_1.z
            .object({ userId: zod_1.z.string() })
            .parse(req.query);
        const list = await prisma_1.prisma.booking.findMany({
            where: { userId },
            select: { slotId: true, status: true },
        });
        const out = {};
        for (const b of list)
            out[b.slotId] = b.status;
        return out;
    });
    // POST /bookings
    app.post("/", async (req, reply) => {
        const body = zod_1.z
            .object({
            userId: zod_1.z.string(),
            slotId: zod_1.z.string(),
        })
            .parse(req.body);
        const slot = await prisma_1.prisma.slot.findUnique({
            where: { id: body.slotId },
        });
        if (!slot) {
            return reply.code(404).send({ error: "Slot not found" });
        }
        const overlap = await prisma_1.prisma.booking.findFirst({
            where: {
                userId: body.userId,
                status: "booked",
                slot: {
                    date: slot.date,
                    startTime: { lt: slot.endTime },
                    endTime: { gt: slot.startTime },
                },
            },
        });
        if (overlap) {
            return reply.code(409).send({ error: "Time conflict" });
        }
        const booking = await prisma_1.prisma.booking.create({
            data: {
                userId: body.userId,
                slotId: body.slotId,
                status: "booked",
            },
        });
        return booking;
    });
    // POST /bookings/cancel
    app.post("/cancel", async (req, reply) => {
        const body = zod_1.z
            .object({
            userId: zod_1.z.string(),
            slotId: zod_1.z.string(),
        })
            .parse(req.body);
        const booking = await prisma_1.prisma.booking.findFirst({
            where: {
                userId: body.userId,
                slotId: body.slotId,
                status: "booked",
            },
            select: { id: true },
        });
        if (!booking) {
            return reply.code(404).send({ error: "Active booking not found" });
        }
        const updated = await prisma_1.prisma.booking.update({
            where: { id: booking.id },
            data: { status: "cancelled" },
        });
        return updated;
    });
    // GET /bookings?userId=...
    app.get("/", async (req) => {
        const { userId } = zod_1.z
            .object({ userId: zod_1.z.string() })
            .parse(req.query);
        return prisma_1.prisma.booking.findMany({
            where: { userId },
            include: { slot: { include: { object: true } } },
            orderBy: { createdAt: "desc" },
        });
    });
};
exports.bookingsRoutes = bookingsRoutes;
