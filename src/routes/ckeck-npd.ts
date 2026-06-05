import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface FnsApiResponse {
  inn: string;
  status: 'IN' | 'OUT';
  status_date: string | null;
}

interface CheckNpdRequest {
  inn: string;
}

export default async function checkNpdRoute(fastify: FastifyInstance) {
  fastify.post('/check-npd', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: CheckNpdRequest }>, reply: FastifyReply) => {
    try {
      const { inn } = request.body;
      const userId = (request.user as { id: string }).id;

      // Очистка ИНН
      const cleanInn = inn.toString().replace(/\D/g, '');
      if (cleanInn.length !== 10 && cleanInn.length !== 12) {
        return reply.code(400).send({
          success: false,
          message: 'ИНН должен содержать 10 или 12 цифр',
        });
      }

      // Запрос к ФНС
      const fnsUrl = `https://npd.nalog.ru/api/v1/check-status/${cleanInn}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(fnsUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          return reply.code(429).send({
            success: false,
            message: 'Слишком много запросов. Подождите минуту и попробуйте снова.',
            error: 'rate_limit',
          });
        }
        
        return reply.code(503).send({
          success: false,
          message: 'Сервис ФНС временно недоступен. Попробуйте позже.',
          error: 'fns_unavailable',
        });
      }

      const fnsData: FnsApiResponse = await response.json();
      const isSelfEmployed = fnsData.status === 'IN';

      // Сохраняем в БД
      await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          isSelfEmployed: isSelfEmployed,
          selfEmployedInn: cleanInn,
          selfEmployedVerifiedAt: new Date(),
          selfEmployedStatusDate: fnsData.status_date,
        },
      });

      return reply.send({
        success: true,
        inn: fnsData.inn,
        isSelfEmployed: isSelfEmployed,
        statusDate: fnsData.status_date,
        message: isSelfEmployed
          ? 'Статус самозанятого подтверждён. Теперь вам доступна запись на смены.'
          : 'ИНН не найден в реестре самозанятых. Зарегистрируйтесь в приложении «Мой Налог».',
      });

    } catch (error) {
      fastify.log.error(error);
      
      if (error instanceof Error && error.name === 'AbortError') {
        return reply.code(504).send({
          success: false,
          message: 'Превышено время ожидания ответа от ФНС. Попробуйте позже.',
          error: 'timeout',
        });
      }
      
      return reply.code(500).send({
        success: false,
        message: 'Произошла ошибка при проверке. Попробуйте позже.',
        error: 'internal_error',
      });
    }
  });
}
