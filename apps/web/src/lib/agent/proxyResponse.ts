/**
 * Rebuilds upstream agent responses for the BFF proxy (064).
 *
 * The proxy relays the agent's status + body verbatim. Some agent endpoints legitimately answer
 * with a NULL-BODY status — notably `POST /chat/feedback`, which stores the rating and returns
 * `204 No Content`. The Fetch `Response` constructor rejects any body (even an empty `ArrayBuffer`
 * or a stream) for those statuses with
 * `TypeError: Response constructor: Invalid response status code 204`, which surfaced to the
 * browser as a 500 on a successful thumbs rating.
 *
 * So for null-body statuses we always construct `new Response(null, …)`: no body, and no
 * `content-length` / (where it is meaningless) `content-type`. Every other status is relayed
 * unchanged. SSE passthrough shares the same header set it always used and is untouched.
 */

/** Statuses that MUST NOT carry a body (Fetch spec §Response, null body statuses). */
export const NULL_BODY_STATUSES = [101, 103, 204, 205, 304] as const;
const NULL_BODY_STATUS_SET: ReadonlySet<number> = new Set(NULL_BODY_STATUSES);

/** True iff `status` is a null-body status (101, 103, 204, 205, 304). */
export function isNullBodyStatus(status: number): boolean {
  return NULL_BODY_STATUS_SET.has(status);
}

/**
 * A body-less response for a null-body status. `content-length` is always dropped (it would
 * describe a body that does not exist); `content-type` is dropped for 204/205, where it is
 * meaningless. A 304 may keep representation headers (they describe the cached entity).
 */
export function nullBodyResponse(status: number, headers?: HeadersInit): Response {
  const out = new Headers(headers);
  out.delete("content-length");
  if (status === 204 || status === 205) out.delete("content-type");
  return new Response(null, { status, headers: out });
}

export interface BufferedUpstream {
  status: number;
  /** Upstream body, already read. Ignored entirely for null-body statuses. */
  body: ArrayBuffer;
  /** Upstream `content-type`, when present. */
  contentType?: string | null;
  /** Upstream `Retry-After`, when present. */
  retryAfter?: string | null;
}

/**
 * Build the buffered (non-SSE) proxy response. The JSON body + status are relayed verbatim, except
 * a null-body status is returned with `null` — never the (possibly empty) upstream buffer.
 */
export function bufferedUpstreamResponse(upstream: BufferedUpstream): Response {
  if (isNullBodyStatus(upstream.status)) {
    const headers = new Headers();
    if (upstream.contentType) headers.set("content-type", upstream.contentType);
    if (upstream.retryAfter !== null && upstream.retryAfter !== undefined) {
      headers.set("retry-after", upstream.retryAfter);
    }
    return nullBodyResponse(upstream.status, headers);
  }

  const headers = new Headers();
  if (upstream.contentType) headers.set("content-type", upstream.contentType);
  if (upstream.retryAfter !== null && upstream.retryAfter !== undefined) {
    headers.set("retry-after", upstream.retryAfter);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

/** The headers every SSE passthrough response carries (unchanged by 064). */
export const SSE_PASSTHROUGH_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  // Defeat proxy/response buffering so events flush as they arrive.
  "x-accel-buffering": "no",
  // 036 — declare the body already encoded, which is what actually stops buffering.
  //
  // `no-transform` and `x-accel-buffering` were both already set, and the stream was STILL being
  // buffered end-to-end for every browser (measured against the live deployment: with a browser's
  // `Accept-Encoding: gzip, deflate, br` every event arrived at 21.2s instead of incrementally).
  // `identity` says the body is already in its final encoding, so nothing downstream may re-encode
  // (and therefore buffer) it. Compression stays on for every other response.
  "content-encoding": "identity",
} as const;

/** Build the streaming SSE passthrough response (body relayed untouched, as before). */
export function sseUpstreamResponse(
  stream: ReadableStream<Uint8Array>,
  status: number,
): Response {
  return new Response(stream, {
    status,
    headers: { ...SSE_PASSTHROUGH_HEADERS },
  });
}
