const { listDevices, removeDevice } = require('../_lib/storage');
const { webpush, pushConfig, notificationFromSummary } = require('../_lib/webpush');

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('allow', 'GET');
    return response.status(405).json({ error: 'Método não permitido.' });
  }

  if (process.env.CRON_SECRET && request.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return response.status(401).json({ error: 'Não autorizado.' });
  }

  const push = pushConfig();
  if (!push.ready) {
    return response.status(503).json({ error: 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configurados.' });
  }

  try {
    const devices = await listDevices();
    const results = { total: devices.length, sent: 0, removed: 0, failed: 0 };

    await Promise.all(devices.map(async device => {
      try {
        const payload = JSON.stringify(notificationFromSummary(device.summary));
        await webpush.sendNotification(device.subscription, payload);
        results.sent += 1;
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await removeDevice(device.deviceId);
          results.removed += 1;
          return;
        }
        console.error('Falha ao enviar push', error);
        results.failed += 1;
      }
    }));

    return response.status(200).json({ ok: true, ...results });
  } catch (error) {
    console.error(error);
    return response.status(error.code === 'KV_NOT_CONFIGURED' ? 503 : 500).json({
      error: error.code === 'KV_NOT_CONFIGURED'
        ? 'Armazenamento do Vercel não configurado.'
        : 'Não foi possível executar o cron.'
    });
  }
};
