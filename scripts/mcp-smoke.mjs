#!/usr/bin/env node
// Smoke test: start `<command...> mcp`, send MCP initialize + tools/list over stdio, check the replies.
//   node scripts/mcp-smoke.mjs node build/app/cli.mjs
//   node scripts/mcp-smoke.mjs ./dist-release/stage/consensus/bin/consensus
import { spawn } from "node:child_process";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: mcp-smoke.mjs <command> [args...]");
  process.exit(2);
}
const child = spawn(cmd, [...args, "mcp"], { stdio: ["pipe", "pipe", "inherit"], shell: process.platform === "win32" });
let buf = "";
let finished = false;
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
const done = (code, msg) => {
  if (finished) return;
  finished = true;
  console.log(msg);
  child.kill();
  process.exit(code);
};
setTimeout(() => done(1, "mcp smoke: timed out waiting for replies"), 20000);
child.on("exit", (c) => done(1, `mcp smoke: server exited (${c}) before replying`));
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id === 1) {
      if (!msg.result?.serverInfo) return done(1, `mcp smoke: bad initialize reply ${line}`);
      console.log(`initialize ok: ${msg.result.serverInfo.name} ${msg.result.serverInfo.version} (protocol ${msg.result.protocolVersion})`);
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    } else if (msg.id === 2) {
      const names = (msg.result?.tools ?? []).map((t) => t.name);
      if (!names.includes("consensus")) return done(1, `mcp smoke: tools/list lacks consensus: ${line}`);
      done(0, `tools/list ok: ${names.join(", ")}`);
    }
  }
});
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
