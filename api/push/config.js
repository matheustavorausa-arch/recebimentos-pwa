const { pushConfig } = require('../_lib/webpush');
const { redisConfig } = require('../_lib/storage');

module.exports = function handler(request, response) {
  const push = pushConfig();
  const redis = redisConfig();

  response.status(200).json({
    enabled: push.ready && redis.ready,
    publicKey: push.publicKey || '',
    needs: {
      vapid: !push.ready,
      storage: !redis.ready
    }
  });
};
