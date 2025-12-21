import type { FastifyInstance } from "fastify";

export async function objectsRoutes(app: FastifyInstance) {
  /**
   * GET /objects
   * Список объектов для UI (селект в админке и т.п.)
   */
  app.get("/", async () => {
    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const rows = await prisma.object.findMany({
      orderBy: [{ city: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        city: true,
        address: true,
        createdAt: true
      }
    });

    return rows;
  });
}
