import type { AddressInfo } from "node:net";

import app from "../../src/app.js";
import { closeRateLimitRedis } from "../../src/lib/rateLimit.js";
import { closeLogsPool } from "../../src/observability/errorCapture.js";

// Talks to the real application over HTTP.
//
// Middleware ordering, the error handler and the response envelope are all part
// of the contract the frontend depends on, and none of them is observable by
// calling a service function directly. These helpers exist so a test can assert
// on what a client would actually receive.

let server: ReturnType<typeof app.listen> | undefined;
let baseUrl = "";

export async function startServer(): Promise<string> {
  if (server) return baseUrl;

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => resolve());
    server.once("error", reject);
  });

  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return baseUrl;
}

export async function stopServer(): Promise<void> {
  if (server) {
    const closing = server;
    server = undefined;
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  }
  // Both of these own live sockets that outlive the requests they served. The
  // ioredis client reconnects forever by design, and the logs pool stays open
  // after its last query, so without closing them the test process never drains
  // and is killed with SIGTERM after every assertion has already passed.
  await closeRateLimitRedis();
  await closeLogsPool();
}

export interface ApiCall {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  token?: string;
  body?: unknown;
}

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T | null;
  code?: string;
  details?: unknown;
}

export interface ApiResult<T> {
  status: number;
  body: ApiEnvelope<T>;
}

export async function api<T = unknown>({ path, method = "GET", token, body }: ApiCall): Promise<ApiResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as ApiEnvelope<T>) : ({ success: response.ok, message: "", data: null } as ApiEnvelope<T>);

  return { status: response.status, body: parsed };
}
