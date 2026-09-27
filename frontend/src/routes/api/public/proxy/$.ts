import { createFileRoute } from "@tanstack/react-router";

// The Mawzun backend does not send CORS headers for this app's origin, so all
// frontend API calls are relayed through this same-origin passthrough.
// Auth is enforced by the backend itself via the forwarded Authorization header.
// Local development relays to the backend running on this machine (npm run dev
// in api/). Or set VITE_API_PROXY_TARGET to point at a hosted origin
// only if you specifically need hosted data while developing.
const BACKEND_ORIGIN =
  (import.meta.env.VITE_API_PROXY_TARGET as string | undefined) ?? "http://localhost:5000";

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
]);

async function relay({ request, params }: { request: Request; params: { _splat?: string } }) {
  const incoming = new URL(request.url);
  const path = params._splat ?? "";
  const target = `${BACKEND_ORIGIN}/${path}${incoming.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("origin", BACKEND_ORIGIN);
  headers.set("referer", BACKEND_ORIGIN);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });

  const outHeaders = new Headers();
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "content-encoding") return;
    outHeaders.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: outHeaders,
  });
}

export const Route = createFileRoute("/api/public/proxy/$")({
  server: {
    handlers: {
      GET: relay,
      POST: relay,
      PUT: relay,
      PATCH: relay,
      DELETE: relay,
    },
  },
});
