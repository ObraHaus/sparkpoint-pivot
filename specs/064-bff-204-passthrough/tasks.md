# Tasks — 064 BFF 204 passthrough

- [x] **T6401** Add `proxyResponse` helper: null-body status set, `new Response(null, …)`, buffered
      + SSE builders.
- [x] **T6402** Route the BFF buffered branch through it (204/205/304 never pass a body) and keep
      the SSE path byte-for-byte unchanged.
- [x] **T6403** Confirm `AgentClient.request` returns `undefined` for 204/205 without parsing; pin
      with a test.
- [x] **T6404** Unit tests: 204 → 204 empty body, 200 JSON unchanged, 429 unchanged, SSE unchanged,
      client 204/205.
- [x] **T6405** Run web tests, typecheck and lint; spec artifacts + both changelogs.
- [x] **T6406** Commit/push, open PR to `main`.
