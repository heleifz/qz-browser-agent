export interface UploadFile { name: string; content: string; mimeType?: string; encoding?: "utf8" | "base64" }

/** Browser-native File/FileList only; never reads paths on the user's computer. */
export function setInputFiles(element: Element, files: UploadFile[]) {
  if (!(element instanceof HTMLInputElement) || element.type !== "file") throw new Error("Target must be an input[type=file].");
  if (element.disabled) throw new Error("The file input is disabled.");
  if (!Array.isArray(files) || files.length > 5 || (!element.multiple && files.length > 1)) throw new Error("Use at most five files and respect the input's multiple attribute.");
  const transfer = new DataTransfer();
  let bytes = 0;
  for (const file of files) {
    if (!file || !file.name || /[/\\\u0000]/.test(file.name) || file.name.length > 255 || typeof file.content !== "string") throw new Error("Provide a filename and content, not a local path.");
    const data = file.encoding === "base64" ? Uint8Array.from(atob(file.content), char => char.charCodeAt(0)) : new TextEncoder().encode(file.content);
    bytes += data.byteLength;
    if (bytes > 512 * 1024) throw new Error("File content exceeds 512 KiB. Use wait_for_user for larger local uploads.");
    transfer.items.add(new File([data], file.name, { type: file.mimeType || "application/octet-stream" }));
  }
  element.files = transfer.files;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, files: [...transfer.files].map(file => ({ name: file.name, size: file.size, type: file.type })), bytes };
}
