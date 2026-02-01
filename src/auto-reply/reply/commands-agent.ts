import { listAgentIds, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import type { SessionEntry } from "../../config/sessions.js";
import { updateSessionStore } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import type { CommandHandler } from "./commands-types.js";

/**
 * Parse the /agent command.
 * @returns { hasCommand, agentId, isReset, isShow }
 */
function parseAgentCommand(body: string): {
  hasCommand: boolean;
  agentId?: string;
  isReset: boolean;
  isShow: boolean;
} {
  const trimmed = body.trim().toLowerCase();
  if (!trimmed.startsWith("/agent")) {
    return { hasCommand: false, isReset: false, isShow: false };
  }

  const rest = body.slice("/agent".length).trim();
  if (!rest) {
    return { hasCommand: true, isReset: false, isShow: true };
  }

  const firstToken = rest.split(/\s+/)[0]?.toLowerCase();
  if (firstToken === "reset" || firstToken === "clear" || firstToken === "default") {
    return { hasCommand: true, isReset: true, isShow: false };
  }

  return { hasCommand: true, agentId: firstToken, isReset: false, isShow: false };
}

/**
 * Format the list of available agents for display.
 */
function formatAgentList(
  agentIds: string[],
  currentAgentId: string,
  overrideAgentId?: string,
): string {
  const lines = agentIds.map((id) => {
    const isCurrent = normalizeAgentId(id) === normalizeAgentId(currentAgentId);
    const isOverride =
      overrideAgentId && normalizeAgentId(id) === normalizeAgentId(overrideAgentId);
    const marker = isOverride ? " ← override" : isCurrent ? " ← current" : "";
    return `  • ${id}${marker}`;
  });
  return lines.join("\n");
}

export const handleAgentCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }

  const parsed = parseAgentCommand(params.command.commandBodyNormalized);
  if (!parsed.hasCommand) {
    return null;
  }

  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /agent from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  const agentIds = listAgentIds(params.cfg);
  const defaultAgentId = resolveDefaultAgentId(params.cfg);
  const currentAgentId = params.agentId || defaultAgentId;
  const currentOverride = params.sessionEntry?.agentOverride;

  // Show current agent and list available agents
  if (parsed.isShow) {
    const agentList = formatAgentList(agentIds, currentAgentId, currentOverride);
    const overrideNote = currentOverride
      ? `\n\n📌 Override active: ${currentOverride}\nUse \`/agent reset\` to clear.`
      : "";

    return {
      shouldContinue: false,
      reply: {
        text: `🤖 **Current Agent:** ${currentAgentId}\n\n**Available Agents:**\n${agentList}${overrideNote}\n\nUse \`/agent <id>\` to switch.`,
      },
    };
  }

  // Reset/clear the agent override
  if (parsed.isReset) {
    if (!currentOverride) {
      return {
        shouldContinue: false,
        reply: { text: "⚙️ No agent override is currently set." },
      };
    }

    if (params.sessionEntry && params.sessionStore && params.sessionKey) {
      delete params.sessionEntry.agentOverride;
      params.sessionEntry.updatedAt = Date.now();
      params.sessionStore[params.sessionKey] = params.sessionEntry;
      if (params.storePath) {
        await updateSessionStore(params.storePath, (store) => {
          store[params.sessionKey] = params.sessionEntry as SessionEntry;
        });
      }
    }

    return {
      shouldContinue: false,
      reply: {
        text: `⚙️ Agent override cleared. Now using default routing → **${defaultAgentId}**`,
      },
    };
  }

  // Switch to a specific agent
  const targetAgentId = parsed.agentId;
  if (!targetAgentId) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Usage: /agent [id|reset]\n\nUse `/agent` to list available agents." },
    };
  }

  // Validate the target agent exists
  const normalizedTarget = normalizeAgentId(targetAgentId);
  const matchedAgent = agentIds.find((id) => normalizeAgentId(id) === normalizedTarget);

  if (!matchedAgent) {
    const agentList = formatAgentList(agentIds, currentAgentId, currentOverride);
    return {
      shouldContinue: false,
      reply: {
        text: `❌ Unknown agent: **${targetAgentId}**\n\n**Available Agents:**\n${agentList}`,
      },
    };
  }

  // Check if already on this agent
  if (normalizedTarget === normalizeAgentId(currentAgentId) && !currentOverride) {
    return {
      shouldContinue: false,
      reply: { text: `⚙️ Already using agent **${matchedAgent}**.` },
    };
  }

  // Set the agent override
  if (params.sessionEntry && params.sessionStore && params.sessionKey) {
    params.sessionEntry.agentOverride = matchedAgent;
    params.sessionEntry.updatedAt = Date.now();
    params.sessionStore[params.sessionKey] = params.sessionEntry;
    if (params.storePath) {
      await updateSessionStore(params.storePath, (store) => {
        store[params.sessionKey] = params.sessionEntry as SessionEntry;
      });
    }
  }

  return {
    shouldContinue: false,
    reply: {
      text: `⚙️ Switched to agent **${matchedAgent}**.\n\nMessages in this chat will now be handled by the "${matchedAgent}" agent.\nUse \`/agent reset\` to return to default routing.`,
    },
  };
};
