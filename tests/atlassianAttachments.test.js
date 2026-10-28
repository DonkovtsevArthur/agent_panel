const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const {
  CONFLUENCE_NATIVE_TOOLS,
  CONFLUENCE_NATIVE_WRITE_TOOLS,
  createConfluenceNativeClient,
} = require("../out/mcp/confluenceNative.js");
const {
  JIRA_NATIVE_TOOLS,
  JIRA_NATIVE_WRITE_TOOLS,
  attachmentResult,
  createJiraNativeClient,
  isLoginUrl,
  isTextAttachment,
  isTextMediaType,
  jiraDownload,
} = require("../out/mcp/jiraNative.js");

const KEY = fs.readFileSync(path.join(__dirname, "fixtures/localhost-test-key.pem"));
const CERT = fs.readFileSync(path.join(__dirname, "fixtures/localhost-test-cert.pem"), "utf8");

/** Local HTTPS server answering `routes[path]` (fn(req, res)); requires Bearer tok unless `anonymous`. */
async function withServer(routes, fn, { anonymous = false } = {}) {
  const server = https.createServer({ key: KEY, cert: CERT }, (req, res) => {
    if (!anonymous && req.headers.authorization !== "Bearer tok") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "auth" }));
      return;
    }
    const pathname = new URL(req.url, "https://localhost").pathname;
    const route = routes[pathname];
    if (!route) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: `no route ${pathname}` }));
      return;
    }
    route(req, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const conn = { baseUrl: `https://localhost:${server.address().port}`, token: "tok", ca: CERT };
  try {
    return await fn(conn);
  } finally {
    server.close();
  }
}

const json = (body) => (_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

async function call(client, name, args) {
  const r = await client.callTool({ name, arguments: args });
  return { ...JSON.parse(r.content[0].text), isError: !!r.isError };
}

test("download tools are read tools with lookup params", () => {
  const cf = CONFLUENCE_NATIVE_TOOLS.find((t) => t.name === "confluence_download_attachment");
  const jira = JIRA_NATIVE_TOOLS.find((t) => t.name === "jira_download_attachment");
  assert.ok(cf && jira);
  assert.equal(CONFLUENCE_NATIVE_WRITE_TOOLS.has(cf.name), false);
  assert.equal(JIRA_NATIVE_WRITE_TOOLS.has(jira.name), false);
  for (const key of ["page_id", "space_key", "title", "filename", "attachment_id"]) {
    assert.ok(key in cf.inputSchema.properties, key);
  }
  for (const key of ["issue_key", "filename", "attachment_id"]) {
    assert.ok(key in jira.inputSchema.properties, key);
  }
});

test("isTextAttachment: by media type, extension, then content sniff", () => {
  const text = Buffer.from("# Заголовок\n\nтекст", "utf8");
  const bin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
  assert.equal(isTextAttachment("spec.md", "application/octet-stream", text), true);
  assert.equal(isTextAttachment("notes", "text/plain", text), true);
  assert.equal(isTextAttachment("data", "application/json", text), true);
  assert.equal(isTextAttachment("pic.png", "image/png", bin), false);
  assert.equal(isTextAttachment("doc.pdf", "application/pdf", text), false);
  assert.equal(isTextAttachment("blob", "application/octet-stream", bin), false);
  assert.equal(isTextAttachment("README", "", text), true);
  assert.equal(isTextAttachment("README", "", Buffer.from([0xff, 0xfe, 0x41])), false);
});

test("isTextAttachment: a Cyrillic char cut at the 8 KB sniff edge is still text", () => {
  const odd = Buffer.from("a" + "я".repeat(5000), "utf8");
  assert.equal(odd[8191] >= 0xc0, true, "fixture must split a character at 8192");
  assert.equal(isTextAttachment("README", "application/octet-stream", odd), true);
});

test("jiraDownload never sends the token to another host", async () => {
  const conn = { baseUrl: "https://confluence.example.com", token: "t", ca: [] };
  await assert.rejects(
    jiraDownload(conn, "https://evil.example.org/download/attachments/1/a.md", { maxBytes: 1024 }),
    /another host/
  );
});

test("jiraDownload follows same-host redirects and enforces the size limit", async () => {
  await withServer(
    {
      "/a": (_q, r) => {
        r.writeHead(302, { location: "/b" });
        r.end();
      },
      "/b": (_q, r) => r.end("hello"),
      "/big": (_q, r) => r.end(Buffer.alloc(4096, 65)),
    },
    async (conn) => {
      const got = await jiraDownload(conn, "/a", { maxBytes: 1024 });
      assert.equal(got.data.toString(), "hello");
      await assert.rejects(jiraDownload(conn, "/big", { maxBytes: 1024 }), /larger than/);
    }
  );
});

test("jiraDownload reports a redirect to the login page as a rejected token", async () => {
  await withServer(
    {
      "/download/x.md": (_q, r) => {
        r.writeHead(302, { location: "/login.action?os_destination=%2Fdownload%2Fx.md" });
        r.end();
      },
      "/login.action": (_q, r) => {
        r.setHeader("content-type", "text/html");
        r.end("<html>login</html>");
      },
    },
    async (conn) => {
      await assert.rejects(
        jiraDownload(conn, "/download/x.md", { maxBytes: 1024, label: "Confluence" }),
        (e) => e.status === 401 && /Confluence redirected the download to the login page/.test(e.message)
      );
    }
  );
});

test("confluence_download_attachment: text inline, binary to temp, errors branded", async () => {
  const atts = [
    {
      id: "a1",
      title: "Спека.md",
      extensions: { mediaType: "application/octet-stream" },
      _links: { download: "/download/attachments/42/spec.md?api=v2" },
    },
    {
      id: "a2",
      title: "pic.png",
      extensions: { mediaType: "image/png" },
      _links: { download: "/download/attachments/42/pic.png" },
    },
    { id: "a3", title: "gone.txt", extensions: {}, _links: { download: "/download/attachments/42/gone.txt" } },
  ];
  await withServer(
    {
      "/rest/api/content/42/child/attachment": (req, res) => {
        const q = new URL(req.url, "https://localhost").searchParams;
        const name = q.get("filename");
        json({ results: name ? atts.filter((a) => a.title === name) : atts })(req, res);
      },
      "/download/attachments/42/spec.md": (_q, r) => r.end("# Привет"),
      "/download/attachments/42/pic.png": (_q, r) => r.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1])),
    },
    async (conn) => {
      const client = createConfluenceNativeClient(conn);
      const md = await call(client, "confluence_download_attachment", { page_id: "42", filename: "спека.md" });
      assert.equal(md.content, "# Привет");
      assert.equal(md.page_id, "42");
      const png = await call(client, "confluence_download_attachment", { page_id: "42", filename: "pic.png" });
      assert.ok(png.saved_to && fs.readFileSync(png.saved_to).length === 6);
      const missing = await call(client, "confluence_download_attachment", { page_id: "42", filename: "nope" });
      assert.equal(missing.isError, true);
      assert.match(missing.error, /Available: Спека\.md, pic\.png/);
      const gone = await call(client, "confluence_download_attachment", { page_id: "42", filename: "gone.txt" });
      assert.match(gone.error, /^Confluence HTTP 404/);
    }
  );
});

test("jira_download_attachment: by issue + file name and by attachment id", async () => {
  const att = { id: "10500", filename: "ТЗ.md", mimeType: "text/markdown", content: "https://other-alias/secure/attachment/10500/x" };
  await withServer(
    {
      "/rest/api/2/issue/PROJ-1": json({ key: "PROJ-1", fields: { attachment: [att] } }),
      "/rest/api/2/attachment/10500": json(att),
      [`/secure/attachment/10500/${encodeURIComponent("ТЗ.md")}`]: (_q, r) => r.end("## ТЗ"),
    },
    async (conn) => {
      const client = createJiraNativeClient(conn);
      const byName = await call(client, "jira_download_attachment", { issue_key: "PROJ-1", filename: "тз.md" });
      assert.equal(byName.content, "## ТЗ");
      assert.equal(byName.issue_key, "PROJ-1");
      const byId = await call(client, "jira_download_attachment", { attachment_id: "10500" });
      assert.equal(byId.content, "## ТЗ");
      const missing = await call(client, "jira_download_attachment", { issue_key: "PROJ-1", filename: "x.png" });
      assert.match(missing.error, /not found on PROJ-1\. Available: ТЗ\.md/);
    }
  );
});

test("isTextMediaType: whole types and +json / +xml suffixes, not substrings", () => {
  assert.equal(isTextMediaType("text/plain; charset=utf-8"), true);
  assert.equal(isTextMediaType("application/json"), true);
  assert.equal(isTextMediaType("application/vnd.api+json"), true);
  assert.equal(isTextMediaType("image/svg+xml"), true);
  assert.equal(
    isTextMediaType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    false
  );
  assert.equal(isTextMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), false);
});

test("isTextAttachment: Office files (zip) are binary", () => {
  const zip = Buffer.from([0x50, 0x4b, 3, 4, 0x14, 0, 6, 0, 8, 0]);
  const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  assert.equal(isTextAttachment("ТЗ.docx", docx, zip), false);
  assert.equal(isTextAttachment("a.xlsx", xlsx, zip), false);
  assert.equal(isTextAttachment("a.pptx", pptx, zip), false);
});

test("isLoginUrl: sign-in endpoints only, not attachment names mentioning sso / login", () => {
  const u = (p) => new URL(`https://wiki.example.com${p}`);
  assert.equal(isLoginUrl(u("/download/attachments/42/SSO-design.md")), false);
  assert.equal(isLoginUrl(u("/secure/attachment/1/login-flow.png")), false);
  assert.equal(isLoginUrl(u("/docs/oauth-notes")), false);
  assert.equal(isLoginUrl(u("/login.action")), true);
  assert.equal(isLoginUrl(u("/wiki/login.jsp")), true);
  assert.equal(isLoginUrl(u("/plugins/servlet/samlsso")), true);
  assert.equal(isLoginUrl(u("/realms/corp/protocol/openid-connect/auth")), true);
});

test("jiraDownload: a redirect within attachment URLs named SSO-* still downloads", async () => {
  await withServer(
    {
      "/download/attachments/42/SSO-design.md": (_q, r) => {
        r.writeHead(302, { location: "/download/attachments/42/SSO-design.md/v2" });
        r.end();
      },
      "/download/attachments/42/SSO-design.md/v2": (_q, r) => r.end("sso"),
    },
    async (conn) => {
      const got = await jiraDownload(conn, "/download/attachments/42/SSO-design.md", { maxBytes: 1024 });
      assert.equal(got.data.toString(), "sso");
    }
  );
});

test("jiraDownload: cross-host redirect (object storage) is followed without the token", async () => {
  let seenAuth = "unset";
  await withServer(
    {
      "/bucket/obj": (q, r) => {
        seenAuth = q.headers.authorization;
        r.end("from s3");
      },
    },
    async (storage) => {
      const storageUrl = storage.baseUrl.replace("localhost", "127.0.0.1");
      await withServer(
        {
          "/secure/attachment/1/a.bin": (_q, r) => {
            r.writeHead(302, { location: `${storageUrl}/bucket/obj?sig=x` });
            r.end();
          },
          "/secure/attachment/2/b.bin": (_q, r) => {
            r.writeHead(302, { location: `${storageUrl.replace("https:", "http:")}/bucket/obj` });
            r.end();
          },
          "/secure/attachment/3/c.bin": (_q, r) => {
            r.writeHead(302, { location: `${storageUrl}/realms/corp/protocol/openid-connect/auth` });
            r.end();
          },
        },
        async (conn) => {
          const got = await jiraDownload(conn, "/secure/attachment/1/a.bin", { maxBytes: 1024 });
          assert.equal(got.data.toString(), "from s3");
          assert.equal(seenAuth, undefined);
          await assert.rejects(jiraDownload(conn, "/secure/attachment/2/b.bin", { maxBytes: 1024 }), /non-HTTPS/);
          await assert.rejects(
            jiraDownload(conn, "/secure/attachment/3/c.bin", { maxBytes: 1024 }),
            (e) => e.status === 401
          );
        }
      );
    },
    { anonymous: true }
  );
});

test("jiraDownload: an HTML page served in place of a non-HTML file is a rejected token", async () => {
  const html = (_q, r) => {
    r.setHeader("content-type", "text/html; charset=utf-8");
    r.end("<html>Log in</html>");
  };
  await withServer({ "/download/a.md": html, "/download/page.html": html }, async (conn) => {
    await assert.rejects(
      jiraDownload(conn, "/download/a.md", { maxBytes: 1024, label: "Confluence" }),
      (e) => e.status === 401 && /Confluence returned the login page/.test(e.message)
    );
    const page = await jiraDownload(conn, "/download/page.html", { maxBytes: 1024, expectHtml: true });
    assert.match(page.data.toString(), /Log in/);
  });
});

test("jiraDownload: Content-Length over the limit fails before reading the body", async () => {
  await withServer(
    {
      "/huge": (_q, r) => {
        r.writeHead(200, { "content-length": String(10 * 1024 * 1024) });
        r.write(Buffer.alloc(16));
        // never finishes — the client must give up on the header alone
      },
    },
    async (conn) => {
      await assert.rejects(jiraDownload(conn, "/huge", { maxBytes: 1024 * 1024 }), /larger than 1 MB/);
    }
  );
});

test("attachmentResult: binary goes to a fresh private temp dir, never overwritten", async () => {
  const bin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]);
  const a = await attachmentResult("jira", "10500", { title: "pic.png" }, "image/png", bin);
  const b = await attachmentResult("jira", "10500", { title: "pic.png" }, "image/png", bin);
  assert.notEqual(a.saved_to, b.saved_to);
  assert.equal(path.basename(a.saved_to), "pic.png");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.dirname(a.saved_to)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(a.saved_to).mode & 0o777, 0o600);
  }
  for (const f of [a.saved_to, b.saved_to]) {
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  }
});
