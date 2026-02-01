import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the dependencies
vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: vi.fn(() => ["main", "work", "personal"]),
  resolveDefaultAgentId: vi.fn(() => "main"),
}));

vi.mock("../../config/sessions.js", () => ({
  updateSessionStore: vi.fn(),
}));

vi.mock("../../globals.js", () => ({
  logVerbose: vi.fn(),
}));

import { handleAgentCommand } from "./commands-agent.js";
import type { HandleCommandsParams } from "./commands-types.js";
import type { SessionEntry } from "../../config/sessions.js";

function createMockParams(overrides: Partial<HandleCommandsParams> = {}): HandleCommandsParams {
  return {
    ctx: {} as HandleCommandsParams["ctx"],
    cfg: {} as HandleCommandsParams["cfg"],
    command: {
      surface: "telegram",
      channel: "telegram",
      ownerList: [],
      isAuthorizedSender: true,
      senderId: "123",
      rawBodyNormalized: "/agent",
      commandBodyNormalized: "/agent",
    },
    agentId: "main",
    directives: {} as HandleCommandsParams["directives"],
    elevated: { enabled: false, allowed: false, failures: [] },
    sessionEntry: {
      sessionId: "test-session",
      updatedAt: Date.now(),
    } as SessionEntry,
    sessionStore: {},
    sessionKey: "agent:main:test",
    storePath: "/tmp/test",
    sessionScope: "global",
    workspaceDir: "/tmp/workspace",
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    contextTokens: 0,
    isGroup: false,
    ...overrides,
  } as HandleCommandsParams;
}

describe("handleAgentCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("command detection", () => {
    it("returns null for non-agent commands", async () => {
      const params = createMockParams({
        command: {
          ...createMockParams().command,
          commandBodyNormalized: "/status",
        },
      });
      const result = await handleAgentCommand(params, true);
      expect(result).toBeNull();
    });

    it("handles /agent command", async () => {
      const params = createMockParams();
      const result = await handleAgentCommand(params, true);
      expect(result).not.toBeNull();
      expect(result?.shouldContinue).toBe(false);
    });
  });

  describe("/agent (show)", () => {
    it("shows current agent and available agents", async () => {
      const params = createMockParams();
      const result = await handleAgentCommand(params, true);
      expect(result?.reply?.text).toContain("Current Agent");
      expect(result?.reply?.text).toContain("main");
      expect(result?.reply?.text).toContain("work");
      expect(result?.reply?.text).toContain("personal");
    });

    it("indicates override when active", async () => {
      const params = createMockParams({
        sessionEntry: {
          sessionId: "test",
          updatedAt: Date.now(),
          agentOverride: "work",
        } as SessionEntry,
      });
      const result = await handleAgentCommand(params, true);
      expect(result?.reply?.text).toContain("Override active");
      expect(result?.reply?.text).toContain("work");
    });
  });

  describe("/agent <id>", () => {
    it("switches to a valid agent", async () => {
      const params = createMockParams({
        command: {
          ...createMockParams().command,
          commandBodyNormalized: "/agent work",
        },
      });
      const result = await handleAgentCommand(params, true);
      expect(result?.reply?.text).toContain("Switched to agent");
      expect(result?.reply?.text).toContain("work");
      expect(params.sessionEntry?.agentOverride).toBe("work");
    });

    it("rejects unknown agent", async () => {
      const params = createMockParams({
        command: {
          ...createMockParams().command,
          commandBodyNormalized: "/agent unknown",
        },
      });
      const result = await handleAgentCommand(params, true);
      expect(result?.reply?.text).toContain("Unknown agent");
    });

    it("ignores case when matching agents", async () => {
      const params = createMockParams({
        command: {
          ...createMockParams().command,
          commandBodyNormalized: "/agent WORK",
        },
      });
      const result = await handleAgentCommand(params, true);
      expect(result?.reply?.text).toContain("Switched to agent");
    });
  });

  describe("/agent reset", () => {
    it("clears an active override", async () => {
      const sessionEntry: SessionEntry = {
        sessionId: "test",
        updatedAt: Date.now(),
        agentOverride: "work",
      };
      const params = createMockParams({
        command: {
          ...createMockParams().command,
          commandBodyNormalized: "/agent reset",
        },
        sessionEntry,
      });
      const result = await handleAgentCommand(params, true);
      expect(result?.reply?.text).toContain("Agent override cleared");
      expect(sessionEntry.agentOverride).toBeUndefined();
    });

    it("reports when no override is set", async () => {
      const params = createMockParams({
        command: {
          ...createMockParams().command,
          commandBodyNormalized: "/agent reset",
        },
      });
      const result = await handleAgentCommand(params, true);
      expect(result?.reply?.text).toContain("No agent override");
    });
  });

  describe("authorization", () => {
    it("ignores commands from unauthorized senders", async () => {
      const params = createMockParams({
        command: {
          ...createMockParams().command,
          isAuthorizedSender: false,
        },
      });
      const result = await handleAgentCommand(params, true);
      expect(result?.shouldContinue).toBe(false);
      expect(result?.reply).toBeUndefined();
    });
  });

  describe("text command gating", () => {
    it("returns null when text commands are disabled", async () => {
      const params = createMockParams();
      const result = await handleAgentCommand(params, false);
      expect(result).toBeNull();
    });
  });
});
