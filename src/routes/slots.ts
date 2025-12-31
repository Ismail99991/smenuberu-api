import type { FastifyInstance } from "fastify";
import crypto from "crypto";

/**
 * ВСПОМОГАТЕЛЬНОЕ: форматирование/парсинг даты-времени
 */
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function fmtISODateUTC(dt: Date) {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function fmtTimeUTC(dt: Date) {
  return `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`;
}

/**
 * Расстояние между координатами (метры)
 */
function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2);

  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * ✅ AUTH utils
 */
function cookieName() {
  return process.env.AUTH_COOKIE_NAME ?? "smenuberu_session";
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

async function getUserIdFromSession(app: FastifyInstance, req: any): Promise<string | null> {
  const sessionToken = (req.cookies as any)?.[cookieName()] ?? "";
  if (!sessionToken) return null;

  const tokenHash = sha256Hex(String(sessionToken));

  // @ts-expect-error prisma is decorated in server.ts
  const prisma = app.prisma;

  const now = new Date();

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: { expiresAt: true, userId: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= now.getTime()) {
    await prisma.session.delete({ where: { tokenHash } }).catch(() => {});
    return null;
  }

  return session.userId;
}

export async function slotsRoutes(app: FastifyInstance) {
  /**
   * GET /slots
   * ПУБЛИЧНЫЙ: все опубликованные смены
   * Используется: web (исполнители) для просмотра всех смен
   */
  app.get("/", async () => {
    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const list = await prisma.slot.findMany({
      where: { 
        published: true // ⬅️ ТОЛЬКО опубликованные
      },
      include: { object: true },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    return {
      ok: true,
      slots: list.map((s: any) => ({
        id: s.id,
        objectId: s.objectId,
        title: s.title,
        date: fmtISODateUTC(s.date),
        startTime: fmtTimeUTC(s.startTime),
        endTime: fmtTimeUTC(s.endTime),
        city: s.object?.city ?? "",
        address: s.object?.address ?? "",
        time: `${fmtTimeUTC(s.startTime)}–${fmtTimeUTC(s.endTime)}`,
        pay: s.pay,
        hot: s.hot,
        type: s.type,
      })),
    };
  });

  /**
   * GET /slots/created
   * ПРИВАТНЫЙ: только смены, созданные текущим пользователем
   * Используется: client (заказчики) для dashboard
   */
  app.get("/created", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const list = await prisma.slot.findMany({
      where: { createdById: userId },
      orderBy: [{ date: "desc" }, { startTime: "desc" }],
      select: {
        id: true,
        title: true,
        date: true,
        startTime: true,
        endTime: true,
        pay: true,
        hot: true,
        type: true,
        published: true, // ⬅️ Добавьте это поле в Prisma схему!
        object: {
          select: {
            id: true,
            name: true,
            city: true,
            address: true,
            lat: true,
            lng: true,
          },
        },
        bookings: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            createdAt: true,
            startsAt: true,
            endsAt: true,
            startConfirmedAt: true,
            startConfirmedById: true,
            endConfirmedAt: true,
            endConfirmedById: true,
            user: {
              select: {
                id: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    return reply.send({
      ok: true,
      slots: list.map((s: any) => ({
        id: s.id,
        title: s.title,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        pay: s.pay,
        hot: s.hot,
        type: s.type,
        published: s.published, // ⬅️ Теперь есть
        object: s.object,
        bookings: s.bookings,
      })),
    });
  });

  /**
   * GET /slots/:id
   * УНИВЕРСАЛЬНЫЙ: конкретная смена с разной логикой доступа
   * Используется: 
   *   - client (заказчики): для редактирования своих смен
   *   - web (исполнители): для просмотра и бронирования
   */
  app.get("/:id", async (req, reply) => {
   console.log("DEBUG slotId in API:", req.params);
    // 1. Получаем userId (если авторизован)
    const userId = await getUserIdFromSession(app, req);
    
    // 2. Получаем ID
    const { id: slotId } = req.params as any;
    
    // 3. Валидация
    if (!slotId || slotId === 'undefined') {
      return reply.code(400).send({ ok: false, error: "Invalid slot ID" });
    }

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    try {
      // 4. Ищем слот
      const slot = await prisma.slot.findUnique({
        where: { id: slotId },
        include: {
          object: {
            select: {
              id: true,
              name: true,
              city: true,
              address: true,
              lat: true,
              lng: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          bookings: {
            orderBy: { createdAt: "desc" },
            include: {
              user: {
                select: {
                  id: true,
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });

      if (!slot) {
        return reply.code(404).send({ ok: false, error: "Slot not found" });
      }

      // 5. ✅ РАЗДЕЛЕНИЕ ЛОГИКИ ДОСТУПА:
      
      // Случай A: Неавторизованный пользователь (web - публичный просмотр)
      if (!userId) {
        // Может видеть только ОПУБЛИКОВАННЫЕ смены
        if (!slot.published) {
          return reply.code(404).send({ ok: false, error: "Slot not found" });
        }
        
        // Возвращаем ОГРАНИЧЕННЫЕ данные (без sensitive info)
        return reply.send({
          ok: true,
          slot: {
            id: slot.id,
            title: slot.title,
            date: fmtISODateUTC(slot.date),
            startTime: fmtTimeUTC(slot.startTime),
            endTime: fmtTimeUTC(slot.endTime),
            pay: slot.pay,
            hot: slot.hot,
            type: slot.type,
            published: slot.published,
            object: slot.object,
            // НЕ включаем bookings для публичного доступа
            bookings: [],
            createdBy: {
              id: slot.createdBy.id,
              displayName: slot.createdBy.displayName,
              // НЕ включаем аватар и другие данные
            },
          },
        });
      }

      // Случай B: Авторизованный пользователь
      
      // B1: Это создатель смены (client - заказчик)
      if (slot.createdById === userId) {
        // Может видеть ВСЕ данные, даже неопубликованную смену
        return reply.send({
          ok: true,
          slot: {
            id: slot.id,
            title: slot.title,
            date: fmtISODateUTC(slot.date),
            startTime: fmtTimeUTC(slot.startTime),
            endTime: fmtTimeUTC(slot.endTime),
            pay: slot.pay,
            hot: slot.hot,
            type: slot.type,
            published: slot.published,
            object: slot.object,
            createdBy: slot.createdBy,
            bookings: slot.bookings.map((b: any) => ({
              id: b.id,
              status: b.status,
              user: b.user,
            })),
          },
        });
      }

      // B2: Это исполнитель, который забронировал смену (web)
      const userBooking = slot.bookings.find((b: any) => b.userId === userId);
      if (userBooking) {
        // Может видеть смену, которую забронировал
        return reply.send({
          ok: true,
          slot: {
            id: slot.id,
            title: slot.title,
            date: fmtISODateUTC(slot.date),
            startTime: fmtTimeUTC(slot.startTime),
            endTime: fmtTimeUTC(slot.endTime),
            pay: slot.pay,
            hot: slot.hot,
            type: slot.type,
            published: slot.published,
            object: slot.object,
            createdBy: slot.createdBy,
            // Видит только СВОЮ бронь
            bookings: [{
              id: userBooking.id,
              status: userBooking.status,
              user: userBooking.user,
            }],
          },
        });
      }

      // B3: Чужой пользователь без брони
      // Может видеть только ОПУБЛИКОВАННЫЕ смены
      if (!slot.published) {
        return reply.code(404).send({ ok: false, error: "Slot not found" });
      }
      
      // Видит смену, но не видит брони других
      return reply.send({
        ok: true,
        slot: {
          id: slot.id,
          title: slot.title,
          date: fmtISODateUTC(slot.date),
          startTime: fmtTimeUTC(slot.startTime),
          endTime: fmtTimeUTC(slot.endTime),
          pay: slot.pay,
          hot: slot.hot,
          type: slot.type,
          published: slot.published,
          object: slot.object,
          createdBy: slot.createdBy,
          bookings: [], // Не показывает брони других
        },
      });

    } catch (error) {
      console.error("GET /slots/:id error:", error);
      return reply.code(500).send({ ok: false, error: "Internal server error" });
    }
  });

  /**
   * POST /slots
   * Создание новой смены
   * Используется: client (заказчики)
   */
  app.post("/", async (req, reply) => {
    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const body = req.body as any;

    const objectId = String(body?.objectId ?? "");
    const title = String(body?.title ?? "");
    const dateStr = String(body?.date ?? "");
    const startStr = String(body?.startTime ?? "");
    const endStr = String(body?.endTime ?? "");
    const payNum = Number(body?.pay ?? NaN);
    const type = body?.type;
    const hot = Boolean(body?.hot ?? false);
    const published = Boolean(body?.published ?? false); // ⬅️ Добавлено

    if (!objectId || !title || !dateStr || !startStr || !endStr || !Number.isFinite(payNum) || !type) {
      return reply.code(400).send({
        ok: false,
        error: "Missing fields: objectId,title,date,startTime,endTime,pay,type",
      });
    }

    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const [y, m, d] = dateStr.split("-").map((x) => Number(x));
    const [sh, sm] = startStr.split(":").map((x) => Number(x));
    const [eh, em] = endStr.split(":").map((x) => Number(x));

    if (![y, m, d, sh, sm, eh, em].every((n) => Number.isFinite(n))) {
      return reply.code(400).send({ ok: false, error: "Bad date/time format" });
    }

    const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const startTime = new Date(Date.UTC(y, m - 1, d, sh, sm, 0));
    const endTime = new Date(Date.UTC(y, m - 1, d, eh, em, 0));

    const slot = await prisma.slot.create({
      data: {
        objectId,
        title,
        date,
        startTime,
        endTime,
        pay: Math.round(payNum),
        type,
        hot,
        published, // ⬅️ Сохраняем
        createdById: userId,
      },
    });

    return reply.send({ ok: true, slot });
  });

  /**
   * PATCH /slots/:id
   * Обновление смены
   * Используется: client (заказчики) для редактирования
   */
  app.patch("/:id", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    const { id: slotId } = req.params as any;
    const body = req.body as any;

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    // Проверяем, что смена существует и пользователь - создатель
    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      select: { createdById: true },
    });

    if (!slot) return reply.code(404).send({ ok: false, error: "Slot not found" });
    if (slot.createdById !== userId) {
      return reply.code(403).send({ ok: false, error: "Not your slot" });
    }

    // Подготавливаем данные для обновления
    const updateData: any = {};

    if (body.title !== undefined) updateData.title = String(body.title);
    if (body.date !== undefined) {
      const [y, m, d] = String(body.date).split("-").map(Number);
      updateData.date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    }
    if (body.startTime !== undefined) {
      const [sh, sm] = String(body.startTime).split(":").map(Number);
      // Используем дату из существующего слота или новую
      const existing = await prisma.slot.findUnique({ where: { id: slotId }, select: { date: true } });
      const date = existing?.date || new Date();
      updateData.startTime = new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        sh, sm, 0
      ));
    }
    if (body.endTime !== undefined) {
      const [eh, em] = String(body.endTime).split(":").map(Number);
      const existing = await prisma.slot.findUnique({ where: { id: slotId }, select: { date: true } });
      const date = existing?.date || new Date();
      updateData.endTime = new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        eh, em, 0
      ));
    }
    if (body.pay !== undefined) updateData.pay = Math.round(Number(body.pay));
    if (body.type !== undefined) updateData.type = body.type;
    if (body.hot !== undefined) updateData.hot = Boolean(body.hot);
    if (body.published !== undefined) updateData.published = Boolean(body.published);

    const updated = await prisma.slot.update({
      where: { id: slotId },
      data: updateData,
    });

    return reply.send({ ok: true, slot: updated });
  });

  /**
   * POST /slots/:id/start
   * Исполнитель "пришёл на смену"
   * Используется: web (исполнители) через мобильное приложение
   */
  app.post("/:id/start", async (req, reply) => {
    const userId = await getUserIdFromSession(app, req);
    if (!userId) return reply.code(401).send({ ok: false, error: "Unauthorized" });

    // @ts-expect-error prisma is decorated in server.ts
    const prisma = app.prisma;

    const { id: slotId } = req.params as any;
    const body = req.body as any;

    const lat = Number(body?.lat);
    const lng = Number(body?.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return reply.code(400).send({ ok: false, error: "lat/lng required" });
    }

    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      include: { object: true, bookings: true },
    });

    if (!slot) return reply.code(404).send({ ok: false, error: "slot not found" });

    const booking = (slot.bookings ?? []).find((b: any) => b.userId === userId && b.status === "booked");
    if (!booking) return reply.code(403).send({ ok: false, error: "not your booked slot" });

    const now = new Date();
    const startWindow = new Date(slot.startTime.getTime() - 15 * 60 * 1000);
    if (now.getTime() < startWindow.getTime()) {
      return reply.code(400).send({ ok: false, error: "too early" });
    }

    const oLat = slot.object?.lat ?? null;
    const oLng = slot.object?.lng ?? null;
    if (Number.isFinite(oLat) && Number.isFinite(oLng)) {
      const distM = haversineMeters(lat, lng, oLat, oLng);
      if (distM > 200) {
        return reply.code(400).send({ ok: false, error: "too far from object", distanceM: Math.round(distM) });
      }
    }

    await prisma.userGeoPing.create({
      data: { userId, lat, lng },
    });

    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "checkin_requested" },
    });

    return reply.send({ ok: true });
  });
}