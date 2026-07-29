const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseTsconfigPathsJson,
  extractImportSpecifiers,
  resolveImportCandidates,
  expandFileCandidates,
  formatPathAliasContext,
} = require("../out/projectPaths.js");

test("parseTsconfigPathsJson reads baseUrl and aliases", () => {
  const config = parseTsconfigPathsJson(
    `{
      "compilerOptions": {
        "baseUrl": ".",
        "paths": {
          "@shared/*": ["src/shared/*"],
          "@entities/*": ["src/entities/*"]
        }
      }
    }`,
    "tsconfig.json"
  );

  assert.ok(config);
  assert.equal(config.baseUrl, ".");
  assert.equal(config.aliases.length, 2);
  assert.match(formatPathAliasContext(config), /@shared\/\*/);
});

test("resolveImportCandidates maps aliases and relatives", () => {
  const config = parseTsconfigPathsJson(
    `{
      "compilerOptions": {
        "baseUrl": ".",
        "paths": { "@shared/*": ["src/shared/*"] }
      }
    }`
  );

  assert.deepEqual(
    resolveImportCandidates(
      "src/pages/foo/page.tsx",
      "@shared/ui/notification",
      config
    ),
    ["src/shared/ui/notification"]
  );
  assert.deepEqual(
    resolveImportCandidates(
      "src/entities/check/model.ts",
      "./toast-notification",
      config
    ),
    ["src/entities/check/toast-notification"]
  );
  assert.deepEqual(
    resolveImportCandidates("src/a.ts", "react", config),
    []
  );
});

test("extractImportSpecifiers finds from/import/require", () => {
  const specs = extractImportSpecifiers(`
    import x from '@shared/ui';
    import './styles.css';
    const y = require('./local');
    export * from '../other';
  `);
  assert.ok(specs.includes("@shared/ui"));
  assert.ok(specs.includes("./styles.css"));
  assert.ok(specs.includes("./local"));
  assert.ok(specs.includes("../other"));
});

test("expandFileCandidates adds extensions", () => {
  const list = expandFileCandidates("src/shared/ui/notification");
  assert.ok(list.includes("src/shared/ui/notification.ts"));
  assert.ok(list.includes("src/shared/ui/notification/index.tsx"));
});
