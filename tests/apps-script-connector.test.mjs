import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const connectorSource = readFileSync(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../google-apps-script/appsscript.json", import.meta.url), "utf8"));
const workerConfig = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

function connectorContext() {
  const cacheValues = new Map();
  const calls = { metadata: 0, values: [] };
  const context = {
    console,
    JSON,
    Math,
    Number,
    String,
    Date,
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cacheValues.get(key) || null,
        put: (key, value) => cacheValues.set(key, value),
      }),
    },
    Sheets: {
      Spreadsheets: {
        get: () => {
          calls.metadata += 1;
          return { sheets: [{ properties: { sheetId: 409909056, title: "Form Responses 1", gridProperties: { rowCount: 60001, columnCount: 30 } } }] };
        },
        Values: {
          get: (_spreadsheetId, range) => {
            calls.values.push(range);
            if (range.includes("A1:")) return { values: [["Timestamp", "Full Name", "Email Address"]] };
            return { values: [["22/07/2026", "Asha Rao", "asha@example.com"], ["22/07/2026", "Kabir Shah", "kabir@example.com"]] };
          },
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(connectorSource, context);
  return { context, calls };
}

test("large Sheet preview reads metadata and only the header range", () => {
  const { context, calls } = connectorContext();
  const result = context.preview_({ spreadsheetId: "large-sheet", tabName: "Form Responses 1", headerRow: 1 });
  assert.equal(result.totalRows, 60001);
  assert.equal(result.totalRowsEstimated, true);
  assert.equal(result.headers.length, 3);
  assert.equal(calls.metadata, 1);
  assert.equal(calls.values.length, 1);
  assert.match(calls.values[0], /A1:AD1$/);
});

test("large Sheet sync reads only the requested page and reuses cached metadata", () => {
  const { context, calls } = connectorContext();
  context.preview_({ spreadsheetId: "large-sheet", tabName: "Form Responses 1", headerRow: 1 });
  const result = context.readRows_({ spreadsheetId: "large-sheet", tabName: "Form Responses 1", headerRow: 1, startRow: 2, limit: 2 });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]["Full Name"], "Asha Rao");
  assert.equal(result.nextRow, 4);
  assert.equal(result.done, false);
  assert.equal(calls.metadata, 1);
  assert.equal(calls.values.length, 2);
  assert.match(calls.values[1], /A2:C3$/);
});

test("Apps Script manifest enables the Sheets v4 advanced service", () => {
  const services = manifest.dependencies?.enabledAdvancedServices || [];
  assert.ok(services.some((service) => service.userSymbol === "Sheets" && service.serviceId === "sheets" && service.version === "v4"));
});

test("Worker stays on Cloudflare Free's default subrequest allowance", () => {
  assert.equal(workerConfig.limits, undefined);
});
