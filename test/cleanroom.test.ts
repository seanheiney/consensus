import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GROK_OBSERVED_VIA, cleanRooms, isolationChecks, isolationReport, observedGrokReceipt, parseGrokInspect } from "../src/providers/cleanroom.js";
import { createGrokCliPanelist } from "../src/providers/cli.js";
import { describeIsolation, foldIsolation } from "../src/providers/isolation.js";
import { probe } from "../src/doctor.js";
import { ConsensusEngine } from "../src/protocol/engine.js";
import { renderReport } from "../src/report.js";
import { agreeAll, fakePanelist, phaseOf } from "./fake.js";
import type { CompletionRequest, CompletionResult, IsolationReceipt, Panelist, SeatIsolation } from "../src/types.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => readFile(join(FIXTURES, name), "utf8");
const BASE: IsolationReceipt = { route: "cli", evidence: "configured", bin: "grok", flags: ["--tools", '""'] };

describe("parseGrokInspect", () => {
  it("reads a clean sandbox report (captured from grok 1.0.41) as empty lists", async () => {
    const s = parseGrokInspect(await fixture("grok-inspect-clean.json"));
    expect(s).toEqual({ version: "1.0.41", instructions: [], skills: [], plugins: [], mcpServers: [], hooks: [], other: [] });
    const seat = foldIsolation(undefined, observedGrokReceipt(BASE, s!));
    expect(seat).toMatchObject({ evidence: "observed", observedVia: GROK_OBSERVED_VIA, version: "1.0.41", clean: true });
  });

  it("names instructions, skills, plugins, MCP servers and hooks from a loaded home", async () => {
    const s = parseGrokInspect(await fixture("grok-inspect-dirty.json"))!;
    expect(s.instructions).toEqual(["/home/u/.grok/Agents.md"]);
    expect(s.skills).toEqual(["code-review", "brainstorm", "docs@bundled"]);
    expect(s.plugins).toEqual(["superpowers"]);
    expect(s.mcpServers).toEqual(["github"]);
    expect(s.hooks).toEqual(["PreToolUse (user)"]);
    const seat = foldIsolation(undefined, observedGrokReceipt(BASE, s));
    expect(seat.clean).toBe(false);
    const line = describeIsolation("grok", seat);
    expect(line).toContain("NOT CLEAN");
    expect(line).toContain("MCP servers github");
    expect(line).toContain("hooks PreToolUse (user)");
    expect(line).toContain("instruction files /home/u/.grok/Agents.md");
    expect(line).toContain("CLI built-ins: docs");
    expect(line).toContain("tools off by flag");
  });

  it("counts bundled skills as clean, and each other kind of add-on as not", async () => {
    const clean = JSON.parse(await fixture("grok-inspect-clean.json"));
    const withBundled = { ...clean, skills: [{ name: "docs", source: { type: "bundled", path: "/x" } }] };
    expect(foldIsolation(undefined, observedGrokReceipt(BASE, parseGrokInspect(withBundled)!)).clean).toBe(true);
    const variants: Record<string, unknown[]> = {
      skills: [{ name: "mine", source: { type: "user", path: "/x" } }],
      plugins: [{ name: "p", enabled: false }],
      mcpServers: [{ name: "m" }],
      hooks: [{ event: "Stop", source: { type: "plugin" } }],
      projectInstructions: [{ path: "/a/Agents.md" }],
    };
    for (const [k, v] of Object.entries(variants)) {
      const seat = foldIsolation(undefined, observedGrokReceipt(BASE, parseGrokInspect({ ...clean, [k]: v })!));
      expect(seat.clean, k).toBe(false);
    }
  });

  it("never lets a user add-on pass for a CLI built-in by its name", async () => {
    const clean = JSON.parse(await fixture("grok-inspect-clean.json"));
    const spoofs: Record<string, unknown[]> = {
      skills: [{ name: "evil@bundled", source: { type: "user", path: "/x" } }],
      plugins: [{ name: "evil@builtin", enabled: true }],
      mcpServers: [{ name: "evil@builtin" }],
    };
    for (const [k, v] of Object.entries(spoofs)) {
      const seat = foldIsolation(undefined, observedGrokReceipt(BASE, parseGrokInspect({ ...clean, [k]: v })!));
      expect(seat.clean, k).toBe(false);
      expect(describeIsolation("grok", seat), k).not.toContain("CLI built-ins");
    }
    // Each suffix counts only in its own list: a Claude plugin from a marketplace named "bundled" is installed, not built in.
    expect(foldIsolation(undefined, { route: "cli", evidence: "observed", tools: [], mcpServers: [], plugins: ["x@bundled"] }).clean).toBe(false);
    expect(foldIsolation(undefined, { ...BASE, evidence: "observed", skills: ["x@builtin"] }).clean).toBe(false);
  });

  it("counts user agents, LSP servers and remote settings, but not grok's own agents", async () => {
    const clean = JSON.parse(await fixture("grok-inspect-clean.json"));
    expect(parseGrokInspect(clean)!.other).toEqual([]);
    const variants: Record<string, unknown> = {
      agents: [...clean.agents, { name: "reviewer", source: { type: "user", path: "/x" } }],
      lspServers: [{ name: "tsserver" }],
      externalCompat: { ...clean.externalCompat, remoteSettingsLoaded: true },
    };
    for (const [k, v] of Object.entries(variants)) {
      const s = parseGrokInspect({ ...clean, [k]: v })!;
      expect(s.other, k).toHaveLength(1);
      const seat = foldIsolation(undefined, observedGrokReceipt(BASE, s));
      expect(seat.clean, k).toBe(false);
      expect(describeIsolation("grok", seat), k).toContain("other add-ons");
    }
  });

  it("refuses output that is not an inspect report, so the seat stays configured", () => {
    expect(parseGrokInspect("")).toBeUndefined();
    expect(parseGrokInspect("error: unrecognized subcommand 'inspect'")).toBeUndefined();
    expect(parseGrokInspect('{"result":"pong"}')).toBeUndefined();
    expect(parseGrokInspect({ skills: [], plugins: [], mcpServers: [], hooks: [] })).toBeUndefined(); // no projectInstructions
  });
});

describe("evidence folding", () => {
  it("a configured call after an observed one weakens the seat, and dirt from any call sticks", () => {
    const observed = observedGrokReceipt(BASE, { instructions: [], skills: [], plugins: [], mcpServers: [], hooks: [], other: [] });
    const a = foldIsolation(undefined, observed);
    expect(foldIsolation(a, BASE)).toMatchObject({ evidence: "configured", clean: true, calls: 2 });
    const dirty = foldIsolation(a, { ...observed, hooks: ["Stop (user)"] });
    expect(foldIsolation(dirty, observed)).toMatchObject({ clean: false, hooks: ["Stop (user)"] });
  });
});

describe("cleanRooms trust line", () => {
  const seat = (evidence: SeatIsolation["evidence"], clean = true): SeatIsolation => ({ route: evidence === "request" ? "api" : "cli", evidence, calls: 3, clean });

  it("says all observed clean only when every seat was observed", () => {
    const v = cleanRooms({ claude: seat("observed"), grok: seat("observed"), "claude:haiku": seat("observed") })!;
    expect(v.line).toBe("Clean rooms: 3/3 seats observed clean.");
    expect(v.observedClean).toHaveLength(3);
  });

  it("separates verified from claimed", () => {
    const v = cleanRooms({ claude: seat("observed"), grok: seat("observed"), codex: seat("configured") })!;
    expect(v.line).toMatch(/^Clean rooms: 2 observed clean, 1 configured-only \(codex: /);
    expect(v.configuredOnly).toEqual(["codex"]);
    expect(cleanRooms({ claude: seat("observed"), "openai:m": seat("request") })!.line).toBe("Clean rooms: 1 observed clean, 1 API with no tools attached.");
  });

  it("leads with the seats that are not clean", () => {
    const v = cleanRooms({ claude: seat("observed"), grok: seat("observed", false), codex: seat("configured") })!;
    expect(v.line).toBe("Clean rooms: NOT CLEAN: grok; 1 observed clean, 1 configured-only (3 seats).");
    expect(v.notClean).toEqual(["grok"]);
  });

  it("is absent when no receipts were recorded", () => {
    expect(cleanRooms(undefined)).toBeUndefined();
    expect(cleanRooms({})).toBeUndefined();
  });
});

describe("run.json and the report", () => {
  function withReceipt(p: Panelist, provider: string, receipt: IsolationReceipt): Panelist {
    return {
      ...p,
      provider,
      async complete(req: CompletionRequest): Promise<CompletionResult> {
        return { ...(await p.complete(req)), isolation: receipt };
      },
    };
  }
  const script = (name: string) => (req: CompletionRequest) => (phaseOf(req) === "critique" ? agreeAll(req) : phaseOf(req) === "synthesize" ? "# Answer\nx" : `${name} answer`);

  it("records the verdict on the run and prints it in the report", async () => {
    const observed: IsolationReceipt = { route: "cli", evidence: "observed", tools: [], mcpServers: [], plugins: [] };
    const panel = [
      withReceipt(fakePanelist("claude:m", script("A")), "claude", observed),
      withReceipt(fakePanelist("grok:m", script("B")), "grok", observedGrokReceipt(BASE, { instructions: [], skills: [], plugins: [], mcpServers: [], hooks: [], other: [] })),
      withReceipt(fakePanelist("codex:m", script("C")), "codex", { route: "cli", evidence: "configured" }),
    ];
    const run = await new ConsensusEngine({ panel, rounds: 1 }).run("q");
    expect(run.cleanRooms).toMatchObject({ seats: 3, observedClean: ["claude:m", "grok:m"], configuredOnly: ["codex:m"], notClean: [] });
    const json = JSON.parse(JSON.stringify(run));
    expect(json.cleanRooms.line).toMatch(/^Clean rooms: 2 observed clean, 1 configured-only/);
    const report = renderReport(run);
    expect(report).toContain("**Clean rooms: 2 observed clean, 1 configured-only");
    expect(report).toContain(`grok:m: clean, observed via ${GROK_OBSERVED_VIA}`);
  });

  it("derives the line for runs saved before the field existed", async () => {
    const run = await new ConsensusEngine({ panel: [fakePanelist("openai:a", script("A")), fakePanelist("openai:b", script("B"))], rounds: 1 }).run("q");
    delete run.cleanRooms;
    expect(renderReport(run)).toContain("**Clean rooms: 2 API with no tools attached.**");
  });
});

describe("Grok seat observed through inspect (fake binary)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  /** A fake grok: `inspect --json` prints the given report (and logs its env), anything else answers. */
  async function fakeGrok(report: string): Promise<{ bin: string; seen: string }> {
    const dir = await mkdtemp(join(tmpdir(), "consensus-grok-inspect-"));
    const realHome = join(dir, "real-grok");
    await mkdir(realHome, { recursive: true });
    await writeFile(join(realHome, "auth.json"), '{"token":"t"}');
    process.env.GROK_HOME = realHome;
    const seen = join(dir, "inspect-env.txt");
    const reportFile = join(dir, "report.json");
    await writeFile(reportFile, report);
    const bin = join(dir, "grok");
    await writeFile(bin, `#!/bin/sh
if [ "$1" = inspect ]; then
  { echo "HOME=$HOME"; echo "GROK_HOME=$GROK_HOME"; echo "PWD=$PWD"; ls -A "$GROK_HOME"; ls -A "$PWD"; } > "${seen}"
  cat "${reportFile}"
  exit 0
fi
echo '{"result":"pong"}'
`);
    await chmod(bin, 0o755);
    return { bin, seen };
  }

  it("marks the seat observed clean after inspecting an identical sandbox", async () => {
    const { bin, seen } = await fakeGrok(await fixture("grok-inspect-clean.json"));
    const r = await createGrokCliPanelist({ bin }).complete({ system: "s", messages: [{ role: "user", content: "ping" }] } as CompletionRequest);
    expect(r.text).toBe("pong");
    expect(r.isolation).toMatchObject({ evidence: "observed", observedVia: GROK_OBSERVED_VIA, version: "1.0.41", skills: [], mcpServers: [], hooks: [], instructions: [] });
    expect(r.isolation!.flags).toContain("HOME=<empty sandbox>");
    const log = await readFile(seen, "utf8");
    expect(log).toMatch(/GROK_HOME=.*consensus-.*\/home\/\.grok/);
    expect(log).not.toContain(`GROK_HOME=${process.env.GROK_HOME}\n`);
    // Same shape as a seat: the login only, and a cwd holding the prompt file and the empty home.
    expect(log.split("\n")).toEqual(expect.arrayContaining(["auth.json", "prompt.md", "home"]));
  });

  it("marks the seat not clean when inspect finds add-ons", async () => {
    const { bin } = await fakeGrok(await fixture("grok-inspect-dirty.json"));
    const r = await createGrokCliPanelist({ bin }).complete({ system: "s", messages: [{ role: "user", content: "ping" }] } as CompletionRequest);
    expect(foldIsolation(undefined, r.isolation!)).toMatchObject({ evidence: "observed", clean: false, mcpServers: ["github"] });
  });

  it("stays configured when inspect is missing", async () => {
    const { bin } = await fakeGrok("error: unrecognized subcommand 'inspect'");
    const r = await createGrokCliPanelist({ bin }).complete({ system: "s", messages: [{ role: "user", content: "ping" }] } as CompletionRequest);
    expect(r.isolation?.evidence).toBe("configured");
    expect(r.isolation?.observedVia).toBeUndefined();
  });

  it("doctor --isolation --json: one entry per seat, a verdict, and ok=false for a failed probe", async () => {
    const { bin } = await fakeGrok(await fixture("grok-inspect-clean.json"));
    const probed = await probe(createGrokCliPanelist({ bin }));
    const report = isolationReport(isolationChecks([probed, { id: "codex", ok: false, error: "codex: not logged in" }]), ["GITHUB_TOKEN"]);
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({
      ok: false,
      withheld: ["GITHUB_TOKEN"],
      seats: [
        { id: "grok", ok: true, clean: true, receipt: { route: "cli", evidence: "observed", calls: 1, clean: true } },
        { id: "codex", ok: false, clean: false, error: "codex: not logged in" },
      ],
      cleanRooms: { seats: 1, observedClean: ["grok"], line: "Clean rooms: NOT VERIFIED: codex could not be checked; 1/1 seats observed clean." },
      unchecked: ["codex"],
    });
    expect(isolationReport(isolationChecks([probed]), [])).toMatchObject({ ok: true, unchecked: [], cleanRooms: { line: "Clean rooms: 1/1 seats observed clean." } });
    expect(isolationReport(isolationChecks([{ id: "codex", ok: false, error: "x" }]), []).cleanRooms?.line).toBe("Clean rooms: NOT VERIFIED: codex could not be checked.");
  });
});
