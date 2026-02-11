/* ------------------------------------------------------------------ */
/*  Data Source Registry                                               */
/*  Maps table names to queryable metadata for the dashboard system.   */
/*  To add CRM or other data: just add entries here.                   */
/* ------------------------------------------------------------------ */

export interface MetricDef {
  key: string;   // "count" | "sum:headcount" | "sum:current_value"
  label: string; // "Count" | "Total Headcount"
}

export interface DimensionDef {
  key: string;   // "status" | "severity" | "teams"
  label: string; // "Status" | "Severity" | "Team"
  isArray?: boolean; // true for TEXT[] columns like teams
}

export interface DataSourceDef {
  label: string;
  table: string;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
  colorMap?: Record<string, Record<string, string>>; // dimension → value → color
}

/* ── Color maps (reuse status/severity colors from GoalsTab & PainPointsTab) ── */

const goalStatusColors: Record<string, string> = {
  "Backlog":     "#9ca3af",
  "To Do":       "#f59e0b",
  "In Progress": "#2563eb",
  "In Review":   "#7c3aed",
  "Done":        "#16a34a",
};

const severityColors: Record<string, string> = {
  "Low":      "#16a34a",
  "Medium":   "#f59e0b",
  "High":     "#ea580c",
  "Critical": "#dc2626",
};

const toolStatusColors: Record<string, string> = {
  "Active":     "#16a34a",
  "Evaluating": "#f59e0b",
  "Deprecated": "#9ca3af",
};

const projectModeColors: Record<string, string> = {
  "canvas":   "#2563eb",
  "workflow": "#7c3aed",
  "chat":     "#16a34a",
};

/* ── Registry ── */

export const DATA_SOURCES: Record<string, DataSourceDef> = {
  goals: {
    label: "Goals",
    table: "goals",
    metrics: [
      { key: "count", label: "Count" },
    ],
    dimensions: [
      { key: "status", label: "Status" },
      { key: "teams", label: "Team", isArray: true },
      { key: "owner", label: "Owner" },
    ],
    colorMap: { status: goalStatusColors },
  },

  sub_goals: {
    label: "Sub-Goals",
    table: "sub_goals",
    metrics: [
      { key: "count", label: "Count" },
    ],
    dimensions: [
      { key: "status", label: "Status" },
      { key: "owner", label: "Owner" },
    ],
    colorMap: { status: goalStatusColors },
  },

  pain_points: {
    label: "Pain Points",
    table: "pain_points",
    metrics: [
      { key: "count", label: "Count" },
    ],
    dimensions: [
      { key: "severity", label: "Severity" },
      { key: "status", label: "Status" },
      { key: "teams", label: "Team", isArray: true },
    ],
    colorMap: {
      severity: severityColors,
      status: goalStatusColors,
    },
  },

  team_kpis: {
    label: "Team KPIs",
    table: "team_kpis",
    metrics: [
      { key: "count", label: "Count" },
      { key: "sum:current_value", label: "Total Current Value" },
      { key: "sum:target_value", label: "Total Target Value" },
    ],
    dimensions: [
      { key: "period", label: "Period" },
      { key: "team_id", label: "Team" },
    ],
  },

  team_roles: {
    label: "Team Roles",
    table: "team_roles",
    metrics: [
      { key: "count", label: "Count" },
      { key: "sum:headcount", label: "Total Headcount" },
    ],
    dimensions: [
      { key: "team_id", label: "Team" },
    ],
  },

  stack_tools: {
    label: "Tech Stack",
    table: "user_stack_tools",
    metrics: [
      { key: "count", label: "Count" },
    ],
    dimensions: [
      { key: "status", label: "Status" },
      { key: "category", label: "Category" },
    ],
    colorMap: { status: toolStatusColors },
  },

  projects: {
    label: "Projects",
    table: "projects",
    metrics: [
      { key: "count", label: "Count" },
    ],
    dimensions: [
      { key: "active_mode", label: "Mode" },
    ],
    colorMap: { active_mode: projectModeColors },
  },
};

/* ── Helpers ── */

export function getDataSource(key: string): DataSourceDef | undefined {
  return DATA_SOURCES[key];
}

export function getAllDataSources(): { key: string; def: DataSourceDef }[] {
  return Object.entries(DATA_SOURCES).map(([key, def]) => ({ key, def }));
}
