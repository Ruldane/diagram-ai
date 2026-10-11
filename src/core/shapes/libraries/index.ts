import type { ShapeLibrary } from "../types";
import { aiLibrary } from "./ai";
import { basicLibrary } from "./basic";
import { bpmnLibrary } from "./bpmn";
import { brandsLibrary } from "./brands";
import { c4Library } from "./c4";
import { dfdLibrary } from "./dfd";
import { engineeringLibrary } from "./engineering";
import { erLibrary } from "./er";
import { flowchartLibrary } from "./flowchart";
import { iconsLibrary } from "./icons";
import { infraLibrary } from "./infra";
import { orgLibrary } from "./org";
import { strategyLibrary } from "./strategy";
import { umlLibrary } from "./uml";
import { wireframeLibrary } from "./wireframe";

/**
 * Every shape library, in palette order. Order also decides which shape wins
 * when two libraries share an alias (earlier wins).
 *
 * To add a library: create a file exporting a `ShapeLibrary` and list it here.
 */
export const LIBRARIES: ShapeLibrary[] = [
  basicLibrary,
  flowchartLibrary,
  umlLibrary,
  erLibrary,
  dfdLibrary,
  bpmnLibrary,
  c4Library,
  infraLibrary,
  aiLibrary,
  iconsLibrary,
  brandsLibrary,
  orgLibrary,
  strategyLibrary,
  wireframeLibrary,
  engineeringLibrary,
];
