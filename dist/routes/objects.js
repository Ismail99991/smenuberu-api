"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.objectsRoutes = objectsRoutes;
async function objectsRoutes(app) {
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
//# sourceMappingURL=objects.js.map