# Previewing the Chat Widget Changes

Follow these steps to understand and validate the chat widget output before committing or deploying any updates.

## 1. Serve the Site Locally

Use any static file server. For example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in your browser.

## 2. Inspect Network Requests

1. Open the browser DevTools → **Network** tab.
2. Click the floating chat bubble to open the widget.
3. Confirm these requests succeed (status 200):
   - `GET /assets/chat/config.json`
   - `GET /assets/chat/system.md`

## 3. Send a Test Message

1. Type a short prompt in the widget.
2. Verify the worker call:
   - `POST https://my-chat-agent.tonyabdelmalak.workers.dev/chat`
   - Response payload should look like `{ "content": "…" }`.

If the worker is not reachable from your environment, you can mock the reply by opening DevTools → **Console** and running:

```js
window.dispatchEvent(new CustomEvent('ReflectivDebugReply', { detail: 'Mock reply to validate UI rendering.' }));
```

## 4. Run the cURL Smoke Test

From the repo root:

```bash
bash scripts/curl-test.txt
```

This prints the proxy response so you can confirm Groq is returning assistant content.

## 5. Review Console Warnings

The widget logs guard-rail events—auto-trim, double-send guard, or fallback prompts—as `[ReflectivAI] …`. Address any unexpected warnings before committing changes.
