/* ------------------------------------------------------------------ */
/*  Shared TypeScript types — matches Supabase table schemas          */
/*  This file grows as we add tables in later phases                  */
/* ------------------------------------------------------------------ */

// Phase 1: Profile (auth)
export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

// Phase 4: Library
export type Category = "Note" | "Document" | "Template" | "Reference";

export interface LibraryItem {
  id: string;
  user_id: string;
  title: string;
  content: string;
  category: Category;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface LibraryFile {
  id: string;
  user_id: string;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  text_content: string | null;
  added_at: string;
}

// Phase 5: Goals
export type GoalStatus = "Backlog" | "To Do" | "In Progress" | "In Review" | "Done";

export interface Goal {
  id: string;
  user_id: string;
  name: string;
  description: string;
  status: GoalStatus;
  teams: string[];
  owner: string;
  start_date: string | null;
  end_date: string | null;
  metric: string;
  metric_target: string;
  created_at: string;
}

export interface SubGoal {
  id: string;
  goal_id: string;
  name: string;
  description: string;
  status: GoalStatus;
  owner: string;
  end_date: string | null;
  created_at: string;
}

// Pain Points
export type PainPointSeverity = "Low" | "Medium" | "High" | "Critical";

export interface PainPoint {
  id: string;
  user_id: string;
  name: string;
  description: string;
  severity: PainPointSeverity;
  status: GoalStatus;
  teams: string[];
  owner: string;
  impact_metric: string;
  linked_goal_id: string | null;
  created_at: string;
}

// Phase 6: Teams
export type KpiPeriod = "Day" | "Week" | "Month" | "Quarter" | "Year";

export interface Team {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  description: string;
  created_at: string;
}

export interface TeamRole {
  id: string;
  team_id: string;
  name: string;
  description: string;
  headcount: number;
  created_at: string;
}

export interface TeamKPI {
  id: string;
  team_id: string;
  name: string;
  current_value: number | null;
  target_value: number | null;
  period: KpiPeriod;
  created_at: string;
}

export interface TeamTool {
  id: string;
  team_id: string;
  name: string;
  purpose: string;
  created_at: string;
}

export interface TeamFile {
  id: string;
  team_id: string;
  user_id: string;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  text_content: string | null;
  added_at: string;
}

// Phase 9: Organization
export type OrgStage = "Idea" | "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Series C+" | "Growth" | "Public";

export interface Organization {
  id: string;
  user_id: string;
  name: string;
  industry: string;
  description: string;
  website: string;
  stage: OrgStage | "";
  target_market: string;
  differentiators: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationFile {
  id: string;
  user_id: string;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  text_content: string | null;
  added_at: string;
}

// Phase 8: Tool Catalog + Stack
export type ToolStatus = "Active" | "Evaluating" | "Deprecated";

export interface ToolCatalogItem {
  id: string;
  user_id: string;
  name: string;
  category: string;
  subcategory: string;
  description: string;
  key_features: string[];
  pricing: string;
  best_for: string;
  integrations: string[];
  pros: string[];
  cons: string[];
  website: string;
  created_at: string;
}

export interface UserStackTool {
  id: string;
  user_id: string;
  catalog_id: string | null;
  name: string;
  description: string;
  category: string;
  teams: string[];
  team_usage: Record<string, string>;
  status: ToolStatus;
  created_at: string;
}

// Phase 10: Projects (unified workspace)
export type ProjectMode = "canvas" | "workflow" | "chat";
export type CanvasBlockType =
  "text" | "heading" | "image" | "divider" |
  "bullet_list" | "numbered_list" | "checklist" | "table" | "code" | "chart" |
  "column_group";

export interface ListItem {
  id: string;
  text: string;
  checked?: boolean;
}

export type BlockAlign = "left" | "center" | "right";

export interface CanvasBlock {
  id: string;
  type: CanvasBlockType;
  content?: string;
  level?: 1 | 2 | 3;
  align?: BlockAlign;
  width?: number;       // percentage width (e.g. 50 = 50%), used mainly for images
  url?: string;
  alt?: string;
  items?: ListItem[];
  rows?: string[][];
  language?: string;
  chartType?: "bar" | "line" | "pie" | "area";
  chartData?: Record<string, unknown>[];
  chartConfig?: {
    title?: string;
    xKey?: string;
    yKeys?: string[];
    colors?: string[];
  };
  columns?: CanvasBlock[][];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string;
  active_mode: ProjectMode;
  canvas_blocks: CanvasBlock[];
  workflow_nodes: Record<string, unknown>[];
  workflow_history?: WorkflowVersion[];
  chat_messages?: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface WorkflowVersion {
  snapshot: Record<string, unknown>[];
  timestamp: string;
  label: string;
  nodeCount: number;
}

/* ── Workflow Builder types ────────────────────────────── */

export type WorkflowNodeType = "start" | "end" | "process" | "decision" | "ai_agent" | "note";

export interface WorkflowPort {
  id: string;
  side: "top" | "right" | "bottom" | "left";
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  description: string;
  properties: Record<string, string>;
  ports: WorkflowPort[];
}

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  label?: string;
}

export interface WorkflowData {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport: { x: number; y: number; zoom: number };
}
