import { PrismaClient, TaskType } from "@prisma/client";

const prisma = new PrismaClient();

function atDayTime(baseDay: Date, hhmm: string) {
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate(), hh || 0, mm || 0, 0);
}

async function main() {
  // demo user
  await prisma.user.upsert({
    where: { id: "demo-user" },
    update: {},
    create: { id: "demo-user", displayName: "Demo" },
  });

  const obj1 = await prisma.object.create({
    data: { name: "Склад Север", city: "Москва", address: "Дмитровское ш., 1" },
  });

  const obj2 = await prisma.object.create({
    data: { name: "Кухня Центр", city: "Москва", address: "Тверская, 10" },
  });

  const today = new Date();
  const types: TaskType[] = ["driver", "picker", "loader", "cook", "cleaner"];

  for (let i = 0; i < 14; i++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const dateOnly = new Date(day.getFullYear(), day.getMonth(), day.getDate());

    const make = async (objectId: string, title: string, type: TaskType, start: string, end: string, pay: number, hot: boolean) => {
      await prisma.slot.create({
        data: {
          objectId,
          date: dateOnly,
          startTime: atDayTime(day, start),
          endTime: atDayTime(day, end),
          title,
          type,
          pay,
          hot,
        },
      });
    };

    await make(obj1.id, "Логистика на складе", types[i % types.length], "08:00", "15:00", 3200 + (i % 3) * 200, i % 5 === 0);
    await make(obj1.id, "Сбор заказов", "picker", "15:30", "20:30", 3400 + (i % 2) * 300, i % 7 === 0);
    await make(obj2.id, "Помощник на кухне", "cook", "10:00", "19:00", 3600 + (i % 4) * 150, i % 6 === 0);
  }

  console.log("Seed done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
