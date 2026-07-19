// Comprehensive async/await issue finder for TeachingRoom Manager
import fs from "node:fs";

const files = [
  "src/server.js",
  "src/excel.js",
  "src/timeline-rollback.js",
  "src/database.js",
  "src/seed.js",
];

// Collect all async function names
const asyncFns = new Set();

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split("\n")) {
    let m = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (m && line.includes("async ")) asyncFns.add(m[1]);

    m = line.match(/const\s+(\w+)\s*=\s*async\s*(?:function)?\s*\(/);
    if (m) asyncFns.add(m[1]);
  }
}

// Add adapter method names
for (const fn of ["get", "all", "run", "prepare", "exec", "transaction"]) {
  asyncFns.add(fn);
}

console.log("=== Known async functions ===");
console.log([...asyncFns].sort().join(", "));
console.log();

const issues = [];

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments and pure whitespace
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // CUSTOM PATTERNS FOR THIS CODEBASE

    // Pattern A: await fn().method(  where fn is async → precedence issue
    const p1 = trimmed.match(/await\s+(\w+)\s*\([^)]*\)\s*\.\s*(\w+)\s*\(/);
    if (p1 && asyncFns.has(p1[1])) {
      issues.push({
        file,
        line: i + 1,
        type: "PRECEDENCE: await fn().method()",
        text: trimmed.substring(0, 90),
      });
    }

    // Pattern B: await fn().prop  where fn is async → precedence issue
    const p2 = trimmed.match(/await\s+(\w+)\s*\([^)]*\)\s*\.\s*(\w+)\s*[;,)\]}]/);
    if (p2 && asyncFns.has(p2[1]) && !p2[1].startsWith("//")) {
      // Check not already matched by pattern A
      if (!p1) {
        issues.push({
          file,
          line: i + 1,
          type: "PRECEDENCE: await fn().prop",
          text: trimmed.substring(0, 90),
        });
      }
    }

    // Pattern C: async function call without await
    // Check for wordBefore.fn( or   fn( patterns
    for (const fn of asyncFns) {
      // Skip adapter methods that are part of chains
      if (["get", "all", "run", "prepare", "exec", "transaction"].includes(fn))
        continue;

      // Build regex to match fn( not preceded by await
      const re = new RegExp(
        "(?:^|\\s|[(,;:=!])\\s*" + fn + "\\s*\\(",
      );
      const match = trimmed.match(re);
      if (!match) continue;

      // Skip if preceded by await, async, function, import, export, new, typeof
      const before = trimmed.substring(
        Math.max(0, match.index - 20),
        match.index + match[0].length,
      );
      if (
        before.includes("await") ||
        trimmed.startsWith("import ") ||
        trimmed.startsWith("export ") ||
        before.includes("function " + fn) ||
        before.includes("typeof ") ||
        before.includes("new ")
      )
        continue;

      // Skip if it's a variable assignment of the function itself
      if (trimmed.match(new RegExp("=\\s*" + fn + "\\s*$", "m"))) continue;

      // Skip if this is actually a different identifier (substring match issue)
      const fullMatch = before.match(new RegExp(fn + "\\s*\\("));
      if (!fullMatch) continue;

      issues.push({
        file,
        line: i + 1,
        type: "MISSING_AWAIT: " + fn,
        text: trimmed.substring(0, 90),
      });
      break; // One report per line
    }
  }
}

// Deduplicate
const seen = new Set();
const deduped = issues
  .filter((x) => {
    const key = x.file + ":" + x.line + ":" + x.type;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

console.log("=== Issues found ===");
let lastFile = "";
for (const issue of deduped) {
  if (issue.file !== lastFile) {
    console.log("\n--- " + issue.file + " ---");
    lastFile = issue.file;
  }
  console.log(
    issue.line +
      ": [" +
      issue.type +
      "] " +
      issue.text.replace(/\s+/g, " ").trim(),
  );
}
console.log("\nTotal: " + deduped.length + " issues");
