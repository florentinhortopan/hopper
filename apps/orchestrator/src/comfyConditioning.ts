/**
 * Inject image conditioning into a text2img SD1.5 API graph.
 *
 * Preferred: IPAdapter (when custom nodes + models exist on the server).
 * Fallback: img2img via LoadImage → ImageScale → VAEEncode → KSampler denoise.
 */

export type PromptGraph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;

export type ConditioningResult = {
  prompt: PromptGraph;
  mode: "ipadapter" | "img2img" | "text_only";
  imageRef?: string;
  denoise?: number;
};

function findNode(
  prompt: PromptGraph,
  classType: string,
): { id: string; node: PromptGraph[string] } | null {
  for (const [id, node] of Object.entries(prompt)) {
    if (node.class_type === classType) return { id, node };
  }
  return null;
}

function injectImg2Img(
  prompt: PromptGraph,
  imageRef: string,
  denoise: number,
  width: number,
  height: number,
): ConditioningResult {
  const next = structuredClone(prompt);
  const ckpt = findNode(next, "CheckpointLoaderSimple");
  const sampler = findNode(next, "KSampler");
  if (!ckpt || !sampler) {
    return { prompt: next, mode: "text_only" };
  }

  next["20"] = {
    class_type: "LoadImage",
    inputs: { image: imageRef },
  };
  next["21"] = {
    class_type: "ImageScale",
    inputs: {
      image: ["20", 0],
      width,
      height,
      upscale_method: "bilinear",
      crop: "center",
    },
  };
  next["22"] = {
    class_type: "VAEEncode",
    inputs: {
      pixels: ["21", 0],
      vae: [ckpt.id, 2],
    },
  };

  sampler.node.inputs.latent_image = ["22", 0];
  sampler.node.inputs.denoise = denoise;

  return { prompt: next, mode: "img2img", imageRef, denoise };
}

/**
 * IPAdapter Plus-style graph (best-effort). Class names vary by pack version;
 * caller should only invoke when nodes are confirmed present.
 */
function injectIpAdapter(
  prompt: PromptGraph,
  imageRef: string,
  weight: number,
  applyClass: string,
): ConditioningResult {
  const next = structuredClone(prompt);
  const ckpt = findNode(next, "CheckpointLoaderSimple");
  const sampler = findNode(next, "KSampler");
  if (!ckpt || !sampler) {
    return { prompt: next, mode: "text_only" };
  }

  next["30"] = {
    class_type: "LoadImage",
    inputs: { image: imageRef },
  };
  next["31"] = {
    class_type: "IPAdapterModelLoader",
    inputs: {
      ipadapter_file: "ip-adapter_sd15.safetensors",
    },
  };
  next["32"] = {
    class_type: "CLIPVisionLoader",
    inputs: {
      clip_name: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
    },
  };

  // IPAdapterAdvanced (cubiq) requires combine_embeds + embeds_scaling;
  // older IPAdapterApply ignores extras.
  next["33"] = {
    class_type: applyClass,
    inputs: {
      model: [ckpt.id, 0],
      ipadapter: ["31", 0],
      image: ["30", 0],
      clip_vision: ["32", 0],
      weight,
      weight_type: "linear",
      combine_embeds: "concat",
      start_at: 0,
      end_at: 1,
      embeds_scaling: "V only",
    },
  };

  sampler.node.inputs.model = ["33", 0];

  return { prompt: next, mode: "ipadapter", imageRef };
}

export function applyImageConditioning(
  prompt: PromptGraph,
  opts: {
    imageRef: string;
    denoise: number;
    width: number;
    height: number;
    preferIpAdapter: boolean;
    ipAdapterApplyClass?: string | null;
    ipAdapterWeight?: number;
  },
): ConditioningResult {
  if (opts.preferIpAdapter && opts.ipAdapterApplyClass) {
    try {
      return injectIpAdapter(
        prompt,
        opts.imageRef,
        opts.ipAdapterWeight ?? 0.75,
        opts.ipAdapterApplyClass,
      );
    } catch {
      /* fall through */
    }
  }
  return injectImg2Img(
    prompt,
    opts.imageRef,
    opts.denoise,
    opts.width,
    opts.height,
  );
}

export function pickIpAdapterApplyClass(
  objectInfo: Record<string, unknown>,
): string | null {
  for (const name of [
    "IPAdapterAdvanced",
    "IPAdapterApply",
    "IPAdapter",
    "IPAdapterModelHelper",
  ]) {
    if (objectInfo[name]) return name;
  }
  return null;
}

/** Which local patch key to use as the primary visual reference for this knob. */
export function primaryRefPatchKey(
  knob: "hands" | "attire" | "background" | "prop",
): "productRef" | "talentRef" | "wardrobeRef" | "backgroundRef" {
  if (knob === "attire") return "talentRef";
  if (knob === "background") return "talentRef";
  if (knob === "prop") return "productRef";
  return "productRef";
}
