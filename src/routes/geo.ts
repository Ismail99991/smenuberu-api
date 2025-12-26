/**
 * GET /geo/geocode?address=...
 * -> { ok: true, lat, lng, address }
 */
app.get("/geocode", async (req, reply) => {
  const { address } = z.object({
    address: z.string().min(3),
  }).parse(req.query);

  const key = process.env.YANDEX_GEOCODER_API_KEY ?? "";
  if (!key) {
    return reply.code(500).send({ ok: false, error: "Geocoder API key missing" });
  }

  const url = new URL("https://geocode-maps.yandex.ru/1.x/");
  url.searchParams.set("apikey", key);
  url.searchParams.set("format", "json");
  url.searchParams.set("geocode", address);
  url.searchParams.set("lang", "ru_RU");
  url.searchParams.set("results", "1");

  const r = await fetch(url.toString());
  if (!r.ok) {
    return reply.code(502).send({ ok: false, error: "Geocoder upstream error" });
  }

  const data: any = await r.json().catch(() => null);
  const member =
    data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;

  if (!member) {
    return reply.send({ ok: true, lat: null, lng: null, address });
  }

  const pos = String(member.Point?.pos ?? "").split(" ");
  const lng = Number(pos[0]);
  const lat = Number(pos[1]);

  return reply.send({
    ok: true,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    address: member.metaDataProperty?.GeocoderMetaData?.text ?? address,
  });
});
