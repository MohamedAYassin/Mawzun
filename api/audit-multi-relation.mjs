// Finds every `select` that requests 2+ RELATIONS at once. Prisma issues one
// statement per relation and runs them CONCURRENTLY, which races on a
// single-connection transaction (pg warns now, rejects on pg 9).
//
// Heuristic: inside a `select: { ... }` block, a key whose value is `{ select:`
// or `{ where:` or `true`-on-a-relation. Scalar `x: true` entries are ignored by
// checking against the model's relation names would need the schema — instead we
// flag keys whose value is an object, which is the reliable signal.
import fs from "node:fs";
import path from "node:path";

const ROOT = "src";
const SCALAR_KEYS = new Set([
  "id", "name", "slug", "email", "status", "createdAt", "updatedAt", "deletedAt",
  "where", "select", "orderBy", "take", "skip", "include", "omit", "cursor", "distinct",
]);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "generated" || e.name === "node_modules") continue;
      out.push(...walk(p));
    } else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function matchBracket(text, openIdx) {
  let depth = 0, i = openIdx, q = null;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === "\\") { i += 2; continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "`") q = "`";
    else if ("[{(".includes(c)) depth++;
    else if ("]})".includes(c)) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

const findings = [];
for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, "utf8");
  const re = /select:\s*\{/g;
  let mm;
  while ((mm = re.exec(text))) {
    const open = mm.index + mm[0].length - 1;
    const close = matchBracket(text, open);
    if (close < 0) continue;
    const body = text.slice(open + 1, close);
    // top-level keys only
    const keys = [];
    let depth = 0, q = null, start = 0;
    for (let i = 0; i <= body.length; i++) {
      const c = body[i] ?? ",";
      if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if ("[{(".includes(c)) depth++;
      else if ("]})".includes(c)) depth--;
      else if (c === "," && depth === 0) {
        const chunk = body.slice(start, i).trim();
        start = i + 1;
        const km = chunk.match(/^(\w+)\s*:\s*([\s\S]+)$/);
        if (!km) continue;
        const key = km[1], val = km[2].trim();
        const isObject = val.startsWith("{");
        if (isObject && !SCALAR_KEYS.has(key)) keys.push(key);
      }
    }
    const rels = keys.filter((k) => k !== "select" && k !== "where" && k !== "orderBy" && k !== "take" && k !== "skip");
    if (rels.length >= 2) {
      const line = text.slice(0, mm.index).split("\n").length;
      findings.push({ file, line, rels });
    }
  }
}

findings.sort((a, b) => b.rels.length - a.rels.length);
console.log(`selects loading 2+ relations: ${findings.length}\n`);
for (const f of findings) {
  console.log(`${String(f.rels.length).padStart(2)} rels  ${f.file}:${f.line}`);
  console.log(`        ${f.rels.join(", ")}`);
}
