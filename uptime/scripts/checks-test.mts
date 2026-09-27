import { parseChecks, DEFAULT_CHECKS } from "../src/checks.ts";

let fails = 0;
function expectThrow(raw: string, fragment: string) {
  try { parseChecks(raw); console.log("FAIL no throw:", raw.slice(0, 40)); fails++; }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes(fragment)) console.log("OK throw: " + msg);
    else { console.log("FAIL msg: " + msg); fails++; }
  }
}
console.log("defaults:", parseChecks(undefined).length === DEFAULT_CHECKS.length ? "OK" : "FAIL");
console.log("empty:", parseChecks("  ").length === DEFAULT_CHECKS.length ? "OK" : "FAIL");
expectThrow("{oops", "not valid JSON");
expectThrow("[]", "non-empty");
expectThrow('[{"name":"x","url":"https://a.b"}]', ".id");
expectThrow('[{"id":"a","name":"x","url":"ftp://a.b"}]', "http://");
expectThrow('[{"id":"a","name":"x","url":"https://a.b"},{"id":"a","name":"y","url":"https://c.d"}]', 'duplicate id "a"');
expectThrow('[{"id":"a","name":"x","url":"https://a.b","contains":5}]', ".contains");
const ok = parseChecks('[{"id":"a","name":" X ","url":" https://a.b/ ","contains":null}]');
console.log("valid+null-contains:", ok.length === 1 && ok[0].name === "X" && ok[0].url === "https://a.b/" && ok[0].contains === undefined ? "OK" : "FAIL " + JSON.stringify(ok));
console.log(fails === 0 ? "ALL PASS" : fails + " FAILURES");
