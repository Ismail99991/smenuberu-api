import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface CheckNpdRequest {
  inn: string;
}

interface FnsApiResponse {
  status: boolean;      // true — самозанятый, false — нет
  message: string;
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

      // Текущая дата в формате YYYY-MM-DD
      const today = new Date().toISOString().split('T')[0];

      // Новый актуальный API ФНС
      const fnsUrl = 'https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status';
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // таймаут 30 секунд (по документации не менее 60, но 30 достаточно)

      const response = await fetch(fnsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inn: cleanInn,
          requestDate: today,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Обработка HTTP ошибок
      if (response.status === 422) {
        const errorData = await response.json();
        return reply.code(422).send({
          success: false,
          message: errorData.message || 'Ошибка проверки. Проверьте правильность ИНН.',
          error: 'validation_failed',
        });
      }

      if (response.status === 429) {
        return reply.code(429).send({
          success: false,
          message: 'Слишком много запросов. Подождите минуту и попробуйте снова.',
          error: 'rate_limit',
        });
      }

      if (!response.ok) {
        return reply.code(503).send({
          success: false,
          message: 'Сервис ФНС временно недоступен. Попробуйте позже.',
          error: 'fns_unavailable',
        });
      }

      const fnsData: FnsApiResponse = await response.json();
      const isSelfEmployed = fnsData.status === true;

      return reply.send({
        success: true,
        inn: cleanInn,
        isSelfEmployed: isSelfEmployed,
        statusDate: today,
        message: isSelfEmployed
          ? fnsData.message || 'Статус самозанятого подтверждён'
          : fnsData.message || 'ИНН не найден в реестре самозанятых',
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
        message: 'Ошибка при проверке. Попробуйте позже.',
        error: 'internal_error',
      });
    }
  });
}
