/* ------------------------------------------------------------------ */
/*  Shared TypeScript types — matches Supabase table schemas          */
/*  This file grows as we add tables in later phases                  */
/* ------------------------------------------------------------------ */

/* ── Multi-Tenancy & RBAC ──────────────────────────────── */

export type OrgRole = 'owner' | 'admin' | 'manager' | 'user' | 'viewer';

export interface Org {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface OrgDepartment {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface OrgDepartmentMember {
  id: string;
  department_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface OrgInvite {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  department_ids: string[];
  invited_by: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

/* ── Profile (auth) ────────────────────────────────────── */

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

// User Profile (extended context for AI copilot)
export interface UserProfile {
  id: string;
  user_id: string;
  org_id: string;
  display_name: string;
  email: string;
  job_title: string;
  department: string;
  bio: string;
  areas_of_expertise: string[];
  years_of_experience: string;
  decision_authority: string;
  communication_preferences: string;
  key_responsibilities: string;
  focus_areas: string;
  created_at: string;
  updated_at: string;
}

/* ── Library ───────────────────────────────────────────── */

export type Category = "Note" | "Document" | "Template" | "Reference";

export interface LibraryItem {
  id: string;
  user_id: string;
  org_id: string;
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
  org_id: string;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  text_content: string | null;
  added_at: string;
}

/* ── Goals ─────────────────────────────────────────────── */

export type GoalStatus = "Backlog" | "To Do" | "In Progress" | "In Review" | "Done";

export interface Goal {
  id: string;
  user_id: string;
  org_id: string;
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
  org_id: string;
  name: string;
  description: string;
  status: GoalStatus;
  owner: string;
  end_date: string | null;
  created_at: string;
}

/* ── Pain Points ───────────────────────────────────────── */

export type PainPointSeverity = "Low" | "Medium" | "High" | "Critical";

export interface PainPoint {
  id: string;
  user_id: string;
  org_id: string;
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

/* ── Dashboards ────────────────────────────────────────── */

export type WidgetType = "metric" | "bar" | "pie" | "line" | "table" | "progress";

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  data_source: string;
  metric: string;
  group_by?: string;
  filters?: Record<string, string>;
  size: { cols: 1 | 2; height: "sm" | "md" | "lg" };
}

export interface Dashboard {
  id: string;
  user_id: string;
  org_id: string;
  name: string;
  widgets: WidgetConfig[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/* ── Vector Search / RAG ───────────────────────────────── */

export interface DocumentChunk {
  id: string;
  user_id: string;
  org_id: string;
  source_table: string;
  source_id: string;
  source_field: string;
  chunk_index: number;
  chunk_text: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  created_at: string;
  updated_at: string;
}

export interface LLMLog {
  id: string;
  user_id: string;
  org_id: string;
  model: string;
  system_prompt_tokens: number | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_cost: number;
  output_cost: number;
  total_cost: number;
  latency_ms: number;
  retrieved_chunk_ids: string[];
  retrieved_count: number;
  tool_calls: { name: string; success: boolean }[];
  tool_rounds: number;
  user_message: string | null;
  stop_reason: string | null;
  error: string | null;
  created_at: string;
}

export interface SearchResult {
  sourceTable: string;
  sourceId: string;
  chunkText: string;
  metadata: Record<string, unknown>;
  score: number;
}

/* ── Teams ─────────────────────────────────────────────── */

export type KpiPeriod = "Day" | "Week" | "Month" | "Quarter" | "Year";

export interface Team {
  id: string;
  user_id: string;
  org_id: string;
  slug: string;
  name: string;
  description: string;
  created_at: string;
}

export interface TeamRole {
  id: string;
  team_id: string;
  org_id: string;
  name: string;
  description: string;
  headcount: number;
  created_at: string;
}

export interface TeamKPI {
  id: string;
  team_id: string;
  org_id: string;
  name: string;
  current_value: number | null;
  target_value: number | null;
  period: KpiPeriod;
  created_at: string;
}

export interface TeamTool {
  id: string;
  team_id: string;
  org_id: string;
  name: string;
  purpose: string;
  created_at: string;
}

export interface TeamFile {
  id: string;
  team_id: string;
  user_id: string;
  org_id: string;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  text_content: string | null;
  added_at: string;
}

/* ── Org Profile (company info for AI context) ─────────── */
/* Renamed from "Organization" — the SQL table is now "org_profiles" */

export type OrgStage = "Idea" | "Pre-Seed" | "Seed" | "Series A" | "Series B" | "Series C+" | "Growth" | "Public";

export interface OrgProfile {
  id: string;
  user_id: string;
  org_id: string;
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

/** @deprecated Use OrgProfile instead */
export type Organization = OrgProfile;

export interface OrgProfileFile {
  id: string;
  user_id: string;
  org_id: string;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  text_content: string | null;
  added_at: string;
}

/** @deprecated Use OrgProfileFile instead */
export type OrganizationFile = OrgProfileFile;

/* ── Tool Catalog + Stack ──────────────────────────────── */

export type ToolStatus = "Active" | "Evaluating" | "Deprecated";

export interface ToolCatalogItem {
  id: string;
  user_id: string;
  org_id: string;
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
  org_id: string;
  catalog_id: string | null;
  name: string;
  description: string;
  category: string;
  teams: string[];
  team_usage: Record<string, string>;
  status: ToolStatus;
  created_at: string;
}

/* ── Projects (unified workspace) ──────────────────────── */

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
  org_id: string;
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

/* ── Workflow Executions ───────────────────────────────── */

export type WorkflowExecutionStatus = 'in_progress' | 'completed' | 'cancelled';

export interface CompletedNodeEntry {
  nodeId: string;
  nodeTitle: string;
  completedBy: string;
  completedAt: string;
  notes?: string;
  branchChosen?: string;
}

export interface WorkflowExecution {
  id: string;
  org_id: string;
  project_id: string;
  started_by: string;
  status: WorkflowExecutionStatus;
  current_node_id: string | null;
  completed_nodes: CompletedNodeEntry[];
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

/* ── CRM Module ────────────────────────────────────────── */

export type ContactStatus = "lead" | "active" | "inactive" | "churned";
export type ContactSource = "manual" | "import" | "ai" | "referral";
export type CompanySize = "" | "startup" | "small" | "medium" | "large" | "enterprise";
export type DealStage = "lead" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
export type ActivityType = "call" | "email" | "meeting" | "note" | "task";

export interface CrmCompany {
  id: string;
  user_id: string;
  org_id: string;
  name: string;
  domain: string;
  industry: string;
  size: CompanySize;
  description: string;
  website: string;
  phone: string;
  address: string;
  annual_revenue: number | null;
  employees: number | null;
  sic_code: string;
  sector: string;
  account_owner: string;
  billing_address: string;
  shipping_address: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CrmContact {
  id: string;
  user_id: string;
  org_id: string;
  company_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  title: string;
  status: ContactStatus;
  source: ContactSource;
  notes: string;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CrmContactWithCompany extends CrmContact {
  company?: CrmCompany | null;
}

export interface CrmDeal {
  id: string;
  user_id: string;
  org_id: string;
  contact_id: string | null;
  company_id: string | null;
  title: string;
  value: number;
  currency: string;
  stage: DealStage;
  probability: number;
  expected_close_date: string | null;
  notes: string;
  next_steps: string;
  close_reason: string;
  closed_at: string | null;
  lost_to: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CrmDealStageHistory {
  id: string;
  user_id: string;
  org_id: string;
  deal_id: string;
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
  notes: string;
}

export interface CrmProduct {
  id: string;
  user_id: string;
  org_id: string;
  name: string;
  sku: string;
  description: string;
  category: string;
  unit_price: number;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CrmDealLineItem {
  id: string;
  user_id: string;
  org_id: string;
  deal_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  notes: string;
  created_at: string;
}

export interface CrmCompanyAsset {
  id: string;
  user_id: string;
  org_id: string;
  company_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  purchase_date: string;
  renewal_date: string;
  annual_value: number;
  status: string;
  notes: string;
  created_at: string;
}

export interface CrmActivity {
  id: string;
  user_id: string;
  org_id: string;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  type: ActivityType;
  subject: string;
  description: string;
  scheduled_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/* ── CRM Custom Fields ───────────────────────────────── */

export type CustomFieldType = 'text' | 'number' | 'date' | 'boolean' | 'select';

export interface CrmCustomField {
  id: string;
  user_id: string;
  org_id: string;
  table_name: string;
  field_key: string;
  field_label: string;
  field_type: CustomFieldType;
  is_required: boolean;
  options: string[];
  sort_order: number;
  created_at: string;
}

/* ── CRM Reports ────────────────────────────────────── */

export type ReportEntityType = 'contacts' | 'companies' | 'deals' | 'activities';

export type FilterOperator =
  | 'equals' | 'not_equals'
  | 'contains' | 'starts_with'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'before' | 'after'
  | 'is_true' | 'is_false'
  | 'is' | 'is_not'
  | 'is_empty' | 'is_not_empty';

export interface ReportFilter {
  field: string;
  operator: FilterOperator;
  value: string;
}

export interface ReportSortConfig {
  field: string;
  direction: 'asc' | 'desc';
}

export interface CrmReport {
  id: string;
  user_id: string;
  org_id: string;
  name: string;
  description: string;
  entity_type: ReportEntityType;
  columns: string[];
  filters: ReportFilter[];
  sort_config: ReportSortConfig;
  created_at: string;
  updated_at: string;
}

/* ── HubSpot Connector ───────────────────────────────── */

export interface HubSpotConfig {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  hub_id: string;
  scopes: string[];
  field_mappings?: {
    contacts?: Record<string, string>;
    companies?: Record<string, string>;
    deals?: Record<string, string>;
  };
}

export type HubSpotSyncDirection = 'import' | 'export' | 'both';

/* ── Data Home types ──────────────────────────────────── */

export type ConnectorType = 'csv' | 'salesforce' | 'hubspot' | 'dynamics' | 'sharepoint' | 'google_workspace';
export type ConnectorStatus = 'available' | 'connected' | 'error' | 'coming_soon';
export type ImportStatus = 'pending' | 'mapping' | 'importing' | 'completed' | 'failed';
export type SyncEventType = 'info' | 'warning' | 'error' | 'success';

export interface DataConnector {
  id: string;
  user_id: string;
  org_id: string;
  connector_type: ConnectorType;
  name: string;
  description: string;
  status: ConnectorStatus;
  config: Record<string, unknown>;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldMapping {
  csv_column: string;
  target_field: string;
  skipped: boolean;
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
}

export interface DataImport {
  id: string;
  user_id: string;
  org_id: string;
  connector_id: string | null;
  source_name: string;
  target_table: string;
  status: ImportStatus;
  total_rows: number;
  imported_rows: number;
  error_rows: number;
  mapped_fields: FieldMapping[];
  errors: ImportError[];
  file_preview: Record<string, string>[];
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface DataSyncLog {
  id: string;
  user_id: string;
  org_id: string;
  connector_id: string | null;
  import_id: string | null;
  event_type: SyncEventType;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
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
