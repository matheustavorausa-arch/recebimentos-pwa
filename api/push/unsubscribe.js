const { removeDevice } = require('../_lib/storage');

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    return response.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const { deviceId } = request.body || {};
    await removeDevice(deviceId);
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: 'Não foi possível remover a inscrição.' });
  }
};
