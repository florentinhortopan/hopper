# ATTATTA Publish (ComfyUI custom node)

Terminal node: publish a finished IMAGE or saved video file into ATTATTA Library, optionally activating it on a campaign for Advanced Ingredients + Magic.

## Install

```bash
# from ATTATTA repo root
ln -sf "$(pwd)/comfy/custom_nodes/attatta_publish" \
  "$HOME/ComfyUI/custom_nodes/attatta_publish"
```

Restart ComfyUI. Node appears under **ATTATTA → ATTATTA Publish Ingredient**.

## Usage

1. Finish your graph (BG swap, gesture, etc.).
2. Connect the output IMAGE (or set `file_path` to an mp4 from VHS/Video Combine).
3. Set `attatta_base_url` to the orchestrator (`http://127.0.0.1:8787` locally).
4. Optionally set `campaign_id` so the marketer sees it activated immediately.
5. Queue prompt — node POSTs to `/webhooks/comfy-publish`.

## Auth

If the API has `ATTATTA_COMFY_PUBLISH_KEY`, pass the same value in `publish_key` (or export `ATTATTA_COMFY_PUBLISH_KEY` in the Comfy process env).
