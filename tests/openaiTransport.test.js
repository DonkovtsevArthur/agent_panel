const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  OpenAICompatibleClient,
  shouldContinueAfterLength,
  formatApiErrorDetail,
  getOrCreateHttpAgent,
  getOpenAICompatibleClient,
  resetTransportPools,
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

function writeJson(res, content = "ok", finishReason = "stop") {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content },
          finish_reason: finishReason,
        },
      ],
    })
  );
}

function writeSse(res, content = "ok") {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: { content }, finish_reason: null }],
    })}\n\n`
  );
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }],
    })}\n\n`
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

test("chatCompletions prefers SSE stream when gateway supports it", async () => {
  let requests = 0;
  await withServer(async (req, res) => {
    requests += 1;
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    assert.equal(parsed.stream, true);
    assert.equal(parsed.model, "DeepSeek-V4-Flash");
    writeSse(res, "hello-stream");
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions({
      model: "DeepSeek-V4-Flash",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(result.message.content, "hello-stream");
    assert.equal(requests, 1);
  });
});

test("chatCompletions falls back to JSON when SSE is empty", async () => {
  let requests = 0;
  await withServer(async (req, res) => {
    requests += 1;
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    if (parsed.stream === true) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    assert.equal("stream" in parsed, false);
    writeJson(res, "hello-json");
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions({
      model: "DeepSeek-V4-Flash",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(result.message.content, "hello-json");
    assert.equal(requests, 2);
  });
});

test("chatCompletions does not JSON-fallback when SSE had reasoning only", async () => {
  let requests = 0;
  let reasoningDeltas = 0;
  await withServer(async (req, res) => {
    requests += 1;
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    assert.equal(parsed.stream, true);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({
        choices: [
          {
            delta: { reasoning_content: "thinking about the version" },
          },
        ],
      })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions(
      {
        model: "Kimi-K2.5",
        messages: [{ role: "user", content: "hello" }],
      },
      undefined,
      {
        onDelta: (delta) => {
          if (delta.reasoning_content) {
            reasoningDeltas += 1;
          }
        },
      }
    );
    assert.equal(result.message.reasoning_content, "thinking about the version");
    assert.equal(requests, 1);
    assert.equal(reasoningDeltas, 1);
  });
});

test("chatCompletions recovers Kimi reasoning via JSON when SSE omits it", async () => {
  let requests = 0;
  let reasoningDeltas = 0;
  let contentDeltas = 0;
  await withServer(async (req, res) => {
    requests += 1;
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    if (parsed.stream === true) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: { content: "final answer" }, finish_reason: null }],
        })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
        })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    assert.equal("stream" in parsed, false);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "final answer",
              reasoning_content: "the real reasoning",
            },
            finish_reason: "stop",
          },
        ],
      })
    );
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions(
      {
        model: "Kimi-K2.5",
        messages: [{ role: "user", content: "hello" }],
      },
      undefined,
      {
        onDelta: (delta) => {
          if (delta.reasoning_content) {
            reasoningDeltas += 1;
          }
          if (delta.content) {
            contentDeltas += 1;
          }
        },
      }
    );
    assert.equal(result.message.content, "final answer");
    assert.equal(result.message.reasoning_content, "the real reasoning");
    assert.equal(requests, 2);
    assert.equal(reasoningDeltas, 1);
    assert.equal(contentDeltas, 1);
  });
});

test("chatCompletions does not JSON-fallback for non-Kimi when SSE has content", async () => {
  let requests = 0;
  await withServer(async (req, res) => {
    requests += 1;
    await readBody(req);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "hi" }, finish_reason: null }],
      })}\n\n`
    );
    res.write(
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
      })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions({
      model: "DeepSeek-V4-Flash",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(result.message.content, "hi");
    assert.equal(requests, 1);
  });
});

test("chatCompletions sends reasoning_effort when provided in the request", async () => {
  let capturedBody = null;
  await withServer(async (req, res) => {
    capturedBody = await readBody(req);
    writeSse(res, "ok");
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
    });
    assert.equal(result.message.content, "ok");
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.reasoning_effort, "high");
  });
});

test("chatCompletions parses `reasoning` field alias from SSE deltas", async () => {
  let reasoningDeltas = 0;
  await withServer(async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({
        choices: [{ delta: { reasoning: "claude is thinking" }, finish_reason: null }],
      })}\n\n`
    );
    res.write(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "answer" }, finish_reason: null }],
      })}\n\n`
    );
    res.write(
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
      })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions(
      {
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: "hello" }],
        reasoning_effort: "high",
      },
      undefined,
      {
        onDelta: (delta) => {
          if (delta.reasoning_content) {
            reasoningDeltas += 1;
          }
        },
      }
    );
    assert.equal(result.message.content, "answer");
    assert.equal(result.message.reasoning_content, "claude is thinking");
    assert.equal(reasoningDeltas, 1);
  });
});

test("chatCompletions prefers reasoning_content and does not duplicate when both fields present", async () => {
  await withServer(async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              reasoning_content: "primary",
              reasoning: "alias-should-be-ignored",
            },
          },
        ],
      })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(result.message.reasoning_content, "primary");
  });
});

test("chatCompletions omits temperature for Claude reasoning models", async () => {
  let capturedBody = null;
  await withServer(async (req, res) => {
    capturedBody = await readBody(req);
    writeSse(res, "ok");
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.2,
      reasoning_effort: "high",
    });
    assert.equal(result.message.content, "ok");
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.reasoning_effort, "high");
    assert.equal("temperature" in parsed, false);
  });
});

test("chatCompletions omits reasoning_effort when not provided", async () => {
  let capturedBody = null;
  await withServer(async (req, res) => {
    capturedBody = await readBody(req);
    writeSse(res, "ok");
  }, async (baseUrl) => {
    await client(baseUrl, { maxAttempts: 1 }).chatCompletions({
      model: "DeepSeek-V4-Flash",
      messages: [{ role: "user", content: "hello" }],
    });
    const parsed = JSON.parse(capturedBody);
    assert.equal("reasoning_effort" in parsed, false);
  });
});

test("chatCompletions retries retryable HTTP errors on stream then surfaces", async () => {
  let requests = 0;
  await withServer(async (req, res) => {
    requests += 1;
    await readBody(req);
    res.writeHead(429);
    res.end("busy");
  }, async (baseUrl) => {
    await assert.rejects(
      client(baseUrl, { maxAttempts: 2 }).chatCompletions({
        model: "test",
        messages: [{ role: "user", content: "hello" }],
      }),
      /API 429/
    );
    assert.equal(requests, 2);
  });
});

test("chatCompletions does not retry permanent HTTP errors", async () => {
  let requests = 0;
  await withServer(async (req, res) => {
    requests += 1;
    await readBody(req);
    res.writeHead(400);
    res.end("bad request");
  }, async (baseUrl) => {
    await assert.rejects(
      client(baseUrl, { maxAttempts: 3 }).chatCompletions({
        model: "test",
        messages: [{ role: "user", content: "hello" }],
      }),
      /API 400/
    );
    assert.equal(requests, 1);
  });
});

test("length continuation policy is bounded", () => {
  assert.equal(shouldContinueAfterLength("length", 0, 2), true);
  assert.equal(shouldContinueAfterLength("length", 1, 2), true);
  assert.equal(shouldContinueAfterLength("length", 2, 2), false);
  assert.equal(shouldContinueAfterLength("stop", 0, 2), false);
});

test("gpt-4.1 streams when SSE works", async () => {
  let requests = 0;
  await withServer(async (req, res) => {
    requests += 1;
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    assert.equal(parsed.stream, true);
    writeSse(res, "stream first");
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions({
      model: "gpt-4.1",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(result.message.content, "stream first");
    assert.equal(requests, 1);
  });
});

test("Qwen streams with tools and temperature", async () => {
  let requests = 0;
  await withServer(async (req, res) => {
    requests += 1;
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    assert.equal(parsed.stream, true);
    assert.equal(parsed.model, "Qwen3-Coder-Next");
    assert.equal(parsed.max_tokens, 8192);
    assert.equal(parsed.temperature, 0.2);
    assert.equal(parsed.tool_choice, "auto");
    assert.ok(Array.isArray(parsed.tools));
    writeSse(res, "stream ok");
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions({
      model: "Qwen3-Coder-Next",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "read",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      tool_choice: "auto",
      temperature: 0.2,
      max_tokens: 8192,
    });
    assert.equal(result.message.content, "stream ok");
    assert.equal(requests, 1);
  });
});

test("all models fail once on 500 with maxAttempts 1", async () => {
  for (const model of ["gpt-4.1", "DeepSeek-V4-Flash", "Qwen3-Coder-Next"]) {
    let requests = 0;
    await withServer(async (req, res) => {
      requests += 1;
      await readBody(req);
      res.writeHead(500);
      res.end("boom");
    }, async (baseUrl) => {
      await assert.rejects(
        client(baseUrl, { maxAttempts: 1 }).chatCompletions({
          model,
          messages: [{ role: "user", content: "hello" }],
        }),
        /API 500/
      );
      assert.equal(requests, 1);
    });
  }
});

test("formatApiErrorDetail extracts API body", () => {
  assert.match(
    formatApiErrorDetail(new Error("API 500: upstream timeout xyz")),
    /API 500: upstream timeout/
  );
  assert.equal(formatApiErrorDetail(new Error("plain")), "");
});

test("getOrCreateHttpAgent reuses keep-alive agent for same host", () => {
  resetTransportPools();
  const tls = { rejectUnauthorized: true };
  const a = getOrCreateHttpAgent("http://127.0.0.1:9/v1", tls);
  const b = getOrCreateHttpAgent("http://127.0.0.1:9/v1", tls);
  assert.equal(a, b);
});

test("pooled client still completes sequential chatCompletions", async () => {
  let requests = 0;
  await withServer(async (req, res) => {
    requests += 1;
    await readBody(req);
    writeSse(res, `n${requests}`);
  }, async (baseUrl) => {
    resetTransportPools();
    const pooled = getOpenAICompatibleClient(baseUrl, "k", {
      rejectUnauthorized: true,
    });
    const first = await pooled.chatCompletions({
      model: "m",
      messages: [{ role: "user", content: "a" }],
    });
    const second = await pooled.chatCompletions({
      model: "m",
      messages: [{ role: "user", content: "b" }],
    });
    assert.equal(first.message.content, "n1");
    assert.equal(second.message.content, "n2");
    assert.equal(requests, 2);
  });
});
