"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadsRoutes = uploadsRoutes;
const crypto_1 = __importDefault(require("crypto"));
const s3_1 = require("../lib/s3");
function cookieName() {
    return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}
function sha256Hex(s) {
    return crypto_1.default.createHash("sha256").update(s).digest("hex");
}
async function getUserIdFromSession(app, req) {
    const sessionToken = req.cookies?.[cookieName()] ?? "";
    if (!sessionToken)
        return null;
    const tokenHash = sha256Hex(String(sessionToken));
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
async function uploadsRoutes(app) {
    // DRAFT LOGO
    app.post("/draft-logo", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return reply.code(401).send({ ok: false, error: "Unauthorized" });
        const data = await req.file();
        if (!data) {
            return reply.code(400).send({ ok: false, error: "No file uploaded" });
        }
        try {
            const fileBuffer = await data.toBuffer();
            const draftId = data.fields?.draftId?.value || crypto_1.default.randomUUID();
            const ct = data.mimetype;
            const ext = extFromContentType(ct);
            const id = crypto_1.default.randomUUID();
            const key = `drafts/${userId}/${draftId}/logo/${id}.${ext}`;
            const publicUrl = await (0, s3_1.uploadToS3)(fileBuffer, key, ct);
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
    // DRAFT PHOTO
    app.post("/draft-photo", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return reply.code(401).send({ ok: false, error: "Unauthorized" });
        const data = await req.file();
        if (!data) {
            return reply.code(400).send({ ok: false, error: "No file uploaded" });
        }
        try {
            const fileBuffer = await data.toBuffer();
            const draftId = data.fields?.draftId?.value || crypto_1.default.randomUUID();
            const ct = data.mimetype;
            const ext = extFromContentType(ct);
            const id = crypto_1.default.randomUUID();
            const key = `drafts/${userId}/${draftId}/photos/${id}.${ext}`;
            const publicUrl = await (0, s3_1.uploadToS3)(fileBuffer, key, ct);
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
    // OBJECT LOGO
    app.post("/object-logo", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return reply.code(401).send({ ok: false, error: "Unauthorized" });
        const data = await req.file();
        if (!data) {
            return reply.code(400).send({ ok: false, error: "No file uploaded" });
        }
        try {
            const fileBuffer = await data.toBuffer();
            const objectId = data.fields?.objectId?.value;
            if (!objectId) {
                return reply.code(400).send({ ok: false, error: "objectId required" });
            }
            const prisma = app.prisma;
            const object = await prisma.object.findUnique({
                where: { id: objectId },
                select: { id: true },
            });
            if (!object)
                return reply.code(404).send({ ok: false, error: "Object not found" });
            const ct = data.mimetype;
            const ext = extFromContentType(ct);
            const id = crypto_1.default.randomUUID();
            const key = `objects/${objectId}/logo/${id}.${ext}`;
            const publicUrl = await (0, s3_1.uploadToS3)(fileBuffer, key, ct);
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
    // OBJECT PHOTO
    app.post("/object-photo", async (req, reply) => {
        const userId = await getUserIdFromSession(app, req);
        if (!userId)
            return reply.code(401).send({ ok: false, error: "Unauthorized" });
        const data = await req.file();
        if (!data) {
            return reply.code(400).send({ ok: false, error: "No file uploaded" });
        }
        try {
            const fileBuffer = await data.toBuffer();
            const objectId = data.fields?.objectId?.value;
            if (!objectId) {
                return reply.code(400).send({ ok: false, error: "objectId required" });
            }
            const prisma = app.prisma;
            const object = await prisma.object.findUnique({
                where: { id: objectId },
                select: { id: true },
            });
            if (!object)
                return reply.code(404).send({ ok: false, error: "Object not found" });
            const ct = data.mimetype;
            const ext = extFromContentType(ct);
            const id = crypto_1.default.randomUUID();
            const key = `objects/${objectId}/photos/${id}.${ext}`;
            const publicUrl = await (0, s3_1.uploadToS3)(fileBuffer, key, ct);
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
}
//# sourceMappingURL=uploads.js.map