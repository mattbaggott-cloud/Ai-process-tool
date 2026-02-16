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

/* ── CRM color maps ── */

const dealStageColors: Record<string, string> = {
  "lead":        "#2563eb",
  "qualified":   "#7c3aed",
  "proposal":    "#d97706",
  "negotiation": "#ea580c",
  "won":         "#16a34a",
  "lost":        "#dc2626",
};

const contactStatusColors: Record<string, string> = {
  "lead":     "#2563eb",
  "active":   "#059669",
  "inactive": "#6b7280",
  "churned":  "#dc2626",
};

const companySizeColors: Record<string, string> = {
  "startup":    "#06b6d4",
  "small":      "#2563eb",
  "medium":     "#7c3aed",
  "large":      "#ea580c",
  "enterprise": "#dc2626",
};

const activityTypeColors: Record<string, string> = {
  "call":    "#2563eb",
  "email":   "#7c3aed",
  "meeting": "#059669",
  "note":    "#6b7280",
  "task":    "#d97706",
};

const assetStatusColors: Record<string, string> = {
  "active":    "#059669",
  "expired":   "#d97706",
  "cancelled": "#6b7280",
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

  /* ── CRM Data Sources ── */

  crm_deals: {
    label: "Deals",
    table: "crm_deals",
    metrics: [
      { key: "count", label: "Deal Count" },
      { key: "sum:value", label: "Total Value" },
    ],
    dimensions: [
      { key: "stage", label: "Stage" },
      { key: "company_id", label: "Company" },
      { key: "contact_id", label: "Contact" },
    ],
    colorMap: { stage: dealStageColors },
  },

  crm_contacts: {
    label: "Contacts",
    table: "crm_contacts",
    metrics: [
      { key: "count", label: "Contact Count" },
    ],
    dimensions: [
      { key: "status", label: "Status" },
      { key: "source", label: "Source" },
      { key: "company_id", label: "Company" },
    ],
    colorMap: { status: contactStatusColors },
  },

  crm_companies: {
    label: "Companies",
    table: "crm_companies",
    metrics: [
      { key: "count", label: "Company Count" },
      { key: "sum:annual_revenue", label: "Total Revenue" },
      { key: "sum:employees", label: "Total Employees" },
    ],
    dimensions: [
      { key: "size", label: "Size" },
      { key: "industry", label: "Industry" },
      { key: "sector", label: "Sector" },
    ],
    colorMap: { size: companySizeColors },
  },

  crm_activities: {
    label: "Activities",
    table: "crm_activities",
    metrics: [
      { key: "count", label: "Activity Count" },
    ],
    dimensions: [
      { key: "type", label: "Type" },
      { key: "deal_id", label: "Deal" },
      { key: "contact_id", label: "Contact" },
    ],
    colorMap: { type: activityTypeColors },
  },

  crm_products: {
    label: "Products",
    table: "crm_products",
    metrics: [
      { key: "count", label: "Product Count" },
    ],
    dimensions: [
      { key: "category", label: "Category" },
      { key: "is_active", label: "Active Status" },
    ],
  },

  crm_deal_line_items: {
    label: "Deal Line Items",
    table: "crm_deal_line_items",
    metrics: [
      { key: "count", label: "Line Item Count" },
      { key: "sum:total", label: "Total Revenue" },
    ],
    dimensions: [
      { key: "product_name", label: "Product" },
    ],
  },

  crm_company_assets: {
    label: "Company Assets",
    table: "crm_company_assets",
    metrics: [
      { key: "count", label: "Asset Count" },
      { key: "sum:annual_value", label: "Total Annual Value" },
    ],
    dimensions: [
      { key: "status", label: "Status" },
      { key: "product_name", label: "Product" },
    ],
    colorMap: { status: assetStatusColors },
  },
};

/* ── Helpers ── */

export function getDataSource(key: string): DataSourceDef | undefined {
  return DATA_SOURCES[key];
}

export function getAllDataSources(): { key: string; def: DataSourceDef }[] {
  return Object.entries(DATA_SOURCES).map(([key, def]) => ({ key, def }));
}
