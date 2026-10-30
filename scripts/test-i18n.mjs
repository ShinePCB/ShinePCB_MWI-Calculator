import { test } from "node:test";
import assert from "node:assert/strict";
import { translate } from "../dist/i18n.js";

test("engineering translation preserves interpolated numbers, identifiers and source attribution", () => {
  assert.equal(translate("线长 71.2 mm 总插损", "en"), "Total insertion loss over 71.2 mm");
  assert.equal(translate("晟电产品规格书，第 7 页", "en"), "SUNDEN product datasheet, page 7");
  assert.equal(translate("CFG 系列", "en"), "CFG series");
  assert.equal(translate("CF220G2", "en"), "CF220G2");
  assert.equal(translate("用户自行输入的内容", "en"), "用户自行输入的内容");
  assert.equal(translate("线长 71.2 mm 总插损", "zh"), "线长 71.2 mm 总插损");
});
