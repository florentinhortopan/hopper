import {
  LiveConnectionSchema,
  type LiveConnection,
  type LiveConnectionId,
  type LiveConnectionState,
} from "@attatta/shared";
import { getCampaign, getReviews, listJobs } from "./store.js";
import { emitCampaignEvent } from "./campaignEvents.js";
import { buildCeltraPreview } from "./packageExport.js";
import { getComfyStatus } from "./comfyAdapter.js";

const lastSynced = new Map<LiveConnectionId, string>();

function nowIso() {
  return new Date().toISOString();
}

function markSynced(id: LiveConnectionId) {
  const at = nowIso();
  lastSynced.set(id, at);
  return at;
}

export async function getLiveConnections(
  campaignId?: string | null,
): Promise<{ connections: LiveConnection[]; checkedAt: string }> {
  const checkedAt = nowIso();
  const connections = await Promise.all([
    probeComfy(checkedAt),
    probeHopper(checkedAt, campaignId),
    probeCeltra(checkedAt, campaignId),
  ]);
  return {
    connections: connections.map((c) => LiveConnectionSchema.parse(c)),
    checkedAt,
  };
}

async function probeComfy(checkedAt: string): Promise<LiveConnection> {
  try {
    const status = await getComfyStatus();
    const ok = Boolean(status.health?.ok);
    const state: LiveConnectionState = ok
      ? "ok"
      : status.hasApiKey || status.baseUrl
        ? "degraded"
        : "down";
    return {
      id: "comfy",
      label: "ComfyUI",
      state,
      detail: ok
        ? `${status.mode} · ${status.modelProfile}`
        : status.health?.ok === false
          ? `Unreachable · ${status.mode}`
          : "Not configured",
      endpoint: status.baseUrl || "",
      lastCheckedAt: checkedAt,
      lastSyncedAt: lastSynced.get("comfy") ?? null,
      notes: [
        status.isCloud ? "Cloud Comfy" : "Local / self-hosted Comfy",
        status.hasApiKey ? "API key present" : "No API key",
        `${(status.readyWorkflows || []).length} ready workflow(s)`,
      ],
    };
  } catch (err) {
    return {
      id: "comfy",
      label: "ComfyUI",
      state: "down",
      detail: err instanceof Error ? err.message : String(err),
      endpoint: "",
      lastCheckedAt: checkedAt,
      lastSyncedAt: lastSynced.get("comfy") ?? null,
      notes: ["Probe failed"],
    };
  }
}

async function probeHopper(
  checkedAt: string,
  campaignId?: string | null,
): Promise<LiveConnection> {
  let detail = "ATTATTA review bus (simulated API)";
  const notes = [
    "Hopper is ATTATTA-owned — Keep/Kill + jobs, no external API yet",
    "Resync refreshes jobs/reviews for this campaign",
  ];
  if (campaignId) {
    try {
      await getCampaign(campaignId);
      const jobs = listJobs(campaignId);
      const reviews = await getReviews(campaignId);
      const live = jobs.filter(
        (j) => j.status === "queued" || j.status === "running",
      ).length;
      detail = `${jobs.length} job(s) · ${live} live · ${reviews.length} review(s)`;
    } catch {
      detail = "Campaign unavailable";
    }
  }
  return {
    id: "hopper",
    label: "Hopper",
    state: "simulated",
    detail,
    endpoint: "attatta://hopper",
    lastCheckedAt: checkedAt,
    lastSyncedAt: lastSynced.get("hopper") ?? null,
    notes,
  };
}

async function probeCeltra(
  checkedAt: string,
  campaignId?: string | null,
): Promise<LiveConnection> {
  const notes = [
    "Today: local Celtra matrix preview + zip package (one-way)",
    "Future: Celtra ingest API — resync will push CSV/XLS and notify the designer",
  ];
  if (!campaignId) {
    return {
      id: "celtra",
      label: "Celtra",
      state: "simulated",
      detail: "Package export ready (no cloud API yet)",
      endpoint: "",
      lastCheckedAt: checkedAt,
      lastSyncedAt: lastSynced.get("celtra") ?? null,
      notes,
    };
  }
  try {
    const campaign = await getCampaign(campaignId);
    const preview = await buildCeltraPreview(campaignId);
    return {
      id: "celtra",
      label: "Celtra",
      state: "simulated",
      detail: `${preview.rowCount} row(s) · ${preview.packableCount} packable · ${campaign.celtraTemplateProfileId}`,
      endpoint: "attatta://celtra-package",
      lastCheckedAt: checkedAt,
      lastSyncedAt: lastSynced.get("celtra") ?? null,
      notes,
    };
  } catch (err) {
    return {
      id: "celtra",
      label: "Celtra",
      state: "degraded",
      detail: err instanceof Error ? err.message : String(err),
      endpoint: "attatta://celtra-package",
      lastCheckedAt: checkedAt,
      lastSyncedAt: lastSynced.get("celtra") ?? null,
      notes,
    };
  }
}

export async function resyncLiveConnection(
  id: LiveConnectionId,
  campaignId?: string | null,
): Promise<{ connection: LiveConnection; message: string }> {
  const syncedAt = markSynced(id);

  if (id === "comfy") {
    const connection = await probeComfy(nowIso());
    connection.lastSyncedAt = syncedAt;
    if (campaignId) {
      emitCampaignEvent({
        campaignId,
        column: "magic",
        type: "system",
        summary: `ComfyUI resync · ${connection.state} · ${connection.detail}`,
        payload: { connectionId: "comfy", state: connection.state },
      });
    }
    return {
      connection: LiveConnectionSchema.parse(connection),
      message:
        connection.state === "ok"
          ? "ComfyUI reachable — workflows refreshed"
          : `ComfyUI ${connection.state} — ${connection.detail}`,
    };
  }

  if (id === "hopper") {
    if (!campaignId) throw new Error("campaignId required to resync Hopper");
    await getCampaign(campaignId);
    const jobs = listJobs(campaignId);
    await getReviews(campaignId);
    const connection = await probeHopper(nowIso(), campaignId);
    connection.lastSyncedAt = syncedAt;
    emitCampaignEvent({
      campaignId,
      column: "hopper",
      type: "system",
      summary: `Hopper resync (simulated) · ${jobs.length} job(s)`,
      payload: { connectionId: "hopper", jobCount: jobs.length },
    });
    return {
      connection: LiveConnectionSchema.parse(connection),
      message: "Hopper state refreshed from ATTATTA (simulated API)",
    };
  }

  if (id === "celtra") {
    if (!campaignId) throw new Error("campaignId required to resync Celtra");
    const preview = await buildCeltraPreview(campaignId);
    const connection = await probeCeltra(nowIso(), campaignId);
    connection.lastSyncedAt = syncedAt;
    emitCampaignEvent({
      campaignId,
      column: "celtra",
      type: "celtra_preview",
      summary: `Celtra matrix resync · ${preview.rowCount} row(s) · ${preview.packableCount} packable`,
      payload: {
        connectionId: "celtra",
        rowCount: preview.rowCount,
        packableCount: preview.packableCount,
        futureApi:
          "When Celtra API lands, resync will push CSV/XLS and notify the designer",
      },
    });
    return {
      connection: LiveConnectionSchema.parse(connection),
      message:
        "Celtra matrix preview rebuilt. Future API resync will update CSV/XLS and notify the Celtra designer.",
    };
  }

  throw new Error(`Unknown connection ${id}`);
}
