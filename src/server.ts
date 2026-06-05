import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import { prisma } from "./prisma";

import { bookingsMeRoutes } from "./routes/bookings-me";
import { slotsRoutes } from "./routes/slots";
import { bookingsRoutes } from "./routes/bookings";
import { objectsRoutes } from "./routes/objects";
import { authRoutes } from "./routes/auth";
import { uploadsRoutes } from "./routes/uploads";
import { geoRoutes } from "./routes/geo";
import { dashboardRoutes } from "./routes/dashboard";
import checkNpdRoute from "./routes/check-npd"; // ✅ добавлено

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
  
  app.register(fastifyMultipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
    },
  });

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

  // ============================================
  // 📊 МОНИТОРИНГ РЕСУРСОВ
  // ============================================
  // Добавляем эндпоинт для получения метрик
  app.get("/metrics", async () => {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const uptime = process.uptime();
    
    return {
      timestamp: new Date().toISOString(),
      memory: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
      },
      cpu: {
        userMs: Math.round(cpu.user / 1000),
        systemMs: Math.round(cpu.system / 1000),
      },
      uptimeMin: Math.round(uptime / 60),
      nodeVersion: process.version,
      platform: process.platform,
    };
  });

  // Логирование в консоль каждые 30 секунд (только в development или всегда)
  let isMonitoringEnabled = process.env.NODE_ENV !== "production" || process.env.ENABLE_MONITORING === "true";
  
  if (isMonitoringEnabled) {
    const intervalId = setInterval(() => {
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage();
      const uptime = process.uptime();
      
      app.log.info({
        type: "resource_monitor",
        memory: {
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
          rssMB: Math.round(mem.rss / 1024 / 1024),
        },
        cpu: {
          userMs: Math.round(cpu.user / 1000),
          systemMs: Math.round(cpu.system / 1000),
        },
        uptimeMin: Math.round(uptime / 60),
      }, "📊 Resource usage");
    }, 30000); // Каждые 30 секунд
    
    // Очищаем интервал при закрытии приложения
    app.addHook("onClose", async () => {
      clearInterval(intervalId);
    });
  }

  app.register(authRoutes, { prefix: "/auth" });
  app.register(objectsRoutes, { prefix: "/objects" });
  app.register(slotsRoutes, { prefix: "/slots" });
  app.register(bookingsRoutes, { prefix: "/bookings" });
  app.register(bookingsMeRoutes, { prefix: "/bookings" });
  app.register(uploadsRoutes, { prefix: "/uploads" });
  app.register(geoRoutes, { prefix: "/geo" });
  app.register(checkNpdRoute); // ✅ добавлено

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
    app.log.info(`🚀 Server running on ${host}:${port}`);
    app.log.info(`📊 Metrics available at GET /metrics`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
