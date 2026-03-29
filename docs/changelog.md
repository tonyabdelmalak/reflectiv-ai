# ReflectivAI Changelog

## 2026-03-20 — Chat widget + Groq worker cleanup

- Replaced the legacy root widget assets with a single production widget served from `assets/chat/`.
- Added a dedicated Cloudflare Worker project under `cloudflare-worker/` for the Groq `/chat` proxy.
- Archived duplicate root widget files and refreshed documentation plus curl-based test instructions.

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
