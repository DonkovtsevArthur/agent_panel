const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  OpenAICompatibleClient,
  shouldContinueAfterLength,
} = require("../out/openaiClient.js");

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

function client(baseUrl, retry = {}) {
  return new OpenAICompatibleClient(
    baseUrl,
    "test-key",
    { rejectUnauthorized: true },
    { baseDelayMs: 1, maxDelayMs: 2, jitterRatio: 0, ...retry }
  );
}

function writeSse(res, finishReason = "stop") {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(
    `data: ${JSON.stringify({
      choices: [{ delta: { content: "ok" }, finish_reason: finishReason }],
    })}\n\ndata: [DONE]\n\n`
  );
}

test("chat completion retries 429 and preserves streaming finish_reason", async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    if (requests === 1) {
      res.writeHead(429);
      res.end("busy");
      return;
    }
    writeSse(res, "length");
  }, async (baseUrl) => {
    const result = await client(baseUrl).chatCompletions({
      model: "test",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(result.message.content, "ok");
    assert.equal(result.finishReason, "length");
    assert.equal(requests, 2);
  });
});

test("chat completion retries a network reset before any SSE output", async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    if (requests === 1) {
      req.socket.destroy();
      return;
    }
    writeSse(res);
  }, async (baseUrl) => {
    const result = await client(baseUrl).chatCompletions({
      model: "test",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(result.message.content, "ok");
    assert.equal(requests, 2);
  });
});

test("non-stream fallback preserves finish_reason", async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    if (requests === 1) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "fallback" },
            finish_reason: "length",
          },
        ],
      })
    );
  }, async (baseUrl) => {
    const result = await client(baseUrl).chatCompletions({
      model: "test",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(result.message.content, "fallback");
    assert.equal(result.finishReason, "length");
    assert.equal(requests, 2);
  });
});

test("chat completion does not retry permanent HTTP errors", async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    res.writeHead(400);
    res.end("bad request");
  }, async (baseUrl) => {
    await assert.rejects(
      client(baseUrl).chatCompletions({
        model: "test",
        messages: [{ role: "user", content: "hello" }],
      }),
      /API 400/
    );
    assert.equal(requests, 1);
  });
});

test("abort signal cancels retry backoff", async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    res.writeHead(503);
    res.end("temporarily unavailable");
  }, async (baseUrl) => {
    const controller = new AbortController();
    const pending = client(baseUrl, {
      baseDelayMs: 1_000,
      maxDelayMs: 1_000,
    }).chatCompletions(
      {
        model: "test",
        messages: [{ role: "user", content: "hello" }],
      },
      controller.signal
    );
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, /aborted/i);
    assert.equal(requests, 1);
  });
});

test("length continuation policy is bounded", () => {
  assert.equal(shouldContinueAfterLength("length", 0, 2), true);
  assert.equal(shouldContinueAfterLength("length", 1, 2), true);
  assert.equal(shouldContinueAfterLength("length", 2, 2), false);
  assert.equal(shouldContinueAfterLength("stop", 0, 2), false);
});
