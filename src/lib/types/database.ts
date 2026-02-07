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
