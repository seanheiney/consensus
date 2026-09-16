import { describe, expect, it } from "vitest";
import { defaultConnectChoice, isHeadless, loginArgs, setupSummary } from "../src/setup.js";
import type { VendorStatus } from "../src/doctor.js";

const status = (over: Partial<VendorStatus>): VendorStatus => ({ vendor: "anthropic", label: "Anthropic / Claude", apiProvider: "anthropic", apiKey: false, connected: false, ...over }) as VendorStatus;

describe("setup wizard defaults", () => {
  it("never defaults to installing a vendor CLI", () => {
    expect(defaultConnectChoice({ cli: undefined })).toBe("key");
    expect(defaultConnectChoice({ cli: { name: "codex", installed: false } as VendorStatus["cli"] })).toBe("key");
    expect(defaultConnectChoice({ cli: { name: "codex", installed: true } as VendorStatus["cli"] })).toBe("login");
  });

  it("uses codex device auth when no browser can open", () => {
    expect(isHeadless({ SSH_CONNECTION: "1 2 3 4" }, "darwin")).toBe(true);
    expect(isHeadless({}, "linux")).toBe(true);
    expect(isHeadless({ DISPLAY: ":0" }, "linux")).toBe(false);
    expect(isHeadless({}, "darwin")).toBe(false);
    expect(loginArgs("codex", "codex login", {}, "linux")).toEqual(["login", "--device-auth"]);
    expect(loginArgs("codex", "codex login", {}, "darwin")).toEqual(["login"]);
    expect(loginArgs("claude", "claude auth login", {}, "linux")).toEqual(["auth", "login"]);
  });
});

describe("setup summary", () => {
  const base = { cfg: { profiles: {} }, cfgPath: "/x/config.json", wired: [], mcpCommand: ["consensus", "mcp"], env: { PATH: "/usr/bin:/bin" } };

  it("says not ready and gives the exact next step with fewer than 2 models", () => {
    const text = setupSummary({ ...base, statuses: [status({})], ready: false });
    expect(text).toContain("Not ready yet: no models connected");
    expect(text).toContain("consensus connect openrouter");
    expect(text).not.toContain("Try:");
    expect(text).toContain("Telemetry");
  });

  it("lists accounts, profiles, wired IDEs and a Try line when ready", () => {
    const text = setupSummary({
      ...base,
      cfg: { profile: "balanced", profiles: { balanced: { panel: [] }, fast: { panel: [] } } } as never,
      wired: ["Claude Code", "Cursor"],
      statuses: [status({ connected: true, via: "cli", cli: { name: "claude" } as VendorStatus["cli"] }), status({ vendor: "openai", label: "OpenAI / ChatGPT", connected: true, via: "api" })],
      ready: true,
    });
    expect(text).toContain("balanced (default), fast");
    expect(text).toContain("Anthropic / Claude via claude");
    expect(text).toContain("IDEs wired");
    expect(text).toContain("Claude Code, Cursor");
    expect(text).toContain("Try:");
  });
});
