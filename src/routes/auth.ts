import type { FastifyInstance } from "fastify";
import crypto from "crypto";

function normalizeBaseUrl(u: string) {
  return String(u).replace(/\/+$/, "");
}

function baseUrlFromEnv() {
  return normalizeBaseUrl(process.env.API_BASE_URL ?? "https://api.smenube.ru");
}

function webUrlFromEnvDefault() {
  return normalizeBaseUrl(process.env.WEB_URL ?? "https://www.smenube.ru");
}

function clientWebUrlFromEnv() {
  return normalizeBaseUrl(process.env.CLIENT_WEB_URL ?? "https://client.smenube.ru");
}

function webWebUrlFromEnv() {
  return normalizeBaseUrl(process.env.WEB_WEB_URL ?? webUrlFromEnvDefault());
}

function cookieName() {
  return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function randomState() {
  return crypto.randomBytes(16).toString("hex");
}

function randomPerformerQrToken() {
  // Stable, unique token for user's personal QR
  return crypto.randomBytes(24).toString("hex");
}

async function ensurePerformerQrToken(prisma: any, userId: string) {
  // Генерируем QR-токен один раз. Если уже есть — ничего не делаем.
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { performerQrToken: true }
  });
  if (existing?.performerQrToken) return existing.performerQrToken;

  // На случай коллизии уникального индекса — несколько попыток
  for (let i = 0; i < 5; i++) {
    const token = randomPerformerQrToken();
    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { performerQrToken: token },
        select: { performerQrToken: true }
      });
      return updated.performerQrToken;
    } catch (e: any) {
      // Prisma unique constraint: P2002
      if (String(e?.code ?? "") === "P2002") continue;
      throw e;
    }
  }

  throw new Error("failed to generate unique performerQrToken");
}

function yandexAuthorizeUrl(args: { clientId: string; redirectUri: string; state: string }) {
  const u = new URL("https://oauth.yandex.com/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("state", args.state);
  return u.toString();
}

async function exchangeCodeForToken(args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const res = await fetch("https://oauth.yandex.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri
    }).toString()
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Yandex token exchange failed: ${res.status}${text ? ` ${text}` : ""}`);
  }

  return (await res.json()) as any;
}

async function fetchYandexUserInfo(accessToken: string): Promise<{
  id: string;
  login?: string;
  display_name?: string;
  real_name?: string;
  default_email?: string;
  emails?: string[];
  default_avatar_id?: string;
}> {
  const u = new URL("https://login.yandex.ru/info");
  u.searchParams.set("format", "json");

  const res = await fetch(u.toString(), {
    method: "GET",
    headers: { Authorization: `OAuth ${accessToken}` }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Yandex userinfo failed: ${res.status}${text ? ` ${text}` : ""}`);
  }

  return (await res.json()) as any;
}

function avatarUrlFromYandex(default_avatar_id?: string): string | null {
  if (!default_avatar_id) return null;
  return `https://avatars.yandex.net/get-yapic/${default_avatar_id}/islands-200`;
}

/**
 * Для прод-куки на поддоменах нужно Domain=.smenube.ru
 * На localhost домен ставить нельзя.
 */
function cookieDomainForReq(req: any): string | undefined {
  const host = String(req?.headers?.host ?? "");
  if (host.includes("localhost") || host.includes("127.0.0.1")) return undefined;
  return ".smenube.ru";
}

function readNext(req: any, fallback: string) {
  const n = typeof (req.query as any)?.next === "string" ? String((req.query as any).next) : "";
  const safe = n.startsWith("/") ? n : fallback;
  return safe;
}

function setNextCookie(reply: any, next: string) {
  reply.setCookie("yandex_oauth_next", next, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 10 * 60
  });
}

function takeNextCookie(req: any, reply: any, fallback: string) {
  const next = (req.cookies as any)?.yandex_oauth_next ?? fallback;
  reply.clearCookie("yandex_oauth_next", { path: "/" });
  return typeof next === "string" && next.startsWith("/") ? next : fallback;
}

type FlowKind = "client" | "web" | "legacy";

function flowConfig(kind: FlowKind) {
  // Разные приложения/доступы:
  // - YANDEX_CLIENT_ID_CLIENT / _SECRET_CLIENT
  // - YANDEX_CLIENT_ID_WEB / _SECRET_WEB
  if (kind === "client") {
    const clientId = process.env.YANDEX_CLIENT_ID_CLIENT ?? "";
    const clientSecret = process.env.YANDEX_CLIENT_SECRET_CLIENT ?? "";
    const redirectUri = `${baseUrlFromEnv()}/auth/yandex/client/callback`;
    const webUrl = clientWebUrlFromEnv();
    const provider = "yandex_client";
    return { clientId, clientSecret, redirectUri, webUrl, provider };
  }

  if (kind === "web") {
    const clientId = process.env.YANDEX_CLIENT_ID_WEB ?? "";
    const clientSecret = process.env.YANDEX_CLIENT_SECRET_WEB ?? "";
    const redirectUri = `${baseUrlFromEnv()}/auth/yandex/web/callback`;
    const webUrl = webWebUrlFromEnv();
    const provider = "yandex_web";
    return { clientId, clientSecret, redirectUri, webUrl, provider };
  }

  // legacy/back-compat
  const clientId = process.env.YANDEX_CLIENT_ID ?? "";
  const clientSecret = process.env.YANDEX_CLIENT_SECRET ?? "";
  const redirectUri = `${baseUrlFromEnv()}/auth/yandex/callback`;
  const webUrl = webUrlFromEnvDefault();
  const provider = "yandex";
  return { clientId, clientSecret, redirectUri, webUrl, provider };
}

export async function authRoutes(app: FastifyInstance) {
  // Один раз заполнить performerQrToken для уже существующих пользователей.
  // Защита: нужен секрет в ENV и тот же секрет в query ?key=
  // Ничего не ломает, если секрет не задан — просто запрещает вызов.
  app.post("/qr/backfill", async (req, reply) => {
    const key = typeof (req.query as any)?.key === "string" ? String((req.query as any).key) : "";
    const secret = process.env.QR_BACKFILL_SECRET ?? "";
    if (!secret || key !== secret) return reply.code(403).send({ ok: false, error: "forbidden" });

    const limitRaw = typeof (req.query as any)?.limit === "string" ? String((req.query as any).limit) : "";
    const limit = Math.max(1, Math.min(1000, Number(limitRaw || 200)));

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const users = await prisma.user.findMany({
      where: { performerQrToken: null },
      select: { id: true },
      take: limit
    });

    let updated = 0;
    for (const u of users) {
      await ensurePerformerQrToken(prisma, u.id);
      updated++;
    }

    return reply.send({ ok: true, updated });
  });

  async function startFlow(kind: FlowKind, req: any, reply: any) {
    const cfg = flowConfig(kind);
    if (!cfg.clientId || !cfg.clientSecret) {
      return reply.code(500).send({ ok: false, error: "YANDEX_CLIENT_ID/SECRET not set for flow", flow: kind });
    }

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const state = randomState();

    // state живёт 10 минут
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // ✅ сохраняем в БД (основной источник правды)
    await prisma.oAuthState.create({
      data: {
        provider: cfg.provider,
        state,
        expiresAt
      }
    });

    // ✅ state cookie fallback
    reply.setCookie("yandex_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 10 * 60
    });

    // ✅ next cookie (куда вернуться после callback)
    // дефолт для flow:
    const fallbackNext = kind === "client" ? "/profile" : "/me";
    const next = readNext(req, fallbackNext);
    setNextCookie(reply, next);

    const url = yandexAuthorizeUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, state });
    return reply.redirect(url);
  }

  async function callbackFlow(kind: FlowKind, req: any, reply: any) {
    let stage = "init";
    try {
      const cfg = flowConfig(kind);
      if (!cfg.clientId || !cfg.clientSecret) {
        return reply.code(500).send({ ok: false, error: "YANDEX_CLIENT_ID/SECRET not set for flow", flow: kind });
      }

      const code = typeof (req.query as any)?.code === "string" ? String((req.query as any).code) : "";
      const state = typeof (req.query as any)?.state === "string" ? String((req.query as any).state) : "";
      if (!code || !state) return reply.code(400).send({ ok: false, error: "missing code/state" });

      // @ts-expect-error prisma is decorated in server.ts
      const prisma = app.prisma;

      stage = "state_check_db";
      const row = await prisma.oAuthState.findUnique({
        where: { state },
        select: { expiresAt: true, provider: true }
      });

      const cookieState = (req.cookies as any)?.yandex_oauth_state ?? "";

      // ✅ 1) основной путь — через БД (provider совпадает)
      // ✅ 2) fallback — через cookie
      if (!row || row.provider !== cfg.provider) {
        if (!cookieState || cookieState !== state) {
          return reply.code(400).send({ ok: false, error: "invalid state" });
        }
      } else {
        if (row.expiresAt.getTime() <= Date.now()) {
          await prisma.oAuthState.delete({ where: { state } }).catch(() => {});
          reply.clearCookie("yandex_oauth_state", { path: "/" });
          return reply.code(400).send({ ok: false, error: "state expired" });
        }
        // одноразовый state
        await prisma.oAuthState.delete({ where: { state } });
      }

      reply.clearCookie("yandex_oauth_state", { path: "/" });

      stage = "token_exchange_fetch";
      const token = await exchangeCodeForToken({
        code,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        redirectUri: cfg.redirectUri
      });

      stage = "userinfo_fetch";
      const info = await fetchYandexUserInfo(token.access_token);

      const yandexId = String(info.id);
      const yandexLogin = info.login ? String(info.login) : null;
      const displayName =
        (info.display_name && String(info.display_name)) ||
        (info.real_name && String(info.real_name)) ||
        yandexLogin ||
        null;

      const email =
        (info.default_email && String(info.default_email)) ||
        (Array.isArray(info.emails) && info.emails[0] ? String(info.emails[0]) : null);

      const avatarUrl = avatarUrlFromYandex(info.default_avatar_id);

      stage = "db_upsert_user";
      const user = await prisma.user.upsert({
        where: { yandexId },
        update: { yandexLogin, displayName, email, avatarUrl },
        create: { yandexId, yandexLogin, displayName, email, avatarUrl },
        select: { id: true, performerQrToken: true }
      });

      // ✅ Персональный QR токен должен быть у каждого исполнителя.
      // Генерируем при первой регистрации и догоним уже существующих пользователей.
      if (!user.performerQrToken) {
        await ensurePerformerQrToken(prisma, user.id);
      }

      stage = "db_create_session";
      const rawSessionToken = randomToken();
      const tokenHash = sha256Hex(rawSessionToken);

      const days = Number(process.env.SESSION_DAYS ?? 30);
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      await prisma.session.create({
        data: { userId: user.id, tokenHash, expiresAt }
      });

      stage = "set_cookie_and_redirect";
      const domain = cookieDomainForReq(req);

      reply.setCookie(cookieName(), rawSessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
        ...(domain ? { domain } : {})
      });

      const fallbackNext = kind === "client" ? "/profile" : "/me";
      const next = takeNextCookie(req, reply, fallbackNext);

      return reply.redirect(`${cfg.webUrl}${next}`);
    } catch (err: any) {
      app.log.error({ err, stage, flow: kind }, "auth yandex callback failed");
      return reply.code(500).send({
        ok: false,
        error: "auth callback failed",
        stage,
        flow: kind,
        message: err?.message ?? String(err)
      });
    }
  }

  // ========= New flows (separate apps) =========

  /**
   * GET /auth/yandex/client/start
   */
  app.get("/yandex/client/start", async (req, reply) => startFlow("client", req, reply));

  /**
   * GET /auth/yandex/client/callback
   */
  app.get("/yandex/client/callback", async (req, reply) => callbackFlow("client", req, reply));

  /**
   * GET /auth/yandex/web/start
   */
  app.get("/yandex/web/start", async (req, reply) => startFlow("web", req, reply));

  /**
   * GET /auth/yandex/web/callback
   */
  app.get("/yandex/web/callback", async (req, reply) => callbackFlow("web", req, reply));

  // ========= Legacy (keep old behavior) =========

  /**
   * GET /auth/yandex/start  (legacy)
   */
  app.get("/yandex/start", async (req, reply) => startFlow("legacy", req, reply));

  /**
   * GET /auth/yandex/callback (legacy)
   */
  app.get("/yandex/callback", async (req, reply) => callbackFlow("legacy", req, reply));

  /**
   * GET /auth/me
   */
  app.get("/me", async (req, reply) => {
    const sessionToken = (req.cookies as any)?.[cookieName()] ?? "";
    if (!sessionToken) return reply.code(200).send({ ok: true, user: null });

    const tokenHash = sha256Hex(String(sessionToken));

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const now = new Date();

    const session = await prisma.session.findUnique({
      where: { tokenHash },
      select: {
        expiresAt: true,
        user: {
          select: {
            id: true,
            displayName: true,
            yandexLogin: true,
            email: true,
            avatarUrl: true,
            performerQrToken: true,
            createdAt: true
          }
        }
      }
    });

    if (!session) return reply.code(200).send({ ok: true, user: null });

    if (session.expiresAt.getTime() <= now.getTime()) {
      await prisma.session.delete({ where: { tokenHash } }).catch(() => {});
      return reply.code(200).send({ ok: true, user: null });
    }

    return reply.send({ ok: true, user: session.user });
  });
}
