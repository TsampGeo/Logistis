import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyUrl } from "../src/sources.js";
import { htmlToText } from "../src/fetch.js";

test("classifies primary sources, including subdomains", () => {
  assert.equal(classifyUrl("https://www.aade.gr/mydata"), "primary");
  assert.equal(classifyUrl("https://elib.aade.gr/elib/view?d=/gr/act/2020/a.1138/"), "primary");
  assert.equal(classifyUrl("https://search.et.gr/el/fek/"), "primary");
  assert.equal(classifyUrl("https://www.efka.gov.gr/el"), "primary");
});

test("classifies secondary sources", () => {
  assert.equal(classifyUrl("https://www.taxheaven.gr/news"), "secondary");
  assert.equal(classifyUrl("https://kb.epsilonnet.gr/epsilonsmart/"), "secondary");
  assert.equal(classifyUrl("https://docs.entersoft.eu/quickbiz/el"), "secondary");
});

test("rejects lookalike and non-allowlisted hosts", () => {
  assert.equal(classifyUrl("https://aade.gr.evil.com/"), null);
  assert.equal(classifyUrl("https://fakeaade.gr/"), null);
  assert.equal(classifyUrl("https://example.com/"), null);
  assert.equal(classifyUrl("file:///etc/passwd"), null);
  assert.equal(classifyUrl("not a url"), null);
});

test("htmlToText strips scripts and tags", () => {
  const out = htmlToText("<p>ΦΠΑ&nbsp;24%</p><script>alert(1)</script><div>ΦΕΚ Β&#39;</div>");
  assert.equal(out, "ΦΠΑ 24%\nΦΕΚ Β'");
});
