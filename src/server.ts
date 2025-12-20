import Fastify from "fastify";
import cors from "@fastify/cors";
import type { PrismaClient } from "@prisma/client";

import { prisma } from "./prisma";
import { slotsRoutes } from "./routes/slots";
import { bookingsRoutes } from "./routes/bookings";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const app = Fastify({ logger: true });

async function main() {
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // ✅ ключевая строка
  app.decorate("prisma", prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  await app.register(slotsRoutes, { prefix: "/slots" });
  await app.register(bookingsRoutes, { prefix: "/bookings" });

  app.get("/health", async () => ({ ok: true }));

  const port = Number(process.env.PORT || 3001);
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
