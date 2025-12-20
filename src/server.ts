import Fastify from "fastify";
import cors from "@fastify/cors";
import { slotsRoutes } from "./routes/slots";
import { bookingsRoutes } from "./routes/bookings";

const app = Fastify({ logger: true });

async function main() {
  await app.register(cors, {
    origin: true,
    credentials: true,
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
