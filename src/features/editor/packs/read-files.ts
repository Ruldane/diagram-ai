import { readZip, type ImportFile } from "@/core/shapes/pack-import";

/** A file the user picked or dropped, with its path inside the dropped folder (or just its name). */
export interface PickedFile {
  file: File;
  path: string;
}

export function fromFileList(list: FileList): PickedFile[] {
  return Array.from(list).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

async function readDirectory(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    // A reader hands out entries in batches until it returns an empty one.
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

async function walk(entry: FileSystemEntry, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, path: entry.fullPath.replace(/^\/+/, "") });
    return;
  }
  if (entry.isDirectory) {
    for (const child of await readDirectory(entry as FileSystemDirectoryEntry)) await walk(child, out);
  }
}

/** Files from a drop, descending into dropped folders where the browser allows it. */
export async function fromDataTransfer(transfer: DataTransfer): Promise<PickedFile[]> {
  // Entries are only valid during the event, so take them before the first await.
  const entries = Array.from(transfer.items)
    .map((item) => (item.kind === "file" ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (!entries.length) return Array.from(transfer.files).map((file) => ({ file, path: file.name }));
  const out: PickedFile[] = [];
  for (const entry of entries) await walk(entry, out);
  return out;
}

export interface ReadResult {
  files: ImportFile[];
  /** A pack name suggested by the zip's or folder's name. */
  suggestedName: string;
  problems: string[];
}

/** `AWS_Architecture-Icons_01312023.zip` → `AWS Architecture Icons`. */
function humanizeName(raw: string): string {
  const words = raw
    .replace(/\.[a-z0-9]{1,4}$/i, "")
    .replace(/[\s._-]+\d{6,}.*$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words || "Imported icons";
}

/** Reads dropped or picked files: SVGs as they are, zip archives expanded. */
export async function readPicked(picked: PickedFile[], onProgress?: (done: number, total: number) => void): Promise<ReadResult> {
  const files: ImportFile[] = [];
  const problems: string[] = [];
  let ignored = 0;
  let done = 0;
  for (const { file, path } of picked) {
    if (/\.zip$/i.test(file.name)) {
      const entries = readZip(new Uint8Array(await file.arrayBuffer()));
      if (entries) files.push(...entries);
      else problems.push(`${file.name} is not a readable .zip archive.`);
    } else if (/\.svg$/i.test(file.name)) {
      files.push({ path, data: await file.text() });
    } else {
      ignored++;
    }
    onProgress?.(++done, picked.length);
  }
  if (ignored) problems.push(`${ignored} file${ignored === 1 ? " was" : "s were"} ignored (only .svg and .zip are read).`);

  const zips = picked.filter(({ file }) => /\.zip$/i.test(file.name));
  const folder = picked.find(({ path }) => path.includes("/"))?.path.split("/")[0];
  const suggestedName = zips.length === 1 && picked.length === 1 ? humanizeName(zips[0].file.name) : folder ? humanizeName(folder) : "Imported icons";
  return { files, suggestedName, problems };
}
