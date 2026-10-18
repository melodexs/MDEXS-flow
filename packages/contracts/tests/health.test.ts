import assert from "node:assert/strict";
import { test } from "node:test";

import { isHealthResponse, type HealthResponse } from "../src/health.js";

const validPayload: HealthResponse = {
  service: "MDEXS Flow API",
  status: "ok",
  environment: "development",
  version: "0.1.0",
  database: { status: "skipped", latency_ms: null },
};

test("accepts a valid health payload", () => {
  assert.equal(isHealthResponse(validPayload), true);
});

test("rejects payloads missing the database block", () => {
  const { database: _db, ...withoutDb } = validPayload;
  assert.equal(isHealthResponse(withoutDb), false);
  const { service: _svc, ...withoutService } = validPayload;
  assert.equal(isHealthResponse(withoutService), false);
});

test("rejects non-object payloads", () => {
  assert.equal(isHealthResponse("ok"), false);
  assert.equal(isHealthResponse(null), false);
  assert.equal(isHealthResponse(42), false);
});
