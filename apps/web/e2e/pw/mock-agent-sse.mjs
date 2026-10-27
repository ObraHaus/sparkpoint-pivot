#!/usr/bin/env node
/**
 * 059/A2 — a tiny local agent that STREAMS `/chat` SSE, for the mocked Playwright spec.
 *
 * `route.fulfill` in Playwright delivers the whole body at once, which makes the provisional
 * "painting" state unobservable. This server writes frames with real delays instead, so the app's
 * BFF proxies a genuinely incremental stream and the browser can render the first token before
 * the answer is complete. It never talks to beta or an LLM.
 *
 *   PW_MOCK_AGENT_PORT=4319 node e2e/pw/mock-agent-sse.mjs
 *   AGENT_INTERNAL_URL=http://127.0.0.1:4319 PW_MOCK_AGENT=1 pnpm exec playwright test e2e/pw/chat-streaming.spec.ts
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PW_MOCK_AGENT_PORT || 4319);
const ANSWER = "Hello from the streamed answer.";

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "POST" && url.pathname.endsWith("/chat")) {
    // Drain the small JSON request body before answering.
    req.resume();
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "content-encoding": "identity",
      connection: "keep-alive",
    });
    res.write(
      sse("block", { type: "tool_step", label: "Thinking that through", status: "running" }),
    );
    const chunks = ["Hello ", "from the ", "streamed ", "answer."];
    for (const delta of chunks) {
      await sleep(250);
      res.write(sse("text-delta", { target: "text", delta, streamId: "general-1" }));
    }
    await sleep(400);
    res.write(sse("block", { type: "tool_step", label: "Thinking that through", status: "done" }));
    res.write(sse("block", { type: "text", markdown: ANSWER }));
    res.write(sse("done", { conversationId: "cnv_stream", blockCount: 3 }));
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname.endsWith("/conversations")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ conversations: [], total: 0 }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock agent SSE listening on http://127.0.0.1:${PORT}`);
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
