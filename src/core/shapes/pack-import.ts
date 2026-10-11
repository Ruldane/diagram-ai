/**
 * Turns a set of SVG files (a folder, a zip, a handful of drop-ins) into an
 * icon pack. Understands how the vendors name and arrange their official sets:
 *
 *   AWS    Architecture-Service-Icons_…/Arch_Analytics/48/Arch_Amazon-Athena_48.svg
 *   Azure  Icons/analytics/00001-icon-service-Analysis-Services.svg
 *   GCP    compute_engine.svg
 *
 * Folder → category, file name → icon name, one icon per name (the 48/64 px
 * variant wins when a set ships several sizes). Pure: no file system, no DOM.
 */
import { unzipSync } from "fflate";

import { slugify } from "../model/ids";
import { iconBytes, PACK_LIMITS, packIdFromName, validatePack, type IconPack, type PackIcon } from "./packs";
import { importSvg } from "./svg-import";

export interface ImportFile {
  /** Path inside the folder or archive; `/` or `\` separated. */
  path: string;
  data: Uint8Array | string;
}

export interface ImportOptions {
  /** Display name of the pack. */
  name: string;
  /** Library id; derived from the name when omitted. */
  id?: string;
  description?: string;
  source?: string;
}

export interface ImportReport {
  /** `null` when nothing usable was found (see `warnings`). */
  pack: IconPack | null;
  warnings: string[];
  /** Files that were not turned into icons, with the reason. */
  skipped: { path: string; reason: string }[];
}

/* ------------------------------------------------------------------ limits */

export const IMPORT_LIMITS = {
  /** One SVG file. */
  fileBytes: 2 * 1024 * 1024,
  /** SVG files read from one archive or folder. */
  files: 6000,
  /** Everything read from an archive, uncompressed. */
  totalBytes: 150 * 1024 * 1024,
} as const;

/* ------------------------------------------------------------------- names */

/** Size the vendors encode in names and folders; the closest to this wins when a set has several. */
const PREFERRED_SIZE = 56;
/** Trailing numbers that are sizes rather than part of a name ("Office 365"). */
const ICON_SIZES = new Set([16, 20, 24, 32, 40, 48, 56, 64, 72, 80, 96, 128, 192, 256, 512]);

const KEEP_LOWER = new Set(["and", "or", "for", "the", "of", "to", "in", "on", "at", "by", "a", "an", "as", "vs"]);
/** Words that read as acronyms in service names (`cloud_sql` → `Cloud SQL`, `pub_sub` stays `Pub Sub`). */
const ACRONYMS = new Set([
  "ai", "ml", "api", "apis", "sql", "vm", "vms", "vpc", "vpn", "dns", "cdn", "iam", "kms", "sso", "mfa", "waf", "acl", "nat", "ssl", "tls",
  "ssh", "sdk", "cli", "cpu", "gpu", "tpu", "ssd", "hdd", "iot", "etl", "bi", "ci", "cd", "db", "ip", "ui", "ux", "os", "ram", "nfs",
  "lb", "sms", "ftp", "http", "https", "gke", "aks", "eks", "ecs", "ec2", "ecr", "s3", "rds", "sqs", "sns", "efs", "ebs", "aws", "gcp",
  "hpc", "vdi", "erp", "crm", "oci", "hsm", "ad", "id",
]);

function titleCase(text: string): string {
  return text
    .split(" ")
    .map((word, index) => {
      if (!word) return word;
      if (ACRONYMS.has(word)) return word.toUpperCase();
      if (index > 0 && KEEP_LOWER.has(word)) return word;
      return word[0].toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** `compute_engine` → `Compute Engine`, `Amazon-EC2` → `Amazon EC2`: names that already use capitals are left alone. */
function humanize(raw: string): string {
  const words = raw.replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim();
  return words === words.toLowerCase() ? titleCase(words) : words;
}

const FILE_PREFIXES = [/^arch[-_]category[-_]/i, /^arch[-_]/i, /^res[-_]/i, /^\d{3,6}[-_ ]/, /^icon[-_]service[-_]/i, /^icon[-_]/i, /^ic[-_]/i];

export interface ParsedFileName {
  /** Human name: `AWS Lambda`. */
  name: string;
  /** Pixel size from the name (`_64`), when there is one. */
  size?: number;
}

/** File name (with or without extension) → display name and size. */
export function parseIconFileName(fileName: string): ParsedFileName {
  let base = fileName.replace(/^.*[\\/]/, "").replace(/\.svg$/i, "");
  let size: number | undefined;
  const suffix = /[-_ @](\d{1,4})(?:px|x\d{1,4})?$/i.exec(base);
  if (suffix) {
    const value = Number(suffix[1]);
    if (ICON_SIZES.has(value)) {
      size = value;
      base = base.slice(0, suffix.index);
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const prefix = FILE_PREFIXES.find((pattern) => pattern.test(base));
    if (!prefix) break;
    const stripped = base.replace(prefix, "");
    if (!stripped) break;
    base = stripped;
  }
  return { name: humanize(base), size };
}

/** Folder segments that describe the download rather than the icon's category. */
const CONTAINER = /^(?:asset[-_ ]?packages?.*|assets?|svgs?|png|vectors?|export(?:s|ed)?|dark|light|architecture[-_ ].*|resource[-_ ]icons?.*|category[-_ ]icons?.*|service[-_ ]icons?.*|icons?|.*[-_ ]icons?[-_ ]?\d*)$/i;
const SIZE_FOLDER = /^\d{1,4}(?:px|x\d{1,4})?$/i;
const CATEGORY_PREFIXES = [/^arch[-_]category[-_]/i, /^arch[-_]/i, /^res[-_]/i];

function categoryName(segment: string): string {
  let base = segment;
  for (const prefix of CATEGORY_PREFIXES) base = base.replace(prefix, "");
  return humanize(base);
}

/* ------------------------------------------------------------------ import */

interface Candidate {
  path: string;
  name: string;
  category?: string;
  size?: number;
  viewBox: PackIcon["viewBox"];
  layers: PackIcon["layers"];
}

const decoder = new TextDecoder("utf-8");

const sizeScore = (size: number | undefined): number => (size === undefined ? 0 : Math.abs(size - PREFERRED_SIZE));

function isIgnoredPath(segments: string[]): boolean {
  return segments.some((segment) => segment === "__MACOSX" || segment.startsWith("."));
}

function fileSegments(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

/** The files of one import, with the folder structure already read. */
interface Plan {
  batch: ImportFile[];
  /** Per file: its folders without size folders and download wrappers, and the size folder if any. */
  folders: { dirs: string[]; sizeFolder?: string }[];
  warnings: string[];
  skipped: ImportReport["skipped"];
}

interface Collected {
  candidates: Candidate[];
  /** One line per kind of problem, not per file. */
  fileWarnings: Set<string>;
}

function plan(files: ImportFile[]): Plan | ImportReport {
  const warnings: string[] = [];
  const skipped: ImportReport["skipped"] = [];
  const svgFiles = files.filter((file) => /\.svg$/i.test(file.path) && !isIgnoredPath(fileSegments(file.path)));
  if (!svgFiles.length) return { pack: null, warnings: ["No .svg files were found."], skipped };

  const batch = svgFiles.length > IMPORT_LIMITS.files ? svgFiles.slice(0, IMPORT_LIMITS.files) : svgFiles;
  if (batch.length < svgFiles.length) warnings.push(`Only the first ${IMPORT_LIMITS.files} of ${svgFiles.length} SVG files were read.`);

  // Folder structure → category: drop size folders and download wrappers, then
  // the leading folders every file shares.
  const folders = batch.map((file) => {
    const dirs = fileSegments(file.path).slice(0, -1);
    return { dirs: dirs.filter((dir) => !SIZE_FOLDER.test(dir) && !CONTAINER.test(dir)), sizeFolder: dirs.find((dir) => SIZE_FOLDER.test(dir)) };
  });
  for (;;) {
    const first = folders[0].dirs[0];
    if (first === undefined || !folders.every((entry) => entry.dirs.length >= 2 && entry.dirs[0] === first)) break;
    for (const entry of folders) entry.dirs.shift();
  }
  return { batch, folders, warnings, skipped };
}

const isReport = (value: Plan | ImportReport): value is ImportReport => "pack" in value;

function convert(work: Plan, index: number, into: Collected): void {
  const file = work.batch[index];
  const bytes = typeof file.data === "string" ? file.data.length : file.data.byteLength;
  if (bytes > IMPORT_LIMITS.fileBytes) {
    work.skipped.push({ path: file.path, reason: `Larger than ${IMPORT_LIMITS.fileBytes / 1048576} MB.` });
    return;
  }
  const result = importSvg(typeof file.data === "string" ? file.data : decoder.decode(file.data));
  for (const warning of result.warnings) into.fileWarnings.add(warning);
  if (!result.artwork) {
    work.skipped.push({ path: file.path, reason: result.warnings[0] ?? "Nothing to draw." });
    return;
  }
  const parsed = parseIconFileName(file.path);
  const { dirs, sizeFolder } = work.folders[index];
  const folderSize = sizeFolder ? Number(sizeFolder.replace(/\D.*$/, "")) : undefined;
  into.candidates.push({
    path: file.path,
    name: parsed.name || "Icon",
    category: dirs[0] ? categoryName(dirs[0]) : undefined,
    size: parsed.size ?? folderSize,
    viewBox: result.artwork.viewBox,
    layers: result.artwork.layers,
  });
}

function assemble(work: Plan, collected: Collected, options: ImportOptions): ImportReport {
  const { skipped } = work;
  const warnings = [...work.warnings, ...collected.fileWarnings];

  // One icon per (category, name); several sizes of the same icon collapse to the best one.
  const best = new Map<string, Candidate>();
  for (const candidate of collected.candidates) {
    const key = `${(candidate.category ?? "").toLowerCase()}/${candidate.name.toLowerCase()}`;
    const current = best.get(key);
    if (!current) best.set(key, candidate);
    else if (sizeScore(candidate.size) < sizeScore(current.size)) {
      skipped.push({ path: current.path, reason: "Another size of the same icon was used." });
      best.set(key, candidate);
    } else skipped.push({ path: candidate.path, reason: "Another size of the same icon was used." });
  }

  let chosen = [...best.values()];
  // A single category tells nobody anything.
  if (new Set(chosen.map((candidate) => candidate.category ?? "")).size === 1) chosen = chosen.map((candidate) => ({ ...candidate, category: undefined }));

  const used = new Set<string>();
  const icons: PackIcon[] = [];
  let total = 0;
  let dropped = 0;
  for (const candidate of chosen) {
    if (icons.length >= PACK_LIMITS.icons) {
      dropped++;
      continue;
    }
    const icon: PackIcon = { id: "", name: candidate.name, category: candidate.category, viewBox: candidate.viewBox, layers: candidate.layers };
    const bytes = iconBytes(icon);
    if (bytes > PACK_LIMITS.iconBytes || candidate.layers.length > PACK_LIMITS.layers) {
      skipped.push({ path: candidate.path, reason: "Too detailed (over the per-icon size limit)." });
      continue;
    }
    if (total + bytes > PACK_LIMITS.totalBytes) {
      dropped++;
      continue;
    }
    total += bytes + 64;

    let id = slugify(candidate.name, PACK_LIMITS.iconId) || "icon";
    if (used.has(id) && candidate.category) id = slugify(`${id}-${candidate.category}`, PACK_LIMITS.iconId) || id;
    for (let n = 2; used.has(id); n++) id = `${slugify(candidate.name, PACK_LIMITS.iconId - 4) || "icon"}-${n}`;
    used.add(id);
    icons.push({ ...icon, id });
  }
  if (dropped) warnings.push(`${dropped} icons were left out to stay within the pack limits (${PACK_LIMITS.icons} icons, ${PACK_LIMITS.totalBytes / 1048576} MB).`);
  if (!icons.length) return { pack: null, warnings: [...warnings, "None of the files could be turned into an icon."], skipped };

  icons.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name));
  const draft: IconPack = {
    id: options.id ?? packIdFromName(options.name),
    name: options.name.trim() || "Icon pack",
    description: options.description,
    source: options.source,
    icons,
  };
  const checked = validatePack(draft);
  if (!checked.ok) return { pack: null, warnings: [...warnings, checked.error], skipped };
  return { pack: checked.pack, warnings, skipped };
}

/** Imports SVG files as a pack. Never throws; read `pack` and `warnings`. */
export function importIconFiles(files: ImportFile[], options: ImportOptions): ImportReport {
  const work = plan(files);
  if (isReport(work)) return work;
  const collected: Collected = { candidates: [], fileWarnings: new Set() };
  for (let index = 0; index < work.batch.length; index++) convert(work, index, collected);
  return assemble(work, collected, options);
}

const frame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Same as `importIconFiles`, but hands the thread back to the caller between
 * chunks so a page can show progress while hundreds of files are converted.
 */
export async function importIconFilesAsync(
  files: ImportFile[],
  options: ImportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportReport> {
  const work = plan(files);
  if (isReport(work)) return work;
  const collected: Collected = { candidates: [], fileWarnings: new Set() };
  const total = work.batch.length;
  for (let index = 0; index < total; index++) {
    convert(work, index, collected);
    if (index % 25 === 24 || index === total - 1) {
      onProgress?.(index + 1, total);
      await frame();
    }
  }
  return assemble(work, collected, options);
}

/** Reads a zip archive's SVG files; `null` when it is not a readable archive. */
export function readZip(bytes: Uint8Array): ImportFile[] | null {
  let budget = IMPORT_LIMITS.totalBytes;
  let count = 0;
  try {
    const entries = unzipSync(bytes, {
      filter: (entry) => {
        if (!/\.svg$/i.test(entry.name) || isIgnoredPath(fileSegments(entry.name))) return false;
        if (entry.originalSize > IMPORT_LIMITS.fileBytes || entry.originalSize > budget || count >= IMPORT_LIMITS.files) return false;
        budget -= entry.originalSize;
        count++;
        return true;
      },
    });
    return Object.entries(entries).map(([path, data]) => ({ path, data }));
  } catch {
    return null;
  }
}

/** Imports a `.zip` of SVG files. */
export function importIconZip(bytes: Uint8Array, options: ImportOptions): ImportReport {
  const files = readZip(bytes);
  if (!files) return { pack: null, warnings: ["The file is not a readable .zip archive."], skipped: [] };
  return importIconFiles(files, options);
}
