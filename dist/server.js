"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const slots_1 = require("./routes/slots");
const bookings_1 = require("./routes/bookings");
const app = (0, fastify_1.default)({ logger: true });
async function main() {
    await app.register(cors_1.default, {
        origin: true,
        credentials: true,
    });
    await app.register(slots_1.slotsRoutes, { prefix: "/slots" });
    await app.register(bookings_1.bookingsRoutes, { prefix: "/bookings" });
    app.get("/health", async () => ({ ok: true }));
    const port = Number(process.env.PORT || 3001);
    await app.listen({ port, host: "0.0.0.0" });
}
main().catch((err) => {
    app.log.error(err);
    process.exit(1);
});
