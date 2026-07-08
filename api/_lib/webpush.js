const webpush = require('web-push');

function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  const ready = Boolean(publicKey && privateKey);

  if (ready) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  return { publicKey, privateKey, subject, ready };
}

function notificationFromSummary(summary = {}, kind = 'daily') {
  if (kind === 'evening') {
    return {
      title: 'Ganhos das 21h',
      body: summary.gainsEveningBody || 'Não esqueça de adicionar os ganhos de hoje.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'daily-earnings-evening',
      renotify: true,
      data: { url: '/' }
    };
  }

  const pendingCount = Number(summary.pendingCount || 0);
  const title = pendingCount ? 'Recebimentos das 9h' : 'Recebimentos em dia';
  const rentalBody = summary.body || (pendingCount
    ? `${pendingCount} pagamento${pendingCount === 1 ? '' : 's'} pendente${pendingCount === 1 ? '' : 's'}.`
    : 'Nenhum pagamento pendente. Tudo em dia!');
  const gainsBody = summary.gainsMorningBody ? ` ${summary.gainsMorningBody}` : '';
  const body = `${rentalBody}${gainsBody}`;

  return {
    title,
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'daily-payments',
    renotify: true,
    data: { url: '/' }
  };
}

module.exports = {
  webpush,
  pushConfig,
  notificationFromSummary
};
