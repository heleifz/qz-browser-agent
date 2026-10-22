// Copy qz session exports into the website and clear runtime.ownedTabs.
// The rest of each file, including the exchange script tag and JSON escapes, stays put.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPT_PATTERN = /<script\s+id=(["'])qingzhou-session-exchange\1\s+type=(["'])application\/json\2>([\s\S]*?)<\/script>/u;

export function clearOwnedTabs(html) {
  const source = String(html);
  const match = SCRIPT_PATTERN.exec(source);
  if (!match) throw new Error("missing qingzhou-session-exchange script");
  const json = match[3];
  const header = json.slice(0, 256);
  if (!header.includes('"format":"qingzhou.session"') || !header.includes('"version":1')) {
    throw new Error("exchange JSON does not start with qingzhou.session version 1");
  }
  const span = findLastArrayProperty(json, "ownedTabs");
  if (!span) throw new Error("runtime ownedTabs array was not found");
  const current = JSON.parse(json.slice(span.start, span.end));
  if (!Array.isArray(current)) throw new Error("ownedTabs is not an array");
  if (current.length === 0) return source;

  const nextJson = `${json.slice(0, span.start)}[]${json.slice(span.end)}`;
  const before = JSON.parse(json);
  const after = JSON.parse(nextJson);
  const expected = JSON.parse(json);
  expected.runtime.ownedTabs = [];
  if (JSON.stringify(after) !== JSON.stringify(expected)) {
    throw new Error("clearing ownedTabs would change other exchange data");
  }
  if (JSON.stringify(before.session) !== JSON.stringify(after.session)) {
    throw new Error("session records changed while clearing ownedTabs");
  }
  const nextScript = match[0].replace(json, nextJson);
  return `${source.slice(0, match.index)}${nextScript}${source.slice(match.index + match[0].length)}`;
}

function findLastArrayProperty(json, key) {
  let index = 0;
  let last = null;

  function skipSpace() {
    while (json[index] === " " || json[index] === "\n" || json[index] === "\r" || json[index] === "\t") index += 1;
  }

  function parseString() {
    index += 1;
    while (index < json.length) {
      if (json[index] === "\\") {
        index += 2;
        continue;
      }
      if (json[index] === '"') {
        index += 1;
        return;
      }
      index += 1;
    }
    throw new Error("unterminated JSON string");
  }

  function parseValue() {
    skipSpace();
    if (json[index] === "{") return parseObject();
    if (json[index] === "[") return parseArray();
    if (json[index] === '"') return parseString();
    while (index < json.length && !",}]".includes(json[index]) && !/\s/u.test(json[index])) index += 1;
  }

  function parseArray() {
    index += 1;
    skipSpace();
    if (json[index] === "]") {
      index += 1;
      return;
    }
    while (index < json.length) {
      parseValue();
      skipSpace();
      if (json[index] === ",") {
        index += 1;
        continue;
      }
      if (json[index] === "]") {
        index += 1;
        return;
      }
      throw new Error(`bad JSON array at ${index}`);
    }
  }

  function parseObject() {
    index += 1;
    skipSpace();
    if (json[index] === "}") {
      index += 1;
      return;
    }
    while (index < json.length) {
      skipSpace();
      if (json[index] !== '"') throw new Error(`expected JSON key at ${index}`);
      const keyStart = index;
      parseString();
      const name = JSON.parse(json.slice(keyStart, index));
      skipSpace();
      if (json[index] !== ":") throw new Error(`expected colon at ${index}`);
      index += 1;
      skipSpace();
      const valueStart = index;
      if (name === key && json[index] === "[") {
        parseValue();
        last = { start: valueStart, end: index };
      } else {
        parseValue();
      }
      skipSpace();
      if (json[index] === ",") {
        index += 1;
        continue;
      }
      if (json[index] === "}") {
        index += 1;
        return;
      }
      throw new Error(`bad JSON object at ${index}`);
    }
  }

  parseValue();
  return last;
}

function printUsage() {
  console.log("Usage: node website/examples/prepare-exports.mjs --out website/examples/sessions <export.html>...");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--self-test") {
    runSelfTest();
  } else {
    const outFlag = args.indexOf("--out");
    if (outFlag < 0 || args.length < 2) {
      printUsage();
      process.exit(1);
    }
    const outDir = path.resolve(args[outFlag + 1]);
    const inputs = args.filter((arg, index) => index !== outFlag && index !== outFlag + 1 && !arg.startsWith("--"));
    fs.mkdirSync(outDir, { recursive: true });
    for (const input of inputs) {
      const before = fs.readFileSync(input);
      const after = clearOwnedTabs(before.toString("utf8"));
      const name = path.basename(input);
      fs.writeFileSync(path.join(outDir, name), after);
      console.log(`${name}: ownedTabs cleared`);
    }
  }
}

function runSelfTest() {
  const raw = `<!doctype html><script id="qingzhou-session-exchange" type="application/json">{"format":"qingzhou.session","version":1,"session":{"title":"a \\u003c b \\u2028 \\u2029","ownedTabs":[1]},"runtime":{"ownedTabs":[{"url":"https://example.com"}]}}</script>`;
  const cleared = clearOwnedTabs(raw);
  if (!cleared.includes('"ownedTabs":[]')) throw new Error("ownedTabs was not emptied");
  if (!cleared.includes("\\u003c") || !cleared.includes("\\u2028") || !cleared.includes("\\u2029")) {
    throw new Error("JSON escapes changed");
  }
  if (!cleared.includes('<script id="qingzhou-session-exchange" type="application/json">')) {
    throw new Error("script tag changed");
  }
  const again = clearOwnedTabs(cleared);
  if (again !== cleared) throw new Error("second pass rewrote an empty ownedTabs");
  const payload = JSON.parse(SCRIPT_PATTERN.exec(cleared)[3]);
  if (payload.runtime.ownedTabs.length !== 0 || payload.session.ownedTabs.length !== 1) {
    throw new Error("the wrong ownedTabs array was replaced");
  }
  console.log("prepare-exports self-test passed");
}
