import type { FastifyInstance } from "fastify";
import crypto from "crypto";

function baseUrlFromEnv() {
  return process.env.API_BASE_URL ?? "https://smenuberu-api.onrender.com";
}

function webUrlFromEnv() {
  return process.env.WEB_URL ?? "http://localhost:3000";
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
    headers: {
      Authorization: `OAuth ${accessToken}`
    }
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

export async function authRoutes(app: FastifyInstance) {
  app.get("/yandex/start", async (req, reply) => {
    const clientId = process.env.YANDEX_CLIENT_ID ?? "";
    const clientSecret = process.env.YANDEX_CLIENT_SECRET ?? "";
    if (!clientId || !clientSecret) {
      return reply.code(500).send({ ok: false, error: "YANDEX_CLIENT_ID/SECRET not set" });
    }

    const state = randomState();
    const redirectUri = `${baseUrlFromEnv()}/auth/yandex/callback`;

    reply.setCookie("yandex_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 10 * 60
    });

    const url = yandexAuthorizeUrl({ clientId, redirectUri, state });
    return reply.redirect(url);
  });

  app.get("/yandex/callback", async (req, reply) => {
    let stage = "init";

    try {
      const clientId = process.env.YANDEX_CLIENT_ID ?? "";
      const clientSecret = process.env.YANDEX_CLIENT_SECRET ?? "";
      if (!clientId || !clientSecret) {
        return reply.code(500).send({ ok: false, error: "YANDEX_CLIENT_ID/SECRET not set" });
      }

      const code = typeof (req.query as any)?.code === "string" ? String((req.query as any).code) : "";
      const state = typeof (req.query as any)?.state === "string" ? String((req.query as any).state) : "";
      const expectedState = (req.cookies as any)?.yandex_oauth_state ?? "";

      if (!code || !state) return reply.code(400).send({ ok: false, error: "missing code/state" });
      if (!expectedState || state !== expectedState) {
        return reply.code(400).send({ ok: false, error: "invalid state" });
      }

      const redirectUri = `${baseUrlFromEnv()}/auth/yandex/callback`;

      // @ts-expect-error prisma is decorated in server.ts
      const prisma = app.prisma;

      stage = "token_exchange_fetch";
      const token = await exchangeCodeForToken({ code, clientId, clientSecret, redirectUri });

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
        select: { id: true }
      });

      stage = "db_create_session";
      const rawSessionToken = randomToken();
      const tokenHash = sha256Hex(rawSessionToken);

      const days = Number(process.env.SESSION_DAYS ?? 30);
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      await prisma.session.create({
        data: { userId: user.id, tokenHash, expiresAt }
      });

      stage = "set_cookie_and_redirect";
      reply.setCookie(cookieName(), rawSessionToken, {
        httpOnly: true,
        sameSite: "none",
        secure: true,
        path: "/",
        expires: expiresAt
      });

      reply.clearCookie("yandex_oauth_state", { path: "/" });

      return reply.redirect(`${webUrlFromEnv()}/me`);
    } catch (err: any) {
      app.log.error({ err, stage }, "auth yandex callback failed");
      return reply.code(500).send({
        ok: false,
        error: "auth callback failed",
        stage,
        message: err?.message ?? String(err)
      });
    }
  });

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

  app.post("/logout", async (req, reply) => {
    const sessionToken = (req.cookies as any)?.[cookieName()] ?? "";
    if (!sessionToken) {
      reply.clearCookie(cookieName(), { path: "/" });
      return reply.send({ ok: true });
    }

    const tokenHash = sha256Hex(String(sessionToken));

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    await prisma.session.deleteMany({ where: { tokenHash } }).catch(() => {});
    reply.clearCookie(cookieName(), { path: "/" });
    return reply.send({ ok: true });
  });
}
