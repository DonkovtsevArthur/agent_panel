const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  validatePackageJsonVersionValue,
} = require("../out/versionBump.js");

const PKG_VALID = `{
  "name": "harbor",
  "version": "0.0.22",
  "dependencies": { "lodash": "^4.17.21" }
}
`;

const PKG_BARE_NUMBER = `{
  "name": "harbor",
  "version": "22",
  "dependencies": { "lodash": "^4.17.21" }
}
`;

const PKG_NO_VERSION = `{
  "name": "harbor",
  "dependencies": { "lodash": "^4.17.21" }
}
`;

test("validatePackageJsonVersionValue accepts valid semver", () => {
  assert.equal(validatePackageJsonVersionValue(PKG_VALID), null);
  assert.equal(
    validatePackageJsonVersionValue(
      PKG_VALID.replace('"0.0.22"', '"1.2.3-beta.1"')
    ),
    null
  );
});

test("validatePackageJsonVersionValue blocks bare number in version field", () => {
  const err = validatePackageJsonVersionValue(PKG_BARE_NUMBER);
  assert.ok(err, "guard must flag bare-number version");
  const parsed = JSON.parse(err);
  assert.ok(parsed.error, "error must be a JSON object with error field");
  assert.match(parsed.error, /semver/i);
  assert.match(parsed.error, /22/);
  assert.match(parsed.error, /ask the user|уточни/i);
});

test("validatePackageJsonVersionValue is silent when version field absent", () => {
  assert.equal(validatePackageJsonVersionValue(PKG_NO_VERSION), null);
});

test("mainLikeTools wires the guard into write_file and search_replace dispatch", () => {
  const toolsSrc = fs.readFileSync(
    path.join(__dirname, "../src/mainLikeTools.ts"),
    "utf8"
  );
  // guard is imported from the vscode-free versionBump module (testable in Node)
  assert.match(toolsSrc, /import \{[^}]*validatePackageJsonVersionValue[^}]*\} from "\.\/versionBump"/);
  // write_file path checks the guard before delegating to runTool
  assert.match(
    toolsSrc,
    /case "write_file":[\s\S]*?baseName === "package.json"[\s\S]*?validatePackageJsonVersionValue/
  );
  // search_replace path applies the patch locally then checks the guard
  assert.match(
    toolsSrc,
    /case "search_replace":[\s\S]*?applySearchReplace[\s\S]*?validatePackageJsonVersionValue/
  );

  const versionBumpSrc = fs.readFileSync(
    path.join(__dirname, "../src/versionBump.ts"),
    "utf8"
  );
  assert.match(versionBumpSrc, /export function validatePackageJsonVersionValue/);
});
