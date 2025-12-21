"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = buildApp;
const fastify_1 = __importDefault(require("fastify"));
const prisma_1 = require("./prisma");
const slots_1 = require("./routes/slots");
const bookings_1 = require("./routes/bookings");
function buildApp() {
    const app = (0, fastify_1.default)({
        logger: true
    });
    app.decorate("prisma", prisma_1.prisma);
    app.get("/health", async () => {
        return { ok: true };
    });
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