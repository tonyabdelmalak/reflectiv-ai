# Chat Widget Integration

## Live asset map

The production chat widget now loads only the following files from `assets/chat/`:

- `/assets/chat/widget.js`
- `/assets/chat/widget.css`
- `/assets/chat/config.json`
- `/assets/chat/system.md`

The browser widget fetches `config.json` and `system.md` at runtime, then sends non-streaming chat requests to the Groq-backed Cloudflare Worker proxy.

## Global HTML include

Add the widget to every page with exactly these tags:

```html
<link rel="stylesheet" href="/assets/chat/widget.css">
<script src="/assets/chat/widget.js" data-chat="enabled" defer></script>
```

## Cloudflare Worker

Worker source lives in `/cloudflare-worker/` so it is not served by GitHub Pages.

### Required variables

- `GROQ_API_KEY`
- `ALLOWED_ORIGINS=https://tonyabdelmalak.github.io`

You can temporarily widen `ALLOWED_ORIGINS` while debugging, but lock it back down before production use.

## Request contract

`POST /chat`

```json
{
  "model": "llama3-8b-8192",
  "messages": [
    { "role": "user", "content": "Say hello." }
  ],
  "temperature": 0.2
}
```

Response:

```json
{ "content": "Hello there." }
```
