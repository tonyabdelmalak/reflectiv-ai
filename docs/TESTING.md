# Chat Widget Testing

## Manual browser test plan

1. Open the site and confirm only one floating chat bubble appears.
2. Open DevTools Network and reload the page.
3. Verify `GET /assets/chat/config.json` returns `200`.
4. Verify `GET /assets/chat/system.md` returns `200`.
5. Open the widget and confirm the greeting renders.
6. Send a prompt and verify `POST /chat` returns `200` with `{ "content": "..." }`.
7. If the request is blocked, confirm `ALLOWED_ORIGINS` in Cloudflare includes the deployed site origin.

## Curl test

Run the command from `scripts/curl-test.txt`:

```bash
curl -X POST https://my-chat-agent.tonyabdelmalak.workers.dev/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"llama3-8b-8192","messages":[{"role":"user","content":"Say hello in one short sentence."}]}'
```

## Rollback

1. Revert the commits from this change set.
2. Redeploy the previously working Cloudflare Worker.
3. Clear CDN/browser caches if the old widget assets are still cached.
