import { describe, expect, it } from "vitest";
import { resolveEffectiveAgentId, hasAgentOverride } from "./agent-override.js";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";

const createConfig = (agents: Array<{ id: string }>): OpenClawConfig =>
  ({
    agents: { list: agents },
  }) as OpenClawConfig;

const createSessionEntry = (agentOverride?: string): SessionEntry =>
  ({
    sessionId: "test",
    updatedAt: Date.now(),
    agentOverride,
  }) as SessionEntry;

describe("resolveEffectiveAgentId", () => {
  it("returns routeAgentId when no override is set", () => {
    const result = resolveEffectiveAgentId({
      cfg: createConfig([{ id: "main" }]),
      routeAgentId: "main",
      sessionEntry: createSessionEntry(),
    });
    expect(result).toBe("main");
  });

  it("returns routeAgentId when sessionEntry is null", () => {
    const result = resolveEffectiveAgentId({
      cfg: createConfig([{ id: "main" }]),
      routeAgentId: "main",
      sessionEntry: null,
    });
    expect(result).toBe("main");
  });

  it("returns routeAgentId when override is empty string", () => {
    const result = resolveEffectiveAgentId({
      cfg: createConfig([{ id: "main" }]),
      routeAgentId: "main",
      sessionEntry: createSessionEntry("  "),
    });
    expect(result).toBe("main");
  });

  it("returns override when valid agent is specified", () => {
    const result = resolveEffectiveAgentId({
      cfg: createConfig([{ id: "main" }, { id: "work" }]),
      routeAgentId: "main",
      sessionEntry: createSessionEntry("work"),
    });
    expect(result).toBe("work");
  });

  it("returns routeAgentId when override agent does not exist", () => {
    const result = resolveEffectiveAgentId({
      cfg: createConfig([{ id: "main" }]),
      routeAgentId: "main",
      sessionEntry: createSessionEntry("unknown"),
    });
    expect(result).toBe("main");
  });

  it("is case-insensitive when matching agents", () => {
    const result = resolveEffectiveAgentId({
      cfg: createConfig([{ id: "Main" }, { id: "Work" }]),
      routeAgentId: "main",
      sessionEntry: createSessionEntry("WORK"),
    });
    expect(result).toBe("WORK");
  });
});

describe("hasAgentOverride", () => {
  it("returns false for undefined sessionEntry", () => {
    expect(hasAgentOverride(undefined)).toBe(false);
  });

  it("returns false for null sessionEntry", () => {
    expect(hasAgentOverride(null)).toBe(false);
  });

  it("returns false when no override is set", () => {
    expect(hasAgentOverride(createSessionEntry())).toBe(false);
  });

  it("returns false for empty override", () => {
    expect(hasAgentOverride(createSessionEntry("  "))).toBe(false);
  });

  it("returns true when override is set", () => {
    expect(hasAgentOverride(createSessionEntry("work"))).toBe(true);
  });
});
