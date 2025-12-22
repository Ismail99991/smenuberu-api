import type { FastifyInstance } from "fastify";
import { z } from "zod";

export async function geoRoutes(app: FastifyInstance) {
  /**
   * GET /geo/suggest?q=...
   * -> { ok: true, items: [{ title, subtitle, value }] }
   */
  app.get("/suggest", async (req, reply) => {
    const { q } = z.object({ q: z.string().min(1) }).parse(req.query);

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

    const items = itemsRaw.map((it: any) => ({
      title: String(it?.title?.text ?? it?.title ?? "").trim(),
      subtitle: String(it?.subtitle?.text ?? it?.subtitle ?? "").trim(),
      value: String(it?.address ?? it?.title?.text ?? it?.title ?? "").trim(),
    })).filter((x: any) => x.title || x.value);

    return reply.send({ ok: true, items });
  });
}
