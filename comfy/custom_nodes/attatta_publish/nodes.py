"""
ATTATTA Publish — terminal ComfyUI node that POSTs the finished plate
into ATTATTA Library (optional campaign activate).

Install (local ComfyUI):
  ln -s /path/to/ATTATTA/comfy/custom_nodes/attatta_publish \\
        /path/to/ComfyUI/custom_nodes/attatta_publish
  Restart ComfyUI.

Wire IMAGE (or a saved filename STRING) into this node as the last step.
"""

from __future__ import annotations

import json
import os
import tempfile
import urllib.error
import urllib.request
from typing import Any

import numpy as np


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _tensor_to_png_bytes(image) -> bytes:
    """Comfy IMAGE tensor [B,H,W,C] float 0–1 → PNG bytes (first batch)."""
    from PIL import Image  # Comfy ships Pillow

    arr = image
    if hasattr(arr, "cpu"):
        arr = arr.cpu().numpy()
    arr = np.asarray(arr)
    if arr.ndim == 4:
        arr = arr[0]
    arr = np.clip(arr * 255.0, 0, 255).astype(np.uint8)
    if arr.shape[-1] == 4:
        mode = "RGBA"
    else:
        mode = "RGB"
        if arr.shape[-1] > 3:
            arr = arr[..., :3]
    im = Image.fromarray(arr, mode=mode)
    import io

    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def _multipart(
    fields: dict[str, str],
    file_field: str,
    filename: str,
    file_bytes: bytes,
    content_type: str,
) -> tuple[bytes, str]:
    boundary = f"----AttattaBoundary{os.urandom(8).hex()}"
    lines: list[bytes] = []
    for k, v in fields.items():
        lines.append(f"--{boundary}\r\n".encode())
        lines.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
        lines.append(f"{v}\r\n".encode())
    lines.append(f"--{boundary}\r\n".encode())
    lines.append(
        (
            f'Content-Disposition: form-data; name="{file_field}"; '
            f'filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
    )
    lines.append(file_bytes)
    lines.append(b"\r\n")
    lines.append(f"--{boundary}--\r\n".encode())
    body = b"".join(lines)
    return body, f"multipart/form-data; boundary={boundary}"


def _post_publish(
    base_url: str,
    publish_key: str,
    fields: dict[str, str],
    filename: str,
    file_bytes: bytes,
    content_type: str,
) -> dict[str, Any]:
    url = base_url.rstrip("/") + "/webhooks/comfy-publish"
    body, ctype = _multipart(fields, "file", filename, file_bytes, content_type)
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", ctype)
    if publish_key:
        req.add_header("X-Attatta-Publish-Key", publish_key)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ATTATTA publish failed ({e.code}): {detail}") from e


class AttattaPublishIngredient:
    """Publish the finished plate into ATTATTA Library / campaign Ingredients."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "kind": (
                    [
                        "background",
                        "hands",
                        "attire",
                        "prop",
                        "theme",
                        "talent",
                    ],
                    {"default": "background"},
                ),
                "label": ("STRING", {"default": "Designer plate"}),
                "attatta_base_url": (
                    "STRING",
                    {
                        "default": _env("ATTATTA_BASE_URL", "http://127.0.0.1:8787"),
                    },
                ),
                "publish_key": (
                    "STRING",
                    {"default": _env("ATTATTA_COMFY_PUBLISH_KEY", "")},
                ),
            },
            "optional": {
                "image": ("IMAGE",),
                "file_path": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": False,
                        "tooltip": "Absolute path to a saved mp4/png (e.g. from VHS). Used when IMAGE is empty.",
                    },
                ),
                "library_id": ("STRING", {"default": "default"}),
                "campaign_id": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": "If set, activate on this campaign (Advanced + Magic).",
                    },
                ),
                "replaces_id": (
                    "STRING",
                    {
                        "default": "",
                        "tooltip": "Existing ATTATTA ingredient id to replace media on.",
                    },
                ),
                "activate": ("BOOLEAN", {"default": True}),
                "tags": ("STRING", {"default": ""}),
                "prompt_hint": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("result_json",)
    FUNCTION = "publish"
    CATEGORY = "ATTATTA"
    OUTPUT_NODE = True

    def publish(
        self,
        kind: str,
        label: str,
        attatta_base_url: str,
        publish_key: str,
        image=None,
        file_path: str = "",
        library_id: str = "default",
        campaign_id: str = "",
        replaces_id: str = "",
        activate: bool = True,
        tags: str = "",
        prompt_hint: str = "",
    ):
        file_bytes: bytes | None = None
        filename = "comfy-publish.png"
        content_type = "image/png"

        path = (file_path or "").strip()
        if path and os.path.isfile(path):
            with open(path, "rb") as f:
                file_bytes = f.read()
            filename = os.path.basename(path)
            ext = os.path.splitext(filename)[1].lower()
            if ext in (".mp4", ".webm", ".mov"):
                content_type = "video/mp4"
            elif ext in (".jpg", ".jpeg"):
                content_type = "image/jpeg"
            elif ext == ".webp":
                content_type = "image/webp"
            else:
                content_type = "image/png"
        elif image is not None:
            file_bytes = _tensor_to_png_bytes(image)
            filename = f"{(label or 'plate').replace(' ', '_')[:48]}.png"
            content_type = "image/png"
        else:
            raise RuntimeError(
                "ATTATTA Publish: connect an IMAGE or set file_path to a saved media file"
            )

        fields = {
            "kind": kind,
            "label": label or "Designer plate",
            "libraryId": library_id or "default",
            "activate": "true" if activate else "false",
        }
        if campaign_id.strip():
            fields["campaignId"] = campaign_id.strip()
        if replaces_id.strip():
            fields["replacesId"] = replaces_id.strip()
        if tags.strip():
            fields["tags"] = tags.strip()
        if prompt_hint.strip():
            fields["promptHint"] = prompt_hint.strip()

        result = _post_publish(
            attatta_base_url,
            publish_key,
            fields,
            filename,
            file_bytes,
            content_type,
        )
        print(
            f"[ATTATTA] Published {result.get('kind')} "
            f"'{result.get('label')}' id={result.get('item', {}).get('id')} "
            f"activated={result.get('activated')}"
        )
        return (json.dumps(result),)


NODE_CLASS_MAPPINGS = {
    "AttattaPublishIngredient": AttattaPublishIngredient,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AttattaPublishIngredient": "ATTATTA Publish Ingredient",
}
