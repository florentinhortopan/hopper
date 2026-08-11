import { z } from "zod";
import { LibraryKindSchema, MediaTypeSchema } from "./ingredientKinds.js";

export const LibraryPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Semver or free label e.g. 2026-Q3 */
  version: z.string().default("1.0.0"),
  notes: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LibraryPack = z.infer<typeof LibraryPackSchema>;

export const DEFAULT_LIBRARY_ID = "default";

export const ImportRemoteRefSchema = z.object({
  type: z.enum(["dropbox", "frameio", "https", "local"]),
  path: z.string().optional(),
  rev: z.string().optional(),
  assetId: z.string().optional(),
  versionId: z.string().optional(),
  url: z.string().optional(),
});
export type ImportRemoteRef = z.infer<typeof ImportRemoteRefSchema>;

export const ImportRowStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
]);
export type ImportRowStatus = z.infer<typeof ImportRowStatusSchema>;

export const ImportRowSchema = z.object({
  id: z.string(),
  /** Relative path under the import staging folder */
  file: z.string(),
  originalName: z.string(),
  suggestedKind: LibraryKindSchema.default("prop"),
  label: z.string().default(""),
  tags: z.array(z.string()).default([]),
  promptHint: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0),
  rationale: z.string().default(""),
  mediaType: MediaTypeSchema.default("video"),
  status: ImportRowStatusSchema.default("pending"),
  remoteRef: ImportRemoteRefSchema.optional(),
  error: z.string().nullable().default(null),
});
export type ImportRow = z.infer<typeof ImportRowSchema>;

export const ImportSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("zip") }),
  z.object({ type: z.literal("files") }),
  z.object({ type: z.literal("folder"), folderPath: z.string() }),
  z.object({ type: z.literal("dropbox"), dropboxPath: z.string() }),
  z.object({
    type: z.literal("frameio"),
    frameioFolderId: z.string(),
    frameioProjectId: z.string().optional(),
  }),
  z.object({ type: z.literal("https"), remoteUrl: z.string() }),
]);
export type ImportSource = z.infer<typeof ImportSourceSchema>;

export const ImportSessionStatusSchema = z.enum([
  "staging",
  "classifying",
  "review",
  "committing",
  "done",
  "failed",
  "cancelled",
]);
export type ImportSessionStatus = z.infer<typeof ImportSessionStatusSchema>;

export const ImportSessionSchema = z.object({
  id: z.string(),
  libraryId: z.string(),
  source: ImportSourceSchema,
  status: ImportSessionStatusSchema.default("staging"),
  autoClassify: z.boolean().default(true),
  progress: z.number().min(0).max(1).default(0),
  message: z.string().default(""),
  jobId: z.string().nullable().default(null),
  rows: z.array(ImportRowSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ImportSession = z.infer<typeof ImportSessionSchema>;
