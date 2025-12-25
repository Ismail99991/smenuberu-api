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
import { uploadsRoutes } from "./routes/uploads";
import { geoRoutes } from "./routes/geo";
import { dashboardRoutes } from "./routes/dashboard";

function isAllowedOrigin(origin: string) {
  // allow localhost
  if (origin === "http://localhost:3000") return true;

  // allow vercel previews
  if (origin.endsWith(".vercel.app")) return true;

  // allow any smenube.ru subdomain (and root)
  try {
    const u = new URL(origin);
    const h = u.hostname;
    if (h === "smenube.ru" || h.endsWith(".smenube.ru")) return true;
  } catch {
    // ignore parse errors
  }

  // explicit allowlist (fallback)
  const allowlist = new Set([
    "https://smenube.ru",
    "https://www.smenube.ru",
    "https://client.smenube.ru",
    "https://dashboard.smenube.ru",
  ]);

  return allowlist.has(origin);
}

export function buildApp() {
  const app = Fastify({
    logger: true
  });

  app.decorate("prisma", prisma);

  app.register(cookie);

  
app.register(dashboardRoutes);

  // ✅ CORS + preflight
  app.register(cors, {
    origin: (origin, cb) => {
      // запросы без Origin (curl/postman/server-to-server) — разрешаем
      if (!origin) return cb(null, true);

      if (isAllowedOrigin(origin)) return cb(null, true);

      return cb(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    // важно для некоторых окружений/проксей
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // на всякий случай: health
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

  app.register(uploadsRoutes, { prefix: "/uploads" });
  app.register(geoRoutes, { prefix: "/geo" });

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
