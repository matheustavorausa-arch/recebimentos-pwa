const { saveDevice } = require('../_lib/storage');

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    return response.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const { deviceId, subscription, timezone, summary } = request.body || {};

    if (!deviceId || !subscription?.endpoint) {
      return response.status(400).json({ error: 'Inscrição push inválida.' });
    }

    await saveDevice({
      deviceId,
      subscription,
      timezone: timezone || 'America/Los_Angeles',
      summary: summary || {}
    });

    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return response.status(error.code === 'KV_NOT_CONFIGURED' ? 503 : 500).json({
      error: error.code === 'KV_NOT_CONFIGURED'
        ? 'Armazenamento do Vercel não configurado.'
        : 'Não foi possível salvar a inscrição.'
    });
  }
};
