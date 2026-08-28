/** Trigger a browser download for an API-hosted file URL. */
export function triggerApiDownload(
  downloadUrl: string,
  fileName?: string,
): void {
  const base = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787";
  const href = downloadUrl.startsWith("http")
    ? downloadUrl
    : `${base}${downloadUrl}`;
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  if (fileName) a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
