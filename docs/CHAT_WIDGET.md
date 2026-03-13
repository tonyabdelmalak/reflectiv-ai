# Chat Widget

- Live assets: `/assets/chat/widget.js`, `/assets/chat/widget.css`, `/assets/chat/config.json`, `/assets/chat/system.md`.
- The HTML layout should include:
  - `<link rel="stylesheet" href="/assets/chat/widget.css">`
  - `<script src="/assets/chat/widget.js" data-chat="enabled" defer></script>`
- `widget.js` fetches `/assets/chat/config.json` and `/assets/chat/system.md` plus scenarios from `/assets/chat/data/scenarios.merged.json` by default.
- Update `/assets/chat/config.json` for brand, greeting, and proxy URL; the Groq Worker must respond with `{ "content": "..." }`.
