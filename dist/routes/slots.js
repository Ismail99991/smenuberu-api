"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slotsRoutes = void 0;
const zod_1 = require("zod");
const prisma_1 = require("../prisma");
const slotsRoutes = async (app) => {
    app.get("/", async (req) => {
        const query = zod_1.z
            .object({
            from: zod_1.z.string().optional(),
            to: zod_1.z.string().optional(),
        })
            .parse(req.query);
        const from = query.from ? new Date(query.from) : undefined;
        const to = query.to ? new Date(query.to) : undefined;
        const slots = await prisma_1.prisma.slot.findMany({
            where: from && to ? { date: { gte: from, lte: to } } : undefined,
            include: { object: true },
            orderBy: [{ date: "asc" }, { startTime: "asc" }],
        });
        return slots;
    });
    app.get("/ui", async (req) => {
        const query = zod_1.z
            .object({
            from: zod_1.z.string().optional(), // YYYY-MM-DD or ISO
            to: zod_1.z.string().optional(),
        })
            .parse(req.query);
        const from = query.from ? new Date(query.from) : undefined;
        const to = query.to ? new Date(query.to) : undefined;
        const rows = await prisma_1.prisma.slot.findMany({
            where: from && to ? { date: { gte: from, lte: to } } : undefined,
            include: { object: true },
            orderBy: [{ date: "asc" }, { startTime: "asc" }],
        });
        const pad2 = (n) => String(n).padStart(2, "0");
        const toISODate = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
        const toHHMM = (d) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
        return rows.map((s) => ({
            id: s.id,
            date: toISODate(s.date),
            title: s.title,
            company: s.object.name,
            city: s.object.city,
            address: s.object.address ?? "",
            time: `${toHHMM(s.startTime)}–${toHHMM(s.endTime)}`,
            pay: s.pay,
            hot: s.hot,
            tags: [],
            type: s.type,
        }));
    });
    app.get("/:id", async (req, reply) => {
        const { id } = zod_1.z.object({ id: zod_1.z.string() }).parse(req.params);
        const slot = await prisma_1.prisma.slot.findUnique({
            where: { id },
            include: { object: true },
        });
        if (!slot)
            return reply.code(404).send({ error: "Slot not found" });
        return slot;
    });
};
exports.slotsRoutes = slotsRoutes;
