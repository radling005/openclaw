import { listAgentIds } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { normalizeAgentId } from "./session-key.js";

/**
 * Resolve the effective agent ID for a session, taking into account
 * any inline agent override set via the /agent command.
 *
 * @param params.cfg - OpenClaw config
 * @param params.routeAgentId - Agent ID from routing (default)
 * @param params.sessionEntry - Session entry (may contain agentOverride)
 * @returns The effective agent ID to use for processing
 */
export function resolveEffectiveAgentId(params: {
  cfg: OpenClawConfig;
  routeAgentId: string;
  sessionEntry?: SessionEntry | null;
}): string {
  const { cfg, routeAgentId, sessionEntry } = params;

  // No override set - use routing result
  if (!sessionEntry?.agentOverride) {
    return routeAgentId;
  }

  const overrideAgentId = sessionEntry.agentOverride.trim();
  if (!overrideAgentId) {
    return routeAgentId;
  }

  // Validate that the override agent exists
  const validAgentIds = listAgentIds(cfg);
  const normalizedOverride = normalizeAgentId(overrideAgentId);
  const isValid = validAgentIds.some((id) => normalizeAgentId(id) === normalizedOverride);

  if (!isValid) {
    // Override agent doesn't exist - fall back to routing result
    return routeAgentId;
  }

  return overrideAgentId;
}

/**
 * Check if an agent override is active for a session.
 */
export function hasAgentOverride(sessionEntry?: SessionEntry | null): boolean {
  return Boolean(sessionEntry?.agentOverride?.trim());
}
