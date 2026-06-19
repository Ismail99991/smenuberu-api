"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = buildApp;
const dns_1 = __importDefault(require("dns"));
dns_1.default.setDefaultResultOrder("ipv4first");
const fastify_1 = __importDefault(require("fastify"));
const cookie_1 = __importDefault(require("@fastify/cookie"));
const cors_1 = __importDefault(require("@fastify/cors"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const prisma_1 = require("./prisma");
const bookings_me_1 = require("./routes/bookings-me");
const slots_1 = require("./routes/slots");
const bookings_1 = require("./routes/bookings");
const objects_1 = require("./routes/objects");
const auth_1 = require("./routes/auth");
const uploads_1 = require("./routes/uploads");
const geo_1 = require("./routes/geo");
const dashboard_1 = require("./routes/dashboard");
function isAllowedOrigin(origin) {
    // allow localhost
    if (origin === "http://localhost:3000")
        return true;
    // allow vercel previews
    if (origin.endsWith(".vercel.app"))
        return true;
    // allow any smenube.ru subdomain (and root)
    try {
        const u = new URL(origin);
        const h = u.hostname;
        if (h === "smenube.ru" || h.endsWith(".smenube.ru"))
            return true;
    }
    catch {
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
function buildApp() {
    const app = (0, fastify_1.default)({
        logger: true
    });
    app.decorate("prisma", prisma_1.prisma);
    app.register(cookie_1.default);
    app.register(dashboard_1.dashboardRoutes);
    app.register(multipart_1.default, {
        limits: {
            fileSize: 5 * 1024 * 1024, // 5MB
        },
    });
    // ✅ CORS + preflight
    app.register(cors_1.default, {
        origin: (origin, cb) => {
            // запросы без Origin (curl/postman/server-to-server) — разрешаем
            if (!origin)
                return cb(null, true);
            if (isAllowedOrigin(origin))
                return cb(null, true);
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
    app.register(auth_1.authRoutes, { prefix: "/auth" });
    app.register(objects_1.objectsRoutes, { prefix: "/objects" });
    app.register(slots_1.slotsRoutes, { prefix: "/slots" });
    app.register(bookings_1.bookingsRoutes, { prefix: "/bookings" });
    app.register(bookings_me_1.bookingsMeRoutes, { prefix: "/bookings" });
    app.register(uploads_1.uploadsRoutes, { prefix: "/uploads" });
    app.register(geo_1.geoRoutes, { prefix: "/geo" });
    app.addHook("onClose", async () => {
        await prisma_1.prisma.$disconnect();
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
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=server.js.map