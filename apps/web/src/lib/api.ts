import type {
  Brief,
  Campaign,
  CampaignIngredientSet,
  DesignTokens,
  ImportSession,
  IngredientKindDef,
  IngredientRail,
  Job,
  LibraryItem,
  LibraryKind,
  Matrix,
  OutputSize,
  PolicyViolation,
  PromptPack,
  ReviewEntry,
  TalentContract,
} from "@attatta/shared";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: HeadersInit = {
    ...(init?.headers || {}),
  };
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!isForm && !(headers as Record<string, string>)["Content-Type"]) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listCampaigns: (includeArchived = false) =>
    req<Campaign[]>(`/campaigns${includeArchived ? "?includeArchived=1" : ""}`),
  createCampaign: (name: string) =>
    req<Campaign>("/campaigns", { method: "POST", body: JSON.stringify({ name }) }),
  getCampaign: (id: string) => req<Campaign>(`/campaigns/${id}`),
  patchCampaign: (
    id: string,
    body: {
      name?: string;
      archived?: boolean;
      modelProfileId?: string;
      libraryId?: string;
      assemblyRecipe?: import("@attatta/shared").AssemblyRecipe;
    },
  ) => req<Campaign>(`/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCampaign: (id: string) =>
    req<void>(`/campaigns/${id}`, { method: "DELETE" }),
  putBrief: (id: string, brief: Brief) =>
    req<Campaign>(`/campaigns/${id}/brief`, { method: "PUT", body: JSON.stringify(brief) }),
  putTokens: (id: string, designTokenPackId: string) =>
    req<Campaign>(`/campaigns/${id}/tokens`, {
      method: "PUT",
      body: JSON.stringify({ designTokenPackId }),
    }),
  putRail: (id: string, rail: IngredientRail) =>
    req<Campaign>(`/campaigns/${id}/rail`, { method: "PUT", body: JSON.stringify(rail) }),
  putMatrix: (id: string, matrix: Matrix) =>
    req<Campaign>(`/campaigns/${id}/matrix`, { method: "PUT", body: JSON.stringify(matrix) }),
  /** Per-row Comfy plate includes/omits + prompt overrides + scene slots. */
  patchCell: (
    id: string,
    cellId: string,
    body: {
      genOmitIds?: string[];
      /** null / "" clears override (auto prompt resumes). */
      promptOverride?: string | null;
      negativeOverride?: string | null;
      sceneSlots?: import("@attatta/shared").SceneSlot[];
    },
  ) =>
    req<Campaign>(`/campaigns/${id}/cells/${encodeURIComponent(cellId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  buildSparse: (id: string) =>
    req<Campaign>(`/campaigns/${id}/matrix/build-sparse`, { method: "POST", body: "{}" }),
  generatePlates: (
    id: string,
    cellIds?: string[],
    opts?: { forceRegen?: boolean },
  ) =>
    req<{ jobs: Job[] }>(`/campaigns/${id}/generate-plates`, {
      method: "POST",
      body: JSON.stringify({ cellIds, ...opts }),
    }),
  /** Matrix cells → Comfy variant stills (alias of generatePlates). */
  generateVariants: (
    id: string,
    cellIds?: string[],
    opts?: { forceRegen?: boolean },
  ) =>
    req<{ jobs: Job[] }>(`/campaigns/${id}/generate-variants`, {
      method: "POST",
      body: JSON.stringify({ cellIds, ...opts }),
    }),
  /** Comfy each missing aspect size, then assemble — no cross-aspect crop reuse. */
  generateMissingSizes: (
    id: string,
    cellIds?: string[],
    opts?: { forceRegen?: boolean; sizeIds?: string[] },
  ) =>
    req<{ jobs: Job[] }>(`/campaigns/${id}/generate-missing-sizes`, {
      method: "POST",
      body: JSON.stringify({ cellIds, ...opts }),
    }),
  preview: (
    id: string,
    cellIds?: string[],
    opts?: {
      skipComfy?: boolean;
      forceRegen?: boolean;
      copyIds?: string[];
      sizeIds?: string[];
      /** Remotion only for cell×size still missing preview/final */
      onlyMissing?: boolean;
    },
  ) =>
    req<{ jobs: Job[] }>(`/campaigns/${id}/preview`, {
      method: "POST",
      body: JSON.stringify({ cellIds, ...opts }),
    }),
  render: (
    id: string,
    cellIds?: string[],
    opts?: {
      skipComfy?: boolean;
      forceRegen?: boolean;
      copyIds?: string[];
      sizeIds?: string[];
      onlyMissing?: boolean;
    },
  ) =>
    req<{ jobs: Job[] }>(`/campaigns/${id}/render`, {
      method: "POST",
      body: JSON.stringify({ cellIds, ...opts }),
    }),
  comfyStatus: () =>
    req<{
      mode: string;
      baseUrl: string;
      isCloud: boolean;
      hasApiKey: boolean;
      modelProfile: string;
      health: { ok: boolean; mode: string; detail: unknown };
      pipeline?: Record<string, boolean>;
      readyWorkflows?: string[];
    }>("/comfy/status"),
  comfyCapabilities: () =>
    req<{
      mode: string;
      baseUrl: string;
      isCloud: boolean;
      hasApiKey: boolean;
      defaultModelProfile: string;
      fallbackModelProfile: string;
      health: { ok: boolean; mode: string; detail: unknown };
      pipeline: Record<string, boolean>;
      limitations: string[];
      remoteEndpoints: {
        local: { method: string; path: string; purpose: string }[];
        cloud: { method: string; path: string; purpose: string }[];
      };
      attattaEndpoints: {
        method: string;
        path: string;
        purpose: string;
        body?: string;
      }[];
      models: unknown;
      workflows: {
        workflowId: string;
        knobs: string[];
        description: string;
        profiles: {
          profileId: string;
          hasApiGraph: boolean;
          hasMap: boolean;
          ready: boolean;
          patchKeys: string[];
          notes: string;
        }[];
      }[];
    }>("/comfy/capabilities"),
  comfyTestGenerate: (body?: {
    prompt?: string;
    workflowId?: string;
    modelProfileId?: string;
  }) =>
    req<{
      assetId: string;
      assetPath: string;
      lineage: Record<string, unknown>;
    }>("/comfy/test-generate", {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),
  comfyGenerateCell: (
    campaignId: string,
    body: { cellId: string; sizeId?: string; force?: boolean },
  ) =>
    req<{
      assetId: string;
      assetPath: string;
      lineage: Record<string, unknown>;
      sizeId: string;
    }>(`/campaigns/${campaignId}/comfy-generate`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  jobs: (campaignId: string) => req<Job[]>(`/jobs?campaignId=${campaignId}`),
  cancelJob: (jobId: string) =>
    req<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      body: "{}",
    }),
  cancelCampaignJobs: (campaignId: string) =>
    req<{ jobs: Job[]; cancelled: number }>(
      `/campaigns/${encodeURIComponent(campaignId)}/jobs/cancel`,
      { method: "POST", body: "{}" },
    ),
  getReviews: (id: string) => req<ReviewEntry[]>(`/campaigns/${id}/reviews`),
  setReview: (
    id: string,
    cellId: string,
    body: { decision: string; reasonTags?: string[]; notes?: string },
  ) =>
    req<ReviewEntry>(
      `/campaigns/${id}/reviews/${encodeURIComponent(cellId)}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  package: (id: string) =>
    req<{ zipPath: string; downloadUrl: string }>(`/campaigns/${id}/package`, {
      method: "POST",
      body: "{}",
    }),
  library: (kind?: string, libraryId?: string) => {
    const q = new URLSearchParams();
    if (kind) q.set("kind", kind);
    if (libraryId) q.set("libraryId", libraryId);
    const qs = q.toString();
    return req<LibraryItem[]>(qs ? `/library?${qs}` : "/library");
  },
  listLibraryPacks: () =>
    req<
      Array<{
        id: string;
        name: string;
        version: string;
        notes: string;
        createdAt: string;
        updatedAt: string;
      }>
    >("/libraries"),
  createLibraryPack: (body: {
    name: string;
    id?: string;
    version?: string;
    notes?: string;
  }) =>
    req<{
      id: string;
      name: string;
      version: string;
      notes: string;
      createdAt: string;
      updatedAt: string;
    }>("/libraries", { method: "POST", body: JSON.stringify(body) }),
  duplicateLibraryPack: (
    id: string,
    body?: { name?: string; version?: string },
  ) =>
    req<{
      id: string;
      name: string;
      version: string;
      notes: string;
      createdAt: string;
      updatedAt: string;
    }>(`/libraries/${id}/duplicate`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),
  startLibraryImport: (libraryId: string, form: FormData) =>
    req<{
      session: ImportSession;
      job: Job;
    }>(`/libraries/${libraryId}/imports`, { method: "POST", body: form }),
  startLibraryImportJson: (
    libraryId: string,
    body: Record<string, unknown>,
  ) =>
    req<{ session: ImportSession; job: Job }>(
      `/libraries/${libraryId}/imports`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  getImportSession: (importId: string) =>
    req<ImportSession>(`/imports/${importId}`),
  classifyImport: (importId: string) =>
    req<ImportSession>(`/imports/${importId}/classify`, {
      method: "POST",
      body: "{}",
    }),
  patchImportRows: (
    importId: string,
    rows: Array<{
      id: string;
      suggestedKind?: LibraryKind;
      label?: string;
      tags?: string[];
      promptHint?: string;
      status?: "pending" | "accepted" | "rejected";
    }>,
  ) =>
    req<ImportSession>(`/imports/${importId}/rows`, {
      method: "PATCH",
      body: JSON.stringify({ rows }),
    }),
  commitImport: (importId: string) =>
    req<ImportSession>(`/imports/${importId}/commit`, {
      method: "POST",
      body: "{}",
    }),
  resyncImport: (importId: string) =>
    req<{ session: ImportSession; job: Job }>(
      `/imports/${importId}/resync`,
      { method: "POST", body: "{}" },
    ),
  importConnectorsStatus: () =>
    req<{
      dropbox: boolean;
      frameio: boolean;
      httpsAllowlist: string[];
      llm: { configured: boolean; baseUrl: string; model: string };
    }>("/imports/connectors/status"),
  browseDropbox: (path = "") =>
    req<Array<{ name: string; path: string; tag: "file" | "folder" }>>(
      `/imports/connectors/dropbox/browse?path=${encodeURIComponent(path)}`,
    ),
  browseFrameio: (accountId?: string) =>
    req<
      Array<{
        id: string;
        name: string;
        type: string;
        rootAssetId?: string;
      }>
    >(
      accountId
        ? `/imports/connectors/frameio/browse?accountId=${encodeURIComponent(accountId)}`
        : "/imports/connectors/frameio/browse",
    ),
  createLibraryItem: (form: FormData) =>
    req<LibraryItem>("/library", { method: "POST", body: form }),
  patchLibraryItem: (
    id: string,
    body: {
      label?: string;
      kind?: LibraryKind;
      tags?: string[];
      promptHint?: string;
      negativeHint?: string;
      locks?: { face_locked?: boolean; voice_locked?: boolean; performance_locked?: boolean };
    },
  ) => req<LibraryItem>(`/library/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteLibraryItem: (id: string) =>
    req<void>(`/library/${id}`, { method: "DELETE" }),
  ingredientKinds: () => req<IngredientKindDef[]>("/ingredient-kinds"),
  models: () =>
    req<{
      defaultProfileId?: string;
      profiles: Record<
        string,
        { id?: string; label?: string; status?: string; strengths?: string[] }
      >;
    }>("/models"),
  outputSizes: () => req<OutputSize[]>("/output-sizes"),
  campaignSizes: (id: string) =>
    req<{
      catalog: OutputSize[];
      selected: OutputSize[];
      modelProfileId: string;
      plan: {
        modelProfileId: string;
        sizes: OutputSize[];
        total: number;
        rows: {
          cellId: string;
          sizeId: string;
          label: string;
          aspect: string;
          width: number;
          height: number;
          status: string;
          previewPath: string | null;
          outputPath: string | null;
        }[];
      };
    }>(`/campaigns/${id}/sizes`),
  putCampaignSizes: (id: string, body: { sizeIds: string[] }) =>
    req<Campaign>(`/campaigns/${id}/sizes`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  assetPlan: (id: string) =>
    req<{
      modelProfileId: string;
      sizes: OutputSize[];
      total: number;
      rows: {
        cellId: string;
        sizeId: string;
        label: string;
        aspect: string;
        width: number;
        height: number;
        status: string;
        previewPath: string | null;
        outputPath: string | null;
      }[];
    }>(`/campaigns/${id}/asset-plan`),
  promptPack: (campaignId: string, cellId: string) =>
    req<PromptPack>(`/campaigns/${campaignId}/cells/${cellId}/prompt-pack`),
  campaignIngredients: (id: string) =>
    req<{
      ingredientSet: CampaignIngredientSet;
      contract: TalentContract;
      contractTalentId: string;
      items: (LibraryItem & { active: boolean })[];
    }>(`/campaigns/${id}/ingredients`),
  putCampaignIngredients: (id: string, body: CampaignIngredientSet) =>
    req<Campaign>(`/campaigns/${id}/ingredients`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  campaignPolicy: (id: string) =>
    req<{ ok: boolean; violations: PolicyViolation[] }>(`/campaigns/${id}/policy`),
  generateLibraryItem: (
    id: string,
    body?: {
      modelProfileId?: string;
      sourceTalentId?: string | null;
      campaignId?: string | null;
      /** Default video — partner R2V/Bria when talent video is available */
      outputMode?: "image" | "video";
    },
  ) =>
    req<{
      item: LibraryItem;
      job: Job;
      etaSeconds: number;
      outputMode: "image" | "video";
    }>(`/library/${id}/generate`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),
  getJob: (jobId: string) => req<Job>(`/jobs/${jobId}`),
  uploadLibraryMedia: async (id: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`${API}/library/${id}/media`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || res.statusText);
    }
    return res.json() as Promise<LibraryItem>;
  },
  tokens: () => req<DesignTokens[]>("/tokens"),
  createToken: (pack: DesignTokens, overwrite = false) =>
    req<DesignTokens>("/tokens", {
      method: "POST",
      body: JSON.stringify({ ...pack, overwrite }),
    }),
  saveToken: (pack: DesignTokens) =>
    req<DesignTokens>(`/tokens/${encodeURIComponent(pack.id)}`, {
      method: "PUT",
      body: JSON.stringify(pack),
    }),
  importTokens: (body: {
    format: "json" | "css";
    text: string;
    id?: string;
    label?: string;
  }) =>
    req<DesignTokens>("/tokens/import", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  fileUrl: (absolutePath: string) =>
    `${API}/files?path=${encodeURIComponent(absolutePath)}`,
  /** `rev` busts browser cache after upload / re-generate (same path, new bytes). */
  libraryMediaUrl: (itemId: string, rev?: string | number) =>
    rev == null || rev === ""
      ? `${API}/library/media/${itemId}`
      : `${API}/library/media/${itemId}?v=${encodeURIComponent(String(rev))}`,
};
