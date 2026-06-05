import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface CheckNpdRequest {
  inn: string;
}

export default async function checkNpdRoute(fastify: FastifyInstance) {
  fastify.post('/check-npd', async (request: FastifyRequest<{ Body: CheckNpdRequest }>, reply: FastifyReply) => {
    try {
      const { inn } = request.body;

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
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          return reply.code(429).send({
            success: false,
            message: 'Слишком много запросов. Подождите минуту.',
            error: 'rate_limit',
          });
        }
        
        return reply.code(503).send({
          success: false,
          message: 'Сервис ФНС временно недоступен.',
          error: 'fns_unavailable',
        });
      }

      const fnsData = await response.json() as { inn: string; status: 'IN' | 'OUT'; status_date: string | null };
      const isSelfEmployed = fnsData.status === 'IN';

      return reply.send({
        success: true,
        inn: fnsData.inn,
        isSelfEmployed,
        statusDate: fnsData.status_date,
        message: isSelfEmployed
          ? 'Статус самозанятого подтверждён'
          : 'ИНН не найден в реестре самозанятых',
      });

    } catch (error) {
      fastify.log.error(error);
      
      if (error instanceof Error && error.name === 'AbortError') {
        return reply.code(504).send({
          success: false,
          message: 'Превышено время ожидания ответа от ФНС.',
          error: 'timeout',
        });
      }
      
      return reply.code(500).send({
        success: false,
        message: 'Ошибка при проверке. Попробуйте позже.',
        error: 'internal_error',
      });
    }
  });
}
