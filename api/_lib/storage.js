const DEVICE_SET_KEY = 'recebimentos:push:devices';
const DEVICE_KEY_PREFIX = 'recebimentos:push:device:';

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token, ready: Boolean(url && token) };
}

async function redisPipeline(commands) {
  const { url, token, ready } = redisConfig();
  if (!ready) {
    const error = new Error('KV_REST_API_URL/KV_REST_API_TOKEN não configurados.');
    error.code = 'KV_NOT_CONFIGURED';
    throw error;
  }

  const response = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(commands)
  });

  if (!response.ok) {
    throw new Error(`Redis REST falhou: ${response.status}`);
  }

  const results = await response.json();
  return results.map(item => {
    if (item.error) throw new Error(item.error);
    return item.result;
  });
}

async function saveDevice(device) {
  const payload = JSON.stringify({
    ...device,
    updatedAt: new Date().toISOString()
  });
  await redisPipeline([
    ['SET', `${DEVICE_KEY_PREFIX}${device.deviceId}`, payload],
    ['SADD', DEVICE_SET_KEY, device.deviceId]
  ]);
}

async function removeDevice(deviceId) {
  if (!deviceId) return;
  await redisPipeline([
    ['DEL', `${DEVICE_KEY_PREFIX}${deviceId}`],
    ['SREM', DEVICE_SET_KEY, deviceId]
  ]);
}

async function listDevices() {
  const [ids] = await redisPipeline([['SMEMBERS', DEVICE_SET_KEY]]);
  if (!Array.isArray(ids) || !ids.length) return [];

  const keys = ids.map(id => `${DEVICE_KEY_PREFIX}${id}`);
  const [records] = await redisPipeline([['MGET', ...keys]]);
  return (records || [])
    .filter(Boolean)
    .map(record => {
      try {
        return JSON.parse(record);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  redisConfig,
  saveDevice,
  removeDevice,
  listDevices
};
