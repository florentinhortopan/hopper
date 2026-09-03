/** Trigger a browser download for an API-hosted file (works cross-origin). */
export async function triggerApiDownload(
  downloadUrl: string,
  fileName?: string,
): Promise<void> {
  const base = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787";
  const href = downloadUrl.startsWith("http")
    ? downloadUrl
    : `${base}${downloadUrl}`;

  // Cross-origin <a download> is ignored by browsers (saves as "files" with no
  // extension). Fetch as blob so we can force the real .zip name.
  const res = await fetch(href, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Download failed (${res.status})${fileName ? `: ${fileName}` : ""}`,
    );
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download =
    fileName ||
    decodeURIComponent(href.split("/").pop() || "") ||
    "SCOTTY_Celtra_package.zip";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
}
