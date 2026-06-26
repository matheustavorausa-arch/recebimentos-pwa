# Recebimentos Semanais

PWA simples para controle de recebimentos recorrentes. Os dados ficam somente no `localStorage` do navegador.

## Executar localmente

O Service Worker exige HTTP/HTTPS. Na pasta do projeto, use uma das opções:

```powershell
python -m http.server 8080
```

Depois abra `http://localhost:8080` no navegador.

## Instalar no iPhone

Publique a pasta em um endereço HTTPS, abra o site no Safari, toque em **Compartilhar** e em **Adicionar à Tela de Início**.

## Estrutura

- `index.html` — interface
- `css/styles.css` — visual responsivo
- `js/app.js` — regras, histórico e localStorage
- `manifest.webmanifest` — instalação do PWA
- `service-worker.js` — funcionamento offline
- `icons/` — ícones do aplicativo

## Notificações push pelo Vercel

Esta versão já tem suporte a Web Push real para funcionar mesmo com o PWA fechado no iPhone, desde que o app esteja publicado no Vercel com as variáveis abaixo configuradas.

1. Publique este projeto no Vercel.
2. Crie/adicione um armazenamento Redis/KV no Vercel. O projeto usa `KV_REST_API_URL` e `KV_REST_API_TOKEN` ou `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.
3. Gere chaves VAPID com `npm run generate:vapid`.
4. Configure no Vercel:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` com um e-mail, por exemplo `mailto:seuemail@exemplo.com`
   - `CRON_SECRET`, opcional, para proteger o endpoint do cron
5. O cron está em `vercel.json` como `0 16 * * *`, horário UTC. No fuso America/Los_Angeles em junho, isso equivale a 9h.
6. No iPhone, abra o endereço HTTPS do Vercel pelo Safari, adicione à Tela de Início, abra pelo ícone instalado e toque em **Ativar**.

Observação: o app continua salvando os dados principais no `localStorage`. Para o push funcionar fechado, ele envia ao backend apenas um resumo do lembrete com a inscrição do dispositivo.
