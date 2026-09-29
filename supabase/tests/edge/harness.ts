// Harness for running the real edge functions (supabase/functions/*/index.ts) in
// Deno against a scratch Postgres behind a real PostgREST (db-max-rows = 1000,
// like the hosted project), with the real supabase-js client. run.sh starts
// Postgres + PostgREST and passes:
//   WTC_PGRST_URL      PostgREST base URL
//   WTC_JWT_SECRET     PostgREST's jwt-secret (a service_role JWT is minted here)
//   WTC_FUNCTIONS_DIR  the functions directory under test
//   WTC_PSQL_ARGS      psql connection args for the same database
// The import map swaps std/http/server.ts for stub-serve.ts, so importing a
// function registers its handler instead of listening. Local testing only.

type Handler = (req: Request) => Response | Promise<Response>;

function env(k: string): string {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`run via supabase/tests/run.sh (missing ${k})`);
  return v;
}

// ── Fixed clock: 2026-03-12T15:00:00Z (11:00 EDT, 00:00 JST on 03-13) ───────
export const NOW_ISO = "2026-03-12T15:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...args: unknown[]) {
    // @ts-ignore: forward whatever Date accepts
    if (args.length === 0) super(NOW); else super(...args);
  }
  static override now() { return NOW; }
}
globalThis.Date = FakeDate as DateConstructor;

// ── Network guard: nothing leaves this machine ───────────────────────────────
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    return Promise.reject(new Error(`blocked non-local fetch to ${url.host}`));
  }
  return realFetch(input, init);
}) as typeof fetch;

// ── /rest/v1 → PostgREST proxy (supabase-js prefixes /rest/v1) ──────────────
const upstream = env("WTC_PGRST_URL");
const proxy = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
  const u = new URL(req.url);
  if (!u.pathname.startsWith("/rest/v1")) return new Response("not found", { status: 404 });
  const headers = new Headers(req.headers);
  headers.delete("host");
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  const res = await realFetch(upstream + u.pathname.slice("/rest/v1".length) + u.search, {
    method: req.method, headers, body,
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
});

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function mintJwt(secret: string, payload: Record<string, unknown>): Promise<string> {
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const data = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return `${data}.${b64url(sig)}`;
}

Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${proxy.addr.port}`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", await mintJwt(env("WTC_JWT_SECRET"), { role: "service_role" }));
Deno.env.delete("RESEND_API_KEY"); // report-monthly must never try to email from a test

// ── Loading and calling a function ──────────────────────────────────────────
const handlers = new Map<string, Handler>();
async function handler(name: string): Promise<Handler> {
  const cached = handlers.get(name);
  if (cached) return cached;
  const path = `${env("WTC_FUNCTIONS_DIR")}/${name}/index.ts`;
  await import(new URL(`file://${path}`).href);
  const g = globalThis as { __wtcHandler?: Handler };
  if (!g.__wtcHandler) throw new Error(`${name} did not call serve()`);
  handlers.set(name, g.__wtcHandler);
  delete g.__wtcHandler;
  return handlers.get(name)!;
}

export interface CallResult { status: number; json: any; text: string }

export async function call(name: string, opts: {
  method?: string; query?: Record<string, string>; headers?: Record<string, string>;
  body?: BodyInit | null;
} = {}): Promise<CallResult> {
  const h = await handler(name);
  const qs = new URLSearchParams(opts.query || {}).toString();
  const req = new Request(`http://127.0.0.1/functions/v1/${name}${qs ? `?${qs}` : ""}`, {
    method: opts.method || "GET", headers: opts.headers || {}, body: opts.body ?? null,
  });
  const res = await h(req);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text };
}

// ── psql against the same database ──────────────────────────────────────────
export async function sql(query: string): Promise<string> {
  const args = [...env("WTC_PSQL_ARGS").split(" "), "-v", "ON_ERROR_STOP=1", "-AtqX", "-c", query];
  const out = await new Deno.Command("psql", { args, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout).trim();
}

// ── Tiny assertions (no remote test deps) ───────────────────────────────────
export function eq(got: unknown, want: unknown, what = "") {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error(`${what}: got ${g}, want ${w}`);
}
export function ok(cond: unknown, what = "") {
  if (!cond) throw new Error(`${what}: expected truthy`);
}

// Tests share the proxy and module state; skip Deno's per-test leak sanitizers.
export function test(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}
