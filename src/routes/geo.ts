import type { FastifyInstance } from "fastify";
import crypto from "crypto";
import { z } from "zod";

export async function geoRoutes(app: FastifyInstance) {
  function cookieName() {
    return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
  }

  function sha256Hex(s: string) {
    return crypto.createHash("sha256").update(s).digest("hex");
  }

  async function getUserIdFromSession(req: any): Promise<string | null> {
    const sessionCookie = req.cookies?.[cookieName()] ?? null;
    if (!sessionCookie) return null;

    const sessionHash = sha256Hex(sessionCookie);

    const prisma = (app as any).prisma;
    const user = await prisma.user.findFirst({
      where: { sessionHash },
      select: { id: true },
    });

    return user?.id ?? null;
  }

  /**
   * POST /geo/ping
   * Body: { lat, lng }
   *
   * Исполнитель "параллельно" отправляет координаты (для confirm-start/end).
   */
  app.post("/ping", async (req, reply) => {
    const userId = await getUserIdFromSession(req);
    if (!userId) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const body = z
      .object({
        lat: z.number(),
        lng: z.number(),
      })
      .parse((req as any).body);

    if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
      return reply.code(400).send({ ok: false, error: "invalid coords" });
    }

    const prisma = (app as any).prisma;

    await prisma.userGeoPing.create({
      data: {
        userId,
        lat: body.lat,
        lng: body.lng,
      },
    });

    return reply.send({ ok: true });
  });

  /**
   * GET /geo/suggest?q=...
   * -> { ok: true, items: [{ title, subtitle, value }] }
   */
  app.get("/suggest", async (req, reply) => {
    const { q } = z.object({ q: z.string().min(1) }).parse((req as any).query);

    const key = process.env.YANDEX_GEOSUGGEST_API_KEY ?? "";
    if (!key) {
      return reply.send({ ok: true, items: [] });
    }

    // Yandex Suggest API (Maps)
    // https://yandex.ru/dev/maps/suggest/doc/ru/
    const url = new URL("https://suggest-maps.yandex.ru/v1/suggest");
    url.searchParams.set("apikey", key);
    url.searchParams.set("text", q);
    url.searchParams.set("lang", "ru_RU");
    url.searchParams.set("types", "geo");
    url.searchParams.set("results", "10");

    const r = await fetch(url.toString());
    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "Suggest upstream error" });
    }

    const data: any = await r.json().catch(() => null);
    const results: any[] = Array.isArray(data?.results) ? data.results : [];

    const items = results
      .map((it) => {
        const title = String(it?.title?.text ?? "").trim();
        const subtitle = String(it?.subtitle?.text ?? "").trim();
        const value = String(it?.title?.text ?? "").trim();
        if (!title) return null;
        return { title, subtitle, value };
      })
      .filter(Boolean);

    return reply.send({ ok: true, items });
  });

  /**
   * GET /geo/geocode?address=...
   * -> { ok:true, lat:number|null, lng:number|null, address?:string }
   *
   * Нужен для того, чтобы по выбранному адресу получить координаты (lat/lng) и сохранить в Object.
   */
  app.get("/geocode", async (req, reply) => {
    const { address } = z.object({ address: z.string().min(3) }).parse((req as any).query);

    const key = process.env.YANDEX_GEOCODER_API_KEY ?? "";
    if (!key) {
      // не валим фронт — просто без координат
      return reply.send({ ok: true, lat: null, lng: null });
    }

    // Yandex Geocoder HTTP API
    // https://geocode-maps.yandex.ru/1.x/?apikey=...&geocode=...&format=json
    const url = new URL("https://geocode-maps.yandex.ru/1.x/");
    url.searchParams.set("apikey", key);
    url.searchParams.set("geocode", address);
    url.searchParams.set("format", "json");
    url.searchParams.set("lang", "ru_RU");
    url.searchParams.set("results", "1");

    const r = await fetch(url.toString());
    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "Geocode upstream error" });
    }

    const data: any = await r.json().catch(() => null);

    const member =
      data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject ?? null;

    const posStr: string | null = member?.Point?.pos ?? null;
    const textAddress: string | undefined =
      member?.metaDataProperty?.GeocoderMetaData?.text ?? undefined;

    if (!posStr || typeof posStr !== "string") {
      return reply.send({ ok: true, lat: null, lng: null, address: textAddress });
    }

    const [lngS, latS] = posStr.split(" ");
    const lng = Number(lngS);
    const lat = Number(latS);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return reply.send({ ok: true, lat: null, lng: null, address: textAddress });
    }

    return reply.send({ ok: true, lat, lng, address: textAddress });
  });
}
