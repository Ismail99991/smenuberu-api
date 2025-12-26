import type { FastifyInstance } from "fastify";
import { z } from "zod";

export async function geoRoutes(app: FastifyInstance) {
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

    const url = new URL("https://suggest-maps.yandex.ru/v1/suggest");
    url.searchParams.set("apikey", key);
    url.searchParams.set("text", q);
    url.searchParams.set("lang", "ru_RU");
    url.searchParams.set("results", "5");

    const r = await fetch(url.toString());
    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "Suggest upstream error" });
    }

    const data: any = await r.json().catch(() => null);
    const itemsRaw = Array.isArray(data?.results) ? data.results : [];

    const items = itemsRaw
      .map((it: any) => ({
        title: String(it?.title?.text ?? it?.title ?? "").trim(),
        subtitle: String(it?.subtitle?.text ?? it?.subtitle ?? "").trim(),
        value: String(it?.address ?? it?.title?.text ?? it?.title ?? "").trim(),
      }))
      .filter((x: any) => x.title || x.value);

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

    const posStr: string | null = member?.Point?.pos ?? null; // "lng lat"
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
