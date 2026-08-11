import type { Job } from "@attatta/shared";
import { cancelComfyJob, resolveComfyTarget } from "./comfyClient.js";
import { getJob, listJobs, upsertJob } from "./store.js";

const controllers = new Map<string, AbortController>();
const comfyPromptIds = new Map<string, string>();

export class JobCancelledError extends Error {
  constructor(jobId?: string) {
    super(jobId ? `Job cancelled: ${jobId}` : "Job cancelled");
    this.name = "JobCancelledError";
  }
}

export function isCancelledError(err: unknown): boolean {
  if (err instanceof JobCancelledError) return true;
  if (err instanceof Error && /cancel/i.test(err.name + err.message)) return true;
  return false;
}

/** Attach (or reuse) an AbortController for this queue job. */
export function attachJobControl(jobId: string): AbortSignal {
  let ac = controllers.get(jobId);
  if (!ac) {
    ac = new AbortController();
    controllers.set(jobId, ac);
  }
  return ac.signal;
}

export function jobSignal(jobId: string): AbortSignal | undefined {
  return controllers.get(jobId)?.signal;
}

export function assertJobNotCancelled(jobId: string) {
  if (controllers.get(jobId)?.signal.aborted) {
    throw new JobCancelledError(jobId);
  }
}

export function setJobComfyPromptId(jobId: string, promptId: string) {
  comfyPromptIds.set(jobId, promptId);
}

function releaseJobControl(jobId: string) {
  controllers.delete(jobId);
  comfyPromptIds.delete(jobId);
}

function markCancelled(job: Job, message = "Cancelled — tokens saved where possible") {
  const next = upsertJob({
    ...job,
    status: "cancelled",
    progress: job.progress,
    message,
    updatedAt: new Date().toISOString(),
  });
  releaseJobControl(job.id);
  return next;
}

/** Cancel one job: abort local work + ask Comfy to stop the prompt if known. */
export async function cancelJob(jobId: string): Promise<Job | null> {
  const job = getJob(jobId);
  if (!job) return null;
  if (job.status !== "queued" && job.status !== "running") return job;

  controllers.get(jobId)?.abort();
  const promptId = comfyPromptIds.get(jobId);
  if (promptId) {
    try {
      await cancelComfyJob(resolveComfyTarget(), promptId);
    } catch {
      /* best-effort — local abort still stops waiting */
    }
  }
  return markCancelled(job);
}

/** Cancel all queued/running jobs for a campaign (or `_library`). */
export async function cancelCampaignJobs(campaignId: string): Promise<Job[]> {
  const active = listJobs(campaignId).filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const out: Job[] = [];
  for (const j of active) {
    const next = await cancelJob(j.id);
    if (next) out.push(next);
  }
  return out;
}

export function finishJobControl(jobId: string) {
  releaseJobControl(jobId);
}
