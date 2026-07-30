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

test("main-like chat completion returns JSON without stream field", async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal("stream" in parsed, false);
      assert.equal(parsed.model, "DeepSeek-V4-Flash");
      writeJson(res, "hello-main");
    });
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions({
      model: "DeepSeek-V4-Flash",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(result.message.content, "hello-main");
    assert.equal(requests, 1);
  });
});

test("main-like chat completion does not retry HTTP errors", async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    res.writeHead(429);
    res.end("busy");
  }, async (baseUrl) => {
    await assert.rejects(
      client(baseUrl).chatCompletions({
        model: "test",
        messages: [{ role: "user", content: "hello" }],
      }),
      /API 429/
    );
    assert.equal(requests, 1);
  });
});

test("main-like chat completion does not retry permanent HTTP errors", async () => {
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

test("length continuation policy is bounded", () => {
  assert.equal(shouldContinueAfterLength("length", 0, 2), true);
  assert.equal(shouldContinueAfterLength("length", 1, 2), true);
  assert.equal(shouldContinueAfterLength("length", 2, 2), false);
  assert.equal(shouldContinueAfterLength("stop", 0, 2), false);
});

test("gpt-4.1 uses main-like body without stream field", async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal("stream" in parsed, false);
      writeJson(res, "non-stream first");
    });
  }, async (baseUrl) => {
    const result = await client(baseUrl, { maxAttempts: 1 }).chatCompletions({
      model: "gpt-4.1",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(result.message.content, "non-stream first");
    assert.equal(requests, 1);
  });
});

test("Qwen uses main-like body without stream field", async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal("stream" in parsed, false);
      assert.equal(parsed.model, "Qwen3-Coder-Next");
      assert.equal(parsed.max_tokens, 8192);
      assert.equal(parsed.temperature, 0.2);
      assert.equal(parsed.tool_choice, "auto");
      assert.ok(Array.isArray(parsed.tools));
      writeJson(res, "main-like ok");
    });
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
    assert.equal(result.message.content, "main-like ok");
    assert.equal(requests, 1);
  });
});

test("all models fail once on 500 without stream fallback", async () => {
  for (const model of ["gpt-4.1", "DeepSeek-V4-Flash", "Qwen3-Coder-Next"]) {
    let requests = 0;
    await withServer((req, res) => {
      requests += 1;
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        assert.equal("stream" in parsed, false);
        res.writeHead(500);
        res.end("boom");
      });
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
  const b = getOrCreateHttpAgent("http://127.0.0.1:9/v1/chat", tls);
  assert.equal(a, b);
  assert.equal(a.options.keepAlive, true);
  const c = getOrCreateHttpAgent("http://127.0.0.1:10/v1", tls);
  assert.notEqual(a, c);
  const d = getOrCreateHttpAgent("http://127.0.0.1:9/v1", {
    rejectUnauthorized: false,
  });
  assert.notEqual(a, d);
  resetTransportPools();
});

test("getOpenAICompatibleClient reuses client for same endpoint", () => {
  resetTransportPools();
  const tls = { rejectUnauthorized: true };
  const a = getOpenAICompatibleClient("http://example.test/v1", "k1", tls);
  const b = getOpenAICompatibleClient("http://example.test/v1", "k1", tls);
  assert.equal(a, b);
  const c = getOpenAICompatibleClient("http://example.test/v1", "k2", tls);
  assert.notEqual(a, c);
  resetTransportPools();
});

test("pooled client still completes sequential chatCompletions", async () => {
  resetTransportPools();
  let requests = 0;
  await withServer((req, res) => {
    requests += 1;
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal("stream" in parsed, false);
      writeJson(res, `hello-${requests}`);
    });
  }, async (baseUrl) => {
    const tls = { rejectUnauthorized: true };
    const pooled = getOpenAICompatibleClient(baseUrl, "test-key", tls);
    const first = await pooled.chatCompletions({
      model: "test",
      messages: [{ role: "user", content: "a" }],
    });
    const second = await pooled.chatCompletions({
      model: "test",
      messages: [{ role: "user", content: "b" }],
    });
    assert.equal(first.message.content, "hello-1");
    assert.equal(second.message.content, "hello-2");
    assert.equal(requests, 2);
    assert.equal(
      getOpenAICompatibleClient(baseUrl, "test-key", tls),
      pooled
    );
  });
  resetTransportPools();
});
