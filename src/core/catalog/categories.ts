import type { DiagramCategory } from "./types";

export const CATEGORIES: DiagramCategory[] = [
  { id: "software", name: "Software & architecture", description: "System design, architecture and code structure." },
  { id: "uml", name: "UML", description: "The standard UML structure and behaviour diagrams." },
  { id: "data", name: "Data", description: "Database schemas, data models and data movement." },
  { id: "ai", name: "AI & agents", description: "Agent systems, LLM pipelines and ML workflows." },
  { id: "cloud", name: "Cloud & network", description: "Infrastructure, deployment and network topology." },
  { id: "process", name: "Process & workflow", description: "Business processes, workflows and decision logic." },
  { id: "strategy", name: "Strategy & analysis", description: "Frameworks for analysing, prioritising and deciding." },
  { id: "planning", name: "Planning & teams", description: "Roadmaps, timelines, boards and organisation." },
  { id: "ux", name: "UX & product", description: "Wireframes, user flows and information architecture." },
  { id: "engineering", name: "Engineering & science", description: "Logic, circuits, control systems and block diagrams." },
  { id: "general", name: "General", description: "Free-form canvases and everything else." },
];
