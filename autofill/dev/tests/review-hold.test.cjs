// When the Internal Review holds the test transactions (lib/checks.js needsLook): only when its report
// would ask a person to check something. Fixes that worked don't count; the deletion and Salesforce don't either.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../review/lib/checks.js");

const del = { id: "testtx:deleteTestTx:", pageKey: "testtx", area: "Test transactions", field: "Test transactions", target: "deleteTestTx", from: "T1, T2", to: "", verb: "deleted", auto: true };
const fix = { id: "mobile:strategy:On", pageKey: "mobile", area: "Mobile tracking", field: "Mobile tracking strategy", target: "strategy", from: "Off", to: "On", verb: "enabled", auto: true };
const run = (o) => ({ awinId: "1", version: "x", plan: { changes: [fix, del] }, applied: [{ id: fix.id, verified: true }], result: { checks: [] }, ...o });

test("hold: nothing to check (fixes verified, deletion not done yet) -> delete at once", () => {
  assert.deepEqual(C.needsLook(run()), []);
  assert.deepEqual(C.needsLook(run({ sfUpdate: { ok: false, error: "x" } })), [], "Salesforce comes after, so it doesn't count");
});

test("hold: a failed fix, a check for a person, a skipped page or an untracked test transaction -> hold", () => {
  assert.match(C.needsLook(run({ applied: [{ id: fix.id, verified: false, error: "did not stick" }] }))[0], /Mobile tracking strategy enabled \| FAILED/);
  assert.match(C.needsLook(run({ result: { checks: [{ pageKey: "fees", check: "Tracking fee", ui: "30", expected: "25", result: "fail", action: "integrator", note: "" }] } }))[0], /To check: Tracking fee 30/);
  assert.match(C.needsLook(run({ result: { checks: [{ pageKey: "commission", check: "Default commission", ui: "—", result: "skipped", note: "page not read" }] } }))[0], /Not checked: Default commission/);
  assert.match(C.needsLook(run({ result: { checks: [{ pageKey: "wizard", check: "Test transaction tracked", ui: "—", result: "fail", action: "", note: "" }] } }))[0], /not found in Tracking diagnosis/);
});

test("hold: the report says whether the test transactions were deleted or kept", () => {
  assert.match(C.chatterText(run({ applied: [{ id: fix.id, verified: true }, { id: del.id, verified: true, refs: ["T1", "T2"] }] })), /Test transactions deleted \[T1, T2\] \| OK/);
  const kept = C.chatterText(run({ hold: { choice: "keep" } }));
  assert.match(kept, /Test transactions kept for a manual check \[T1, T2\] \| CHECK/);
  assert.doesNotMatch(kept, /NOT DONE/);
});
