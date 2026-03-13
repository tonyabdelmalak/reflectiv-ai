# ReflectivAI Changelog

## 2025-01-15 — Groq-backed chat widget polish

- Confirmed the chat widget lives under `/assets/chat/` with the required HTML includes and merged defaults from `config.json`.
- Added a lightweight client-side rate limiter aligned to the `rateLimit` config value to protect the Worker.
- Documented the Groq proxy layout in `/cloudflare-worker/`, environment variables (`GROQ_API_KEY`, `ALLOWED_ORIGINS`), and updated testing guidance with a CORS note.

## 2025-10-09 — Initial Release

- Initial release of the ReflectivAI Sales Enablement Platform.
- Established site structure with `index.html`, `styles.css`, and `script.js`.
- Implemented the AI Coach Widget with two key training modes:
  - **Therapeutic Area Product Knowledge** – helps representatives refresh their understanding of key product information in different disease states.
  - **Sales Simulation** – allows reps to practice engaging with realistic HCP personas using AI-powered role-play scenarios.
- Added sample healthcare provider personas and integrated coach feedback logic.
- Published configuration and personas under `assets/chat/`, including `config.json` and `persona.json`, to support the widget.
- Included documentation under `/docs` for integration and maintenance workflows.

ReflectivAI will evolve with expanded therapeutic areas, adaptive coaching, enhanced analytics, and new language support.
