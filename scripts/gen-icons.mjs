#!/usr/bin/env node
/**
 * Generates `src/core/shapes/icon-data.ts`: a curated set of Lucide icons
 * flattened to plain SVG path strings (24×24 viewBox).
 *
 * Shapes only ever deal with paths, so icons render identically on the canvas
 * and in every export format, and the runtime needs no icon library.
 *
 * Run: `npm run icons` after editing the list below.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as lucide from "lucide";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "core", "shapes", "icon-data.ts");

const NAMES = `
Server ServerCog ServerCrash ServerOff Database DatabaseZap DatabaseBackup HardDrive Cloud CloudCog CloudUpload
CloudDownload CloudOff Network Router Globe Earth Shield ShieldCheck ShieldAlert ShieldQuestionMark Lock LockOpen Key
KeyRound Vault Cpu MemoryStick Microchip CircuitBoard Container Box Boxes Package Layers Layers2 SquareStack Workflow
GitBranch GitMerge GitPullRequest GitCommitHorizontal GitFork Terminal SquareTerminal Code CodeXml Braces Binary Hash
Variable Sigma SquareFunction Calculator FileCode FileText FileJson FileLock FileKey FileClock FileSearch File Files
Folder FolderOpen FolderTree Archive Monitor Laptop Smartphone Tablet Tv Printer Wifi WifiOff Radio Antenna Satellite
SatelliteDish Cable Plug PlugZap Unplug Zap ZapOff Power BatteryCharging Activity Gauge ChartBar ChartColumn ChartLine
ChartPie ChartArea ChartNoAxesCombined Table Sheet Search ScanSearch TextSearch Filter Funnel Bell Mail MessageSquare
MessagesSquare MessageCircle Send Inbox Webhook Rss Link ExternalLink RefreshCw Repeat Shuffle Timer Clock Calendar
CalendarClock AlarmClock Hourglass History Logs Play Pause CircleStop CircleCheck CircleX CircleAlert TriangleAlert
Info CircleQuestionMark Flag Bookmark Star Heart ThumbsUp Eye EyeOff Fingerprint ScanFace ScanLine User Users UserCheck
UserCog Contact IdCard BadgeCheck Building Building2 Factory Store Warehouse House Landmark Hospital Briefcase
CreditCard Wallet Banknote Receipt ShoppingCart CircleDollarSign DollarSign Percent Truck Ship Plane MapPin Map
Compass Navigation Signpost Target Crosshair Lightbulb Rocket Puzzle Wrench Hammer Settings Settings2
SlidersHorizontal Cog Bug FlaskConical TestTube Microscope Atom Dna GraduationCap BookOpen Library Newspaper Image
Video Camera Cctv Mic Volume2 Music Headphones Phone Bot BotMessageSquare Brain BrainCircuit BrainCog Sparkles Sparkle
WandSparkles Speech ScrollText NotebookPen PenLine Pencil ListChecks ListTodo ClipboardList ClipboardCheck SquareKanban
Milestone Split Merge Route Waypoints Share2 Orbit Radar Save Download Upload QrCode Barcode Blocks Component Shapes
Grid3x3 LayoutDashboard PanelLeft AppWindow Siren Flame Snowflake Droplet Leaf Sun Moon Usb Bluetooth Scale Gavel
Handshake Megaphone Trophy Award Crown Gem Gift Tag Tags Ticket Languages HeartPulse Stethoscope Recycle Trash2
Paperclip Pin Combine Group Frame MousePointerClick Hand Keyboard Mouse Telescope Anchor Infinity Plus Minus X Check
ArrowRight ArrowLeft ArrowUp ArrowDown ArrowLeftRight ArrowUpDown Undo2 Redo2 Stamp Signature Palette Ruler
DraftingCompass PencilRuler Focus Locate HardHat Construction Cylinder Cuboid Hexagon Triangle Diamond Circle Square
`
  .split(/\s+/)
  .filter(Boolean);

const kebab = (name) =>
  name
    .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();

const n = (value, fallback = 0) => (value === undefined ? fallback : Number(value));

/** Converts one Lucide element to an SVG path string. */
function toPath([tag, a]) {
  switch (tag) {
    case "path":
      return a.d;
    case "line":
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case "polyline":
    case "polygon": {
      const nums = String(a.points).trim().split(/[\s,]+/).map(Number);
      let d = "";
      for (let i = 0; i + 1 < nums.length; i += 2) d += `${i === 0 ? "M" : "L"}${nums[i]} ${nums[i + 1]}`;
      return tag === "polygon" ? `${d}Z` : d;
    }
    case "circle":
    case "ellipse": {
      const rx = n(a.r ?? a.rx);
      const ry = n(a.r ?? a.ry);
      const cx = n(a.cx);
      const cy = n(a.cy);
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
    }
    case "rect": {
      const x = n(a.x);
      const y = n(a.y);
      const w = n(a.width);
      const h = n(a.height);
      const rx = Math.min(n(a.rx ?? a.ry), w / 2);
      const ry = Math.min(n(a.ry ?? a.rx), h / 2);
      if (!rx && !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return (
        `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}` +
        `h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`
      );
    }
    default:
      throw new Error(`Unsupported icon element <${tag}>`);
  }
}

const entries = [];
for (const name of [...new Set(NAMES)].sort()) {
  const node = lucide[name];
  if (!Array.isArray(node)) throw new Error(`Unknown Lucide icon: ${name}`);
  entries.push(`  ${JSON.stringify(kebab(name))}: ${JSON.stringify(node.map(toPath))},`);
}

const source = `// GENERATED by scripts/gen-icons.mjs — do not edit by hand.
// Lucide icons (ISC licence) flattened to SVG path strings on a 24×24 grid.

export const ICON_DATA: Record<string, string[]> = {
${entries.join("\n")}
};
`;

await writeFile(OUT, source);
console.log(`✓ ${entries.length} icons → ${path.relative(process.cwd(), OUT)} (${(source.length / 1024).toFixed(0)} kB)`);
