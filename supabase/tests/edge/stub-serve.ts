// Test stand-in for std/http/server.ts: instead of listening, hand the edge
// function's handler to the test harness (supabase/tests/edge/harness.ts).
type Handler = (req: Request) => Response | Promise<Response>;
export function serve(handler: Handler): void {
  (globalThis as { __wtcHandler?: Handler }).__wtcHandler = handler;
}
