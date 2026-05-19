"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadsRoutes = uploadsRoutes;
const zod_1 = require("zod");
const crypto_1 = __importDefault(require("crypto"));
const s3_1 = require("../lib/s3");
function cookieName() {
    return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}
function sha256Hex(s) {
    return crypto_1.default.createHash("sha256").update(s).digest("hex");
}
/**
 * Достаём userId из cookie-сессии.
 */
async function getUserIdFromSession(app, req) {
    const sessionToken = req.cookies?.[cookieName()] ?? "";
    if (!sessionToken)
        return null;
    const tokenHash = sha256Hex(String(sessionToken));
    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;
    const now = new Date();
    const session = await prisma.session.findUnique({
        where: { tokenHash },
        select: { expiresAt: true, userId: true },
    });
    if (!session)
        return null;
    if (session.expiresAt.getTime() <= now.getTime()) {
        await prisma.session.delete({ where: { tokenHash } }).catch(() => { });
        return null;
    }
    return session.userId;
}
function extFromContentType(ct) {
    const c = (ct || "").toLowerCase();
    if (c.includes("png"))
        return "png";
    if (c.includes("jpeg") || c.includes("jpg"))
        return "jpg";
    if (c.includes("webp"))
        return "webp";
    if (c.includes("gif"))
        return "gif";
    return "bin";
}
const objectUploadSchema = zod_1.z.object({
    objectId: zod_1.z.string().min(1),
    contentType: zod_1.z.string().min(1),
});
const draftUploadSchema = zod_1.z.object({
    draftId: zod_1.z.string().min(1),
    contentType: zod_1.z.string().min(1),
});
async function uploadsRoutes(app) {
    // -----------------------
    // DRAFT UPLOADS (без БД)
    // -----------------------
    /**
     * POST /uploads/draft-logo
     * body: { draftId, contentType }
     * NOTE: Теперь ожидаем, что файл приходит в body как buffer
     * Для упрощения: клиент должен отправить файл напрямую
     */
    app.post("/draft-logo", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return reply.code(401).send({ ok: false, error: "Unauthorized" });
        // Ожидаем multipart/form-data с файлом
        const data = req.body;
        const file = data?.file;
        if (!file || !file.data) {
            return reply.code(400).send({ ok: false, error: "No file uploaded" });
        }
        const parsed = draftUploadSchema.safeParse(data);
        if (!parsed.success) {
            return reply.code(400).send({ ok: false, error: "invalid payload", issues: parsed.error.issues });
        }
        try {
            const ct = file.mimetype || "image/jpeg";
            const ext = extFromContentType(ct);
            const id = crypto_1.default.randomUUID();
            const key = `drafts/${userId}/${parsed.data.draftId}/logo/${id}.${ext}`;
            const publicUrl = await (0, s3_1.uploadToS3)(file.data, key, ct);
            return reply.send({
                ok: true,
                publicUrl,
                path: key,
            });
        }
        catch (err) {
            app.log.error({ err }, "uploads/draft-logo failed");
            return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
        }
    });
    /**
     * POST /uploads/draft-photo
     * body: { draftId, contentType }
     */
    app.post("/draft-photo", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return reply.code(401).send({ ok: false, error: "Unauthorized" });
        const data = req.body;
        const file = data?.file;
        if (!file || !file.data) {
            return reply.code(400).send({ ok: false, error: "No file uploaded" });
        }
        const parsed = draftUploadSchema.safeParse(data);
        if (!parsed.success) {
            return reply.code(400).send({ ok: false, error: "invalid payload", issues: parsed.error.issues });
        }
        try {
            const ct = file.mimetype || "image/jpeg";
            const ext = extFromContentType(ct);
            const id = crypto_1.default.randomUUID();
            const key = `drafts/${userId}/${parsed.data.draftId}/photos/${id}.${ext}`;
            const publicUrl = await (0, s3_1.uploadToS3)(file.data, key, ct);
            return reply.send({
                ok: true,
                publicUrl,
                path: key,
            });
        }
        catch (err) {
            app.log.error({ err }, "uploads/draft-photo failed");
            return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
        }
    });
    // -----------------------
    // OBJECT UPLOADS
    // -----------------------
    /**
     * POST /uploads/object-photo
     * body: { objectId, contentType }
     */
    app.post("/object-photo", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return reply.code(401).send({ ok: false, error: "Unauthorized" });
        const data = req.body;
        const file = data?.file;
        if (!file || !file.data) {
            return reply.code(400).send({ ok: false, error: "No file uploaded" });
        }
        const parsed = objectUploadSchema.safeParse(data);
        if (!parsed.success) {
            return reply.code(400).send({ ok: false, error: "invalid payload", issues: parsed.error.issues });
        }
        try {
            // @ts-expect-error prisma is decorated in server.ts
            const prisma = app.prisma;
            const object = await prisma.object.findUnique({
                where: { id: parsed.data.objectId },
                select: { id: true },
            });
            if (!object)
                return reply.code(404).send({ ok: false, error: "Object not found" });
            const ct = file.mimetype || "image/jpeg";
            const ext = extFromContentType(ct);
            const id = crypto_1.default.randomUUID();
            const key = `objects/${parsed.data.objectId}/photos/${id}.${ext}`;
            const publicUrl = await (0, s3_1.uploadToS3)(file.data, key, ct);
            return reply.send({
                ok: true,
                publicUrl,
                path: key,
            });
        }
        catch (err) {
            app.log.error({ err }, "uploads/object-photo failed");
            return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
        }
    });
    /**
     * POST /uploads/object-logo
     * body: { objectId, contentType }
     */
    app.post("/object-logo", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return reply.code(401).send({ ok: false, error: "Unauthorized" });
        const data = req.body;
        const file = data?.file;
        if (!file || !file.data) {
            return reply.code(400).send({ ok: false, error: "No file uploaded" });
        }
        const parsed = objectUploadSchema.safeParse(data);
        if (!parsed.success) {
            return reply.code(400).send({ ok: false, error: "invalid payload", issues: parsed.error.issues });
        }
        try {
            // @ts-expect-error prisma is decorated in server.ts
            const prisma = app.prisma;
            const object = await prisma.object.findUnique({
                where: { id: parsed.data.objectId },
                select: { id: true },
            });
            if (!object)
                return reply.code(404).send({ ok: false, error: "Object not found" });
            const ct = file.mimetype || "image/jpeg";
            const ext = extFromContentType(ct);
            const id = crypto_1.default.randomUUID();
            const key = `objects/${parsed.data.objectId}/logo/${id}.${ext}`;
            const publicUrl = await (0, s3_1.uploadToS3)(file.data, key, ct);
            return reply.send({
                ok: true,
                publicUrl,
                path: key,
            });
        }
        catch (err) {
            app.log.error({ err }, "uploads/object-logo failed");
            return reply.code(500).send({ ok: false, error: "upload failed", message: err?.message ?? String(err) });
        }
    });
}
//# sourceMappingURL=uploads.js.map