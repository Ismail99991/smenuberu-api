import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { prisma } from "./prisma";
import { bookingsMeRoutes } from "./routes/bookings-me";
import { slotsRoutes } from "./routes/slots";
import { bookingsRoutes } from "./routes/bookings";
import { objectsRoutes } from "./routes/objects";
import { authRoutes } from "./routes/auth";

export function buildApp() {
  const app = Fastify({
    logger: true
  });

  app.decorate("prisma", prisma);

  app.register(cookie);

  // ✅ CORS для smenube.ru + куки
  app.register(cors, {
    origin: (origin, cb) => {
      const allowlist = [
        "https://smenube.ru",
        "http://localhost:3000",
        "https://www.smenube.ru",
      ];

      // запросы без Origin (curl/postman/server-to-server) — разрешаем
      if (!origin) return cb(null, true);

      if (allowlist.includes(origin)) return cb(null, true);

      return cb(new Error("Not allowed by CORS"), false);
    },
    credentials: true
  });

  app.get("/health", async () => {
    return {
      ok: true,
      commit: process.env.RENDER_GIT_COMMIT ?? null,
      serviceId: process.env.RENDER_SERVICE_ID ?? null,
      node: process.version
    };
  });

  app.register(authRoutes, { prefix: "/auth" });

  app.register(objectsRoutes, { prefix: "/objects" });
  app.register(slotsRoutes, { prefix: "/slots" });
  app.register(bookingsRoutes, { prefix: "/bookings" });
  app.register(bookingsMeRoutes, { prefix: "/bookings" });

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}

async function start() {
  const app = buildApp();

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
