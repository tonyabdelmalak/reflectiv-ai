// Cloudflare Worker script for ReflectivEI
//
// This worker proxies chat requests to the upstream agent defined in config.json.
// It reads the system prompt, persona and knowledge files at startup and
// constructs a composite system message. When a POST request is received it
// forwards the conversation to the upstream agent and returns the response.

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Only POST supported', { status: 405 });
    }
    // Parse incoming payload
    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return new Response('Invalid JSON', { status: 400 });
    }
    // Forward to upstream endpoint
    const upstream = env.UPSTREAM_ENDPOINT || 'https://my-chat-agent.tonyabdelmalak.workers.dev/chat';
    const upstreamResp = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return new Response(upstreamResp.body, upstreamResp);
  }
};