# Testing

## Widget smoke test
1. Load the site in a browser.
2. Ensure network tab shows `200` for `/assets/chat/config.json` and `/assets/chat/system.md`.
3. Send a message; confirm POST `https://my-chat-agent.tonyabdelmalak.workers.dev/chat` returns `200` with `{ "content": "..." }`.

## Curl test
Run the canned request:

```
curl -X POST https://my-chat-agent.tonyabdelmalak.workers.dev/chat \
  -H "Content-Type: application/json" \
 -d '{"model":"llama3-8b-8192","messages":[{"role":"user","content":"Say hello in one short sentence."}]}'
```

If you see a browser CORS failure, set `ALLOWED_ORIGINS` in Cloudflare to include your site origin (for testing, `*` is allowed but not recommended for production).
