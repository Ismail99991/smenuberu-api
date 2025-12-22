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
const prisma_1 = require("./prisma");
const slots_1 = require("./routes/slots");
const bookings_1 = require("./routes/bookings");
const objects_1 = require("./routes/objects");
const auth_1 = require("./routes/auth");
function buildApp() {
    const app = (0, fastify_1.default)({
        logger: true
    });
    app.decorate("prisma", prisma_1.prisma);
    app.register(cookie_1.default);
    // ✅ CORS для smenube.ru + куки
    app.register(cors_1.default, {
        origin: (origin, cb) => {
            const allowlist = [
                "https://smenube.ru",
                "http://localhost:3000",
                "https://www.smenube.ru",
            ];
            // запросы без Origin (curl/postman/server-to-server) — разрешаем
            if (!origin)
                return cb(null, true);
            if (allowlist.includes(origin))
                return cb(null, true);
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
    app.register(auth_1.authRoutes, { prefix: "/auth" });
    app.register(objects_1.objectsRoutes, { prefix: "/objects" });
    app.register(slots_1.slotsRoutes, { prefix: "/slots" });
    app.register(bookings_1.bookingsRoutes, { prefix: "/bookings" });
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
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=server.js.map