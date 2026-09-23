import assert from "assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadLocalEnv } from "../src/local-env.js";

describe("local secrets file", () => {
  it("loads .env.<env>.local over committed values, and is optional", () => {
    const folder = mkdtempSync(join(tmpdir(), "gamenite-env-"));
    assert.strictEqual(loadLocalEnv(folder, "development"), null, "no file is fine");

    process.env.GAMENITE_TEST_SECRET = "from the committed file";
    writeFileSync(join(folder, ".env.development.local"), "GAMENITE_TEST_SECRET=from-the-local-file\r\nGAMENITE_TEST_OTHER=x\r\n");
    assert.ok(loadLocalEnv(folder + "/", "development")?.endsWith(".env.development.local"));
    assert.strictEqual(process.env.GAMENITE_TEST_SECRET, "from-the-local-file", "the local file wins, Windows line endings included");
    assert.strictEqual(process.env.GAMENITE_TEST_OTHER, "x");
    delete process.env.GAMENITE_TEST_SECRET;
    delete process.env.GAMENITE_TEST_OTHER;
  });

  it("a corrected line pasted again wins over the earlier typo", () => {
    const folder = mkdtempSync(join(tmpdir(), "gamenite-env-"));
    writeFileSync(join(folder, ".env.development.local"), "GAMENITE_TEST_KEY=tyop\r\nGAMENITE_TEST_KEY=typo-fixed\r\n");
    loadLocalEnv(folder, "development");
    assert.strictEqual(process.env.GAMENITE_TEST_KEY, "typo-fixed");
    delete process.env.GAMENITE_TEST_KEY;
  });
});
