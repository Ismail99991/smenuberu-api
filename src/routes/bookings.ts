import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma";

export const bookingsRoutes: FastifyPluginAsync = async (app) => {

  // GET /bookings/state?userId=...
  app.get("/state", async (req) => {
    const { userId } = z
      .object({ userId: z.string() })
      .parse(req.query);

    const list = await prisma.booking.findMany({
      where: { userId },
      select: { slotId: true, status: true },
    });

    const out: Record<string, string> = {};
    for (const b of list) out[b.slotId] = b.status;

    return out;
  });

  // POST /bookings
  app.post("/", async (req, reply) => {
    const body = z
      .object({
        userId: z.string(),
        slotId: z.string(),
      })
      .parse(req.body);

    const slot = await prisma.slot.findUnique({
      where: { id: body.slotId },
    });

    if (!slot) {
      return reply.code(404).send({ error: "Slot not found" });
    }

    const overlap = await prisma.booking.findFirst({
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

    const booking = await prisma.booking.create({
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
    const body = z
      .object({
        userId: z.string(),
        slotId: z.string(),
      })
      .parse(req.body);

    const booking = await prisma.booking.findFirst({
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

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "cancelled" },
    });

    return updated;
  });

  // GET /bookings?userId=...
  app.get("/", async (req) => {
    const { userId } = z
      .object({ userId: z.string() })
      .parse(req.query);

    return prisma.booking.findMany({
      where: { userId },
      include: { slot: { include: { object: true } } },
      orderBy: { createdAt: "desc" },
    });
  });

};
