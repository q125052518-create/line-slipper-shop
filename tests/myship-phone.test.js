import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTaiwanMobile } from "../scripts/myship-phone.js";

test("keeps a local Taiwan mobile number", () => {
  assert.equal(normalizeTaiwanMobile("0912-345-678"), "0912345678");
});

test("converts a +886 Taiwan mobile number to local form", () => {
  assert.equal(normalizeTaiwanMobile("+886 912 345 678"), "0912345678");
});

test("retains the existing ten-digit cap for other inputs", () => {
  assert.equal(normalizeTaiwanMobile("091234567899"), "0912345678");
});
