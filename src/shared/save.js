/* Author: Barzil Bruton.
 * Getting finished files onto the user's disk: a single download, writing
 * into a chosen folder, and name de-duplication for batches. */

/* Above this estimated total, a batch containing video is saved file by file
   instead of zipped, because JSZip builds the whole archive in memory. */
export const ZIP_LIMIT = 600 * 1024 * 1024;

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function writeToFolder(dir, name, blob) {
  const handle = await dir.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}

/* Returns `name`, or `name` with "-2", "-3" and so on before the extension
   if it was already used in this batch. `used` is a Map owned by the caller. */
export function dedupe(used, name) {
  const key = name.toLowerCase();
  const seen = used.get(key) || 0;
  used.set(key, seen + 1);
  return seen ? name.replace(/(\.[^.]+)$/, `-${seen + 1}$1`) : name;
}
