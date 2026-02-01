import type { HeartbeatRunResult } from "../../infra/heartbeat-wake.js";
import type { CronJob } from "../types.js";
import { computeJobNextRunAtMs, nextWakeAtMs, resolveJobPayloadTextForMain } from "./jobs.js";
import { locked } from "./locked.js";
import type { CronEvent, CronServiceState } from "./state.js";
import { ensureLoaded, persist } from "./store.js";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Maximum number of attempts for one-shot "at" jobs before force-disabling.
 * This is a safety mechanism to prevent infinite retry loops.
 */
const MAX_ONE_SHOT_ATTEMPTS = 3;

export function armTimer(state: CronServiceState) {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;
  if (!state.deps.cronEnabled) {
    return;
  }
  const nextAt = nextWakeAtMs(state);
  if (!nextAt) {
    return;
  }
  const delay = Math.max(nextAt - state.deps.nowMs(), 0);
  // Avoid TimeoutOverflowWarning when a job is far in the future.
  const clampedDelay = Math.min(delay, MAX_TIMEOUT_MS);
  state.timer = setTimeout(() => {
    void onTimer(state).catch((err) => {
      state.deps.log.error({ err: String(err) }, "cron: timer tick failed");
    });
  }, clampedDelay);
  state.timer.unref?.();
}

export async function onTimer(state: CronServiceState) {
  if (state.running) {
    return;
  }
  state.running = true;
  try {
    await locked(state, async () => {
      await ensureLoaded(state);
      await runDueJobs(state);
      await persist(state);
      armTimer(state);
    });
  } finally {
    state.running = false;
  }
}

export async function runDueJobs(state: CronServiceState) {
  if (!state.store) {
    return;
  }
  const now = state.deps.nowMs();
  const due = state.store.jobs.filter((j) => {
    if (!j.enabled) {
      return false;
    }
    if (typeof j.state.runningAtMs === "number") {
      return false;
    }
    // Safety check: one-shot jobs that have already run should not be due.
    // This catches cases where the job wasn't properly disabled.
    if (j.schedule.kind === "at" && j.state.lastRunAtMs) {
      state.deps.log.warn(
        { jobId: j.id, lastRunAtMs: j.state.lastRunAtMs },
        "cron: one-shot job has lastRunAtMs but is still enabled, disabling",
      );
      j.enabled = false;
      j.state.nextRunAtMs = undefined;
      return false;
    }
    const next = j.state.nextRunAtMs;
    return typeof next === "number" && now >= next;
  });
  for (const job of due) {
    await executeJob(state, job, now, { forced: false });
  }
}

export async function executeJob(
  state: CronServiceState,
  job: CronJob,
  nowMs: number,
  opts: { forced: boolean },
) {
  const isOneShot = job.schedule.kind === "at";

  // Safety check: if this one-shot job has already run, disable it and skip.
  // This catches cases where the job wasn't properly disabled after a previous run.
  if (isOneShot && !opts.forced) {
    const attempts = job.state.failedAttempts ?? 0;
    if (job.state.lastRunAtMs) {
      state.deps.log.warn(
        { jobId: job.id, lastRunAtMs: job.state.lastRunAtMs },
        "cron: one-shot job already ran, disabling",
      );
      job.enabled = false;
      job.state.nextRunAtMs = undefined;
      return;
    }
    if (attempts >= MAX_ONE_SHOT_ATTEMPTS) {
      state.deps.log.warn(
        { jobId: job.id, attempts },
        "cron: one-shot job exceeded max attempts, disabling",
      );
      job.enabled = false;
      job.state.nextRunAtMs = undefined;
      job.state.lastStatus = "error";
      job.state.lastError = `exceeded max attempts (${MAX_ONE_SHOT_ATTEMPTS})`;
      emit(state, {
        jobId: job.id,
        action: "finished",
        status: "error",
        error: job.state.lastError,
      });
      return;
    }
  }

  const startedAt = state.deps.nowMs();
  job.state.runningAtMs = startedAt;
  job.state.lastError = undefined;
  emit(state, { jobId: job.id, action: "started", runAtMs: startedAt });

  let deleted = false;

  const finish = async (
    status: "ok" | "error" | "skipped",
    err?: string,
    summary?: string,
    outputText?: string,
  ) => {
    const endedAt = state.deps.nowMs();
    job.state.runningAtMs = undefined;
    job.state.lastRunAtMs = startedAt;
    job.state.lastStatus = status;
    job.state.lastDurationMs = Math.max(0, endedAt - startedAt);
    job.state.lastError = err;

    const shouldDelete =
      job.schedule.kind === "at" && status === "ok" && job.deleteAfterRun === true;

    if (!shouldDelete) {
      if (job.schedule.kind === "at") {
        // One-shot "at" jobs: disable after any attempt (ok, skipped, or error).
        // This prevents infinite retry loops when jobs are skipped (e.g., quiet-hours).
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
        // Track failed attempts for safety (in case the job is somehow re-enabled)
        if (status !== "ok") {
          job.state.failedAttempts = (job.state.failedAttempts ?? 0) + 1;
        }
      } else if (job.enabled) {
        job.state.nextRunAtMs = computeJobNextRunAtMs(job, endedAt);
      } else {
        job.state.nextRunAtMs = undefined;
      }
    }

    emit(state, {
      jobId: job.id,
      action: "finished",
      status,
      error: err,
      summary,
      runAtMs: startedAt,
      durationMs: job.state.lastDurationMs,
      nextRunAtMs: job.state.nextRunAtMs,
    });

    if (shouldDelete && state.store) {
      state.store.jobs = state.store.jobs.filter((j) => j.id !== job.id);
      deleted = true;
      emit(state, { jobId: job.id, action: "removed" });
    }

    if (job.sessionTarget === "isolated") {
      const prefix = job.isolation?.postToMainPrefix?.trim() || "Cron";
      const mode = job.isolation?.postToMainMode ?? "summary";

      let body = (summary ?? err ?? status).trim();
      if (mode === "full") {
        // Prefer full agent output if available; fall back to summary.
        const maxCharsRaw = job.isolation?.postToMainMaxChars;
        const maxChars = Number.isFinite(maxCharsRaw) ? Math.max(0, maxCharsRaw as number) : 8000;
        const fullText = (outputText ?? "").trim();
        if (fullText) {
          body = fullText.length > maxChars ? `${fullText.slice(0, maxChars)}…` : fullText;
        }
      }

      const statusPrefix = status === "ok" ? prefix : `${prefix} (${status})`;
      state.deps.enqueueSystemEvent(`${statusPrefix}: ${body}`, {
        agentId: job.agentId,
      });
      if (job.wakeMode === "now") {
        state.deps.requestHeartbeatNow({ reason: `cron:${job.id}:post` });
      }
    }
  };

  try {
    if (job.sessionTarget === "main") {
      const text = resolveJobPayloadTextForMain(job);
      if (!text) {
        const kind = job.payload.kind;
        await finish(
          "skipped",
          kind === "systemEvent"
            ? "main job requires non-empty systemEvent text"
            : 'main job requires payload.kind="systemEvent"',
        );
        return;
      }
      state.deps.enqueueSystemEvent(text, { agentId: job.agentId });
      if (job.wakeMode === "now" && state.deps.runHeartbeatOnce) {
        const reason = `cron:${job.id}`;
        const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
        const maxWaitMs = 2 * 60_000;
        const waitStartedAt = state.deps.nowMs();

        let heartbeatResult: HeartbeatRunResult;
        for (;;) {
          heartbeatResult = await state.deps.runHeartbeatOnce({ reason });
          if (
            heartbeatResult.status !== "skipped" ||
            heartbeatResult.reason !== "requests-in-flight"
          ) {
            break;
          }
          if (state.deps.nowMs() - waitStartedAt > maxWaitMs) {
            heartbeatResult = {
              status: "skipped",
              reason: "timeout waiting for main lane to become idle",
            };
            break;
          }
          await delay(250);
        }

        if (heartbeatResult.status === "ran") {
          await finish("ok", undefined, text);
        } else if (heartbeatResult.status === "skipped") {
          await finish("skipped", heartbeatResult.reason, text);
        } else {
          await finish("error", heartbeatResult.reason, text);
        }
      } else {
        // wakeMode is "next-heartbeat" or runHeartbeatOnce not available
        state.deps.requestHeartbeatNow({ reason: `cron:${job.id}` });
        await finish("ok", undefined, text);
      }
      return;
    }

    if (job.payload.kind !== "agentTurn") {
      await finish("skipped", "isolated job requires payload.kind=agentTurn");
      return;
    }

    const res = await state.deps.runIsolatedAgentJob({
      job,
      message: job.payload.message,
    });
    if (res.status === "ok") {
      await finish("ok", undefined, res.summary, res.outputText);
    } else if (res.status === "skipped") {
      await finish("skipped", undefined, res.summary, res.outputText);
    } else {
      await finish("error", res.error ?? "cron job failed", res.summary, res.outputText);
    }
  } catch (err) {
    await finish("error", String(err));
  } finally {
    job.updatedAtMs = nowMs;

    // Safety: ensure one-shot jobs are disabled after any execution attempt.
    // This is a defensive check in case finish() didn't complete properly.
    if (isOneShot && !deleted) {
      if (job.enabled) {
        state.deps.log.warn(
          { jobId: job.id },
          "cron: one-shot job still enabled after execution, force-disabling",
        );
        job.enabled = false;
      }
      job.state.nextRunAtMs = undefined;
    } else if (!opts.forced && job.enabled && !deleted) {
      // Keep nextRunAtMs in sync in case the schedule advanced during a long run.
      job.state.nextRunAtMs = computeJobNextRunAtMs(job, state.deps.nowMs());
    }
  }
}

export function wake(
  state: CronServiceState,
  opts: { mode: "now" | "next-heartbeat"; text: string },
) {
  const text = opts.text.trim();
  if (!text) {
    return { ok: false } as const;
  }
  state.deps.enqueueSystemEvent(text);
  if (opts.mode === "now") {
    state.deps.requestHeartbeatNow({ reason: "wake" });
  }
  return { ok: true } as const;
}

export function stopTimer(state: CronServiceState) {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = null;
}

export function emit(state: CronServiceState, evt: CronEvent) {
  try {
    state.deps.onEvent?.(evt);
  } catch {
    /* ignore */
  }
}
