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
