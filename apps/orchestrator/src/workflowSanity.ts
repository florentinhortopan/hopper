import { looksLikeComfyApiGraph } from "@attatta/shared";
import { getObjectInfo, resolveComfyTarget } from "./comfyClient.js";

export type WorkflowSanityStatus = "ok" | "warn" | "fail" | "skipped";

export type WorkflowSanityResult = {
  ok: boolean;
  status: WorkflowSanityStatus;
  nodeCount: number;
  classTypes: string[];
  issues: string[];
  /** True when we compared class_types to a live Comfy /object_info */
  checkedAgainstComfy: boolean;
};

const OUTPUTISH = new Set([
  "SaveImage",
  "SaveVideo",
  "VHS_VideoCombine",
  "VHS_SaveVideo",
  "PreviewImage",
  "PreviewVideo",
  "SaveAnimatedWEBP",
  "SaveAnimatedPNG",
  "Image Save",
  "VideoCombine",
]);

function isLinkRef(v: unknown): v is [string | number, number] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    (typeof v[0] === "string" || typeof v[0] === "number") &&
    typeof v[1] === "number"
  );
}

/**
 * Structural (+ optional live Comfy) sanity check for a ComfyUI API-format graph.
 */
export async function sanityCheckComfyApiGraph(
  data: unknown,
  opts?: { checkComfy?: boolean },
): Promise<WorkflowSanityResult> {
  const issues: string[] = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      status: "fail",
      nodeCount: 0,
      classTypes: [],
      issues: ["Not a JSON object (expected Comfy API prompt graph)"],
      checkedAgainstComfy: false,
    };
  }

  if (!looksLikeComfyApiGraph(data)) {
    return {
      ok: false,
      status: "fail",
      nodeCount: 0,
      classTypes: [],
      issues: ["Does not look like a ComfyUI API graph (nodes need class_type)"],
      checkedAgainstComfy: false,
    };
  }

  const graph = data as Record<string, unknown>;
  const nodeIds = new Set(Object.keys(graph));
  const classTypes: string[] = [];
  let hasOutputish = false;

  for (const [id, raw] of Object.entries(graph)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push(`Node ${id}: expected object with class_type + inputs`);
      continue;
    }
    const node = raw as { class_type?: unknown; inputs?: unknown };
    if (typeof node.class_type !== "string" || !node.class_type.trim()) {
      issues.push(`Node ${id}: missing class_type`);
      continue;
    }
    classTypes.push(node.class_type);
    if (OUTPUTISH.has(node.class_type)) hasOutputish = true;

    if (!node.inputs || typeof node.inputs !== "object" || Array.isArray(node.inputs)) {
      issues.push(`Node ${id} (${node.class_type}): missing inputs object`);
      continue;
    }
    for (const [inputKey, val] of Object.entries(
      node.inputs as Record<string, unknown>,
    )) {
      if (!isLinkRef(val)) continue;
      const srcId = String(val[0]);
      if (!nodeIds.has(srcId)) {
        issues.push(
          `Node ${id}.${inputKey}: link to missing node "${srcId}"`,
        );
      }
    }
  }

  if (!classTypes.length) {
    issues.push("Graph has no valid nodes");
  }
  if (classTypes.length && !hasOutputish) {
    issues.push(
      "No obvious Save/Preview output node (SaveImage, VHS_VideoCombine, …) — may still run if a custom output exists",
    );
  }

  let checkedAgainstComfy = false;
  if (opts?.checkComfy !== false && classTypes.length) {
    try {
      const info = await getObjectInfo(resolveComfyTarget());
      if (info && Object.keys(info).length) {
        checkedAgainstComfy = true;
        const missing = [...new Set(classTypes)].filter((c) => !info[c]);
        if (missing.length) {
          issues.push(
            `Comfy missing node class(es): ${missing.slice(0, 8).join(", ")}${
              missing.length > 8 ? ` (+${missing.length - 8} more)` : ""
            }`,
          );
        }
      } else {
        issues.push("Comfy /object_info unavailable — skipped live node check");
      }
    } catch {
      issues.push("Comfy unreachable — skipped live node check");
    }
  }

  const hard = issues.filter(
    (i) =>
      i.includes("missing class_type") ||
      i.includes("expected object") ||
      i.includes("missing inputs") ||
      i.includes("link to missing") ||
      i.includes("no valid nodes") ||
      i.includes("Does not look") ||
      i.includes("Not a JSON"),
  );
  const status: WorkflowSanityStatus = hard.length
    ? "fail"
    : issues.length
      ? "warn"
      : "ok";

  return {
    ok: status !== "fail",
    status,
    nodeCount: classTypes.length,
    classTypes: [...new Set(classTypes)],
    issues,
    checkedAgainstComfy,
  };
}

export function sanityCheckAttattaWorkflowPackage(data: unknown): WorkflowSanityResult {
  const issues: string[] = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      status: "fail",
      nodeCount: 0,
      classTypes: [],
      issues: ["Not a JSON object"],
      checkedAgainstComfy: false,
    };
  }
  const obj = data as Record<string, unknown>;
  if (obj.version == null) issues.push("Missing version");
  if (!Array.isArray(obj.steps) && !obj.baseWorkflowId) {
    issues.push("Expected steps[] and/or baseWorkflowId");
  }
  const status: WorkflowSanityStatus = issues.length ? "warn" : "ok";
  return {
    ok: true,
    status,
    nodeCount: Array.isArray(obj.steps) ? obj.steps.length : 0,
    classTypes: [],
    issues,
    checkedAgainstComfy: false,
  };
}

/**
 * Structural sanity for ComfyUI canvas/save-format workflows (`nodes` + `links`).
 * Does not convert to API format or execute.
 */
export function sanityCheckComfyUiWorkflow(data: unknown): WorkflowSanityResult {
  const issues: string[] = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      status: "fail",
      nodeCount: 0,
      classTypes: [],
      issues: ["Not a JSON object (expected ComfyUI canvas workflow)"],
      checkedAgainstComfy: false,
    };
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.nodes) || !o.nodes.length) {
    return {
      ok: false,
      status: "fail",
      nodeCount: 0,
      classTypes: [],
      issues: ["Missing nodes[]"],
      checkedAgainstComfy: false,
    };
  }

  const classTypes: string[] = [];
  const nodeIds = new Set<number>();
  let hasOutputish = false;

  for (const raw of o.nodes) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push("Malformed node entry (expected object)");
      continue;
    }
    const n = raw as { id?: unknown; type?: unknown };
    if (typeof n.type !== "string" || !n.type.trim()) {
      issues.push("Node missing type");
      continue;
    }
    classTypes.push(n.type);
    if (OUTPUTISH.has(n.type)) hasOutputish = true;
    if (typeof n.id === "number") nodeIds.add(n.id);
  }

  if (Array.isArray(o.links)) {
    for (const link of o.links) {
      if (!Array.isArray(link) || link.length < 5) {
        issues.push("Malformed link entry");
        continue;
      }
      const src = link[1];
      const dst = link[3];
      if (typeof src === "number" && nodeIds.size && !nodeIds.has(src)) {
        issues.push(`Link references missing source node ${src}`);
      }
      if (typeof dst === "number" && nodeIds.size && !nodeIds.has(dst)) {
        issues.push(`Link references missing target node ${dst}`);
      }
    }
  } else if (o.nodes.length > 1) {
    issues.push("No links[] — multi-node canvas workflow usually has links");
  }

  if (classTypes.length && !hasOutputish) {
    issues.push(
      "No obvious Save/Preview output node — may still be valid with custom outputs",
    );
  }
  issues.push(
    "UI/canvas format — export API format for Magic execution (not run in Magic MVP)",
  );

  const hard = issues.filter(
    (i) =>
      i.includes("Missing nodes") ||
      i.includes("Not a JSON") ||
      i.includes("Malformed node") ||
      i.includes("Node missing type"),
  );
  // The API-format hint is always a soft warn, not a hard fail
  const softIssues = issues.filter((i) => !hard.includes(i));
  const status: WorkflowSanityStatus = hard.length
    ? "fail"
    : softIssues.length
      ? "warn"
      : "ok";

  return {
    ok: status !== "fail",
    status,
    nodeCount: classTypes.length,
    classTypes: [...new Set(classTypes)],
    issues,
    checkedAgainstComfy: false,
  };
}
