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
  onboarding_completed: boolean;
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

/* ── Agentic Graph ────────────────────────────────────── */

// Re-export agentic types for convenience
export type {
  GraphNode,
  GraphEdge,
  AgenticEvent,
  EventInput,
  EventCategory,
  EventType,
  ActorType,
  TraversalNode,
} from "@/lib/agentic/types";

/* ── CRM Module ────────────────────────────────────────── */

export type ContactStatus = "lead" | "active" | "inactive" | "churned";
export type ContactSource =
  | "manual"
  | "import"
  | "ai"
  | "referral"
  | "gmail"
  | "outreach"
  | "hubspot"
  | "shopify"
  | "klaviyo"
  | "google_calendar"
  | "google_drive"
  | "salesforce"
  | "salesloft";
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

/* ── Shopify Connector ─────────────────────────────────── */

export interface ShopifyConfig {
  access_token: string;
  shop: string;                       // e.g. "my-store.myshopify.com"
  scopes: string[];
}

/* ── Klaviyo Connector ──────────────────────────────────── */

export interface KlaviyoConfig {
  api_key: string;
  api_revision?: string;        // e.g. "2025-01-15"
  account_name?: string;        // from GET /accounts/
}

/* ── Google Connectors (shared config) ─────────────────── */

export interface GoogleConnectorConfig {
  access_token: string;
  refresh_token: string;
  expires_at: number;           // Unix timestamp in ms
  scopes: string[];
  email?: string;               // user's Google email
}

/* ── Outreach Connector ────────────────────────────────── */

export interface OutreachConfig {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scopes: string[];
  org_name?: string;
}

/* ── Gmail Types ───────────────────────────────────────── */

export interface GmailMessage {
  id: string;
  org_id: string;
  user_id: string;
  external_id: string;
  thread_id: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  labels: string[];
  is_read: boolean;
  is_starred: boolean;
  has_attachments: boolean;
  internal_date: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  synced_at: string;
}

/* ── Calendar Types ────────────────────────────────────── */

export interface CalendarEvent {
  id: string;
  org_id: string;
  user_id: string;
  external_id: string;
  calendar_id: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  status: string | null;
  organizer_email: string | null;
  attendees: Array<{ email: string; name?: string; response_status?: string }>;
  recurrence: string[];
  html_link: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  synced_at: string;
}

/* ── Drive Types ───────────────────────────────────────── */

export interface DriveFile {
  id: string;
  org_id: string;
  user_id: string;
  external_id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  web_view_link: string | null;
  icon_link: string | null;
  parent_folder_id: string | null;
  parent_folder_name: string | null;
  owners: Array<{ email: string; name?: string }>;
  shared_with: Array<{ email: string; name?: string }>;
  modified_time: string | null;
  created_time: string | null;
  is_indexed: boolean;
  library_item_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  synced_at: string;
}

/* ── Outreach Types ────────────────────────────────────── */

export interface OutreachProspect {
  id: string;
  org_id: string;
  user_id: string;
  external_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  company_name: string | null;
  phone: string | null;
  tags: string[];
  stage: string | null;
  owner_email: string | null;
  engaged_at: string | null;
  contacted_at: string | null;
  replied_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  synced_at: string;
}

export interface OutreachSequence {
  id: string;
  org_id: string;
  user_id: string;
  external_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  sequence_type: string | null;
  step_count: number;
  prospect_count: number;
  open_rate: number | null;
  click_rate: number | null;
  reply_rate: number | null;
  bounce_rate: number | null;
  owner_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  synced_at: string;
}

export interface OutreachTask {
  id: string;
  org_id: string;
  user_id: string;
  external_id: string;
  subject: string | null;
  task_type: string | null;
  status: string | null;
  due_at: string | null;
  completed_at: string | null;
  prospect_external_id: string | null;
  sequence_external_id: string | null;
  owner_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  synced_at: string;
}

/* ── E-Commerce (Shopify + future platforms) ──────────── */

export interface EcomCustomer {
  id: string;
  org_id: string;
  external_id: string;
  external_source: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  orders_count: number;
  total_spent: number;
  avg_order_value: number;
  first_order_at: string | null;
  last_order_at: string | null;
  tags: string[];
  accepts_marketing: boolean;
  default_address: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  synced_at: string;
}

export interface EcomOrderLineItem {
  product_id: string | null;
  variant_id: string | null;
  title: string;
  variant_title: string | null;
  quantity: number;
  price: number;
  sku: string | null;
}

export interface EcomOrder {
  id: string;
  org_id: string;
  external_id: string;
  external_source: string;
  customer_id: string | null;
  customer_external_id: string | null;
  order_number: string | null;
  email: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  total_price: number | null;
  subtotal_price: number | null;
  total_tax: number | null;
  total_discounts: number | null;
  total_shipping: number | null;
  currency: string;
  line_items: EcomOrderLineItem[];
  shipping_address: Record<string, unknown> | null;
  billing_address: Record<string, unknown> | null;
  discount_codes: Record<string, unknown>[];
  tags: string[];
  note: string | null;
  source_name: string | null;
  referring_site: string | null;
  landing_site: string | null;
  cancelled_at: string | null;
  closed_at: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string;
}

export interface EcomProductVariant {
  id: string;
  title: string;
  price: number;
  sku: string | null;
  inventory_quantity: number | null;
  weight: number | null;
  weight_unit: string | null;
}

export interface EcomProduct {
  id: string;
  org_id: string;
  external_id: string;
  external_source: string;
  title: string;
  handle: string | null;
  body_html: string | null;
  vendor: string | null;
  product_type: string | null;
  status: string;
  tags: string[];
  variants: EcomProductVariant[];
  images: Record<string, unknown>[];
  options: Record<string, unknown>[];
  metadata: Record<string, unknown>;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string;
}

/* ── Customer Identity Linking ────────────────────────── */

export type MatchType =
  | 'email_exact'
  | 'phone_match'
  | 'name_company'
  | 'name_email_domain'
  | 'name_city'
  | 'name_only'
  | 'manual';
export type CustomerClassification = 'customer' | 'lead' | 'prospect' | 'ecom_only';

export interface CustomerIdentityLink {
  id: string;
  org_id: string;
  crm_contact_id: string;
  ecom_customer_id: string;
  match_type: MatchType;
  confidence: number;
  matched_on: string | null;
  is_active: boolean;
  linked_at: string;
  linked_by: string | null;
}

/* ── Data Home types ──────────────────────────────────── */

export type ConnectorType = 'csv' | 'salesforce' | 'hubspot' | 'shopify' | 'klaviyo' | 'meta_ads' | 'dynamics' | 'sharepoint' | 'google_workspace' | 'gmail' | 'google_calendar' | 'google_drive' | 'outreach';
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

/* ── Segmentation types ──────────────────────────────────── */

export type SegmentStatus = 'active' | 'paused' | 'archived';
export type SegmentType = 'behavioral' | 'rfm' | 'product_affinity' | 'lifecycle' | 'custom';
export type IntervalTrend = 'accelerating' | 'stable' | 'decelerating' | 'erratic' | 'insufficient_data';
export type LifecycleStage = 'new' | 'active' | 'loyal' | 'at_risk' | 'lapsed' | 'win_back' | 'champion';
export type CommStyle = 'casual' | 'data_driven' | 'aspirational' | 'urgency_responsive' | 'social_proof' | 'unknown';

export interface SegmentRule {
  type: 'and' | 'or' | 'rule';
  field?: string;
  operator?: string;
  value?: string | number | boolean;
  children?: SegmentRule[];
}

export interface Segment {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: SegmentStatus;
  segment_type: SegmentType;
  rules: SegmentRule;
  behavioral_insights: Record<string, unknown>;
  parent_id: string | null;
  depth: number;
  path: string[];
  branch_dimension: string | null;
  branch_value: string | null;
  customer_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentMember {
  id: string;
  org_id: string;
  segment_id: string;
  ecom_customer_id: string;
  behavioral_data: Record<string, unknown>;
  score: number;
  assigned_at: string;
  expires_at: string | null;
}

export interface CustomerBehavioralProfile {
  id: string;
  org_id: string;
  ecom_customer_id: string;
  purchase_intervals_days: number[];
  avg_interval_days: number | null;
  interval_stddev: number | null;
  interval_trend: IntervalTrend | null;
  predicted_next_purchase: string | null;
  days_until_predicted: number | null;
  product_affinities: ProductAffinity[];
  top_product_type: string | null;
  top_product_title: string | null;
  recency_score: number | null;
  frequency_score: number | null;
  monetary_score: number | null;
  velocity_score: number | null;
  consistency_score: number | null;
  engagement_score: number | null;
  lifecycle_stage: LifecycleStage | null;
  inferred_comm_style: CommStyle | null;
  computed_at: string;
}

export interface ProductAffinity {
  product_title: string;
  product_type: string;
  purchase_count: number;
  total_quantity: number;
  pct_of_orders: number;
}

export interface DiscoveredSegment {
  lifecycle_stage: string;
  top_product_type: string;
  interval_trend: string;
  comm_style: string;
  customer_count: number;
  avg_engagement: number;
  avg_purchase_interval_days: number | null;
  avg_consistency: number;
  avg_rfm: { recency: number; frequency: number; monetary: number };
  suggested_name: string;
}

/* ── Email Content Engine types ─────────────────────────── */

export type BrandAssetType = 'template' | 'example' | 'style_guide' | 'image' | 'html_template';
export type EmailStatus = 'draft' | 'approved' | 'sent' | 'archived';
export type EmailType = 'promotional' | 'win_back' | 'nurture' | 'announcement' | 'educational' | 'milestone' | 'custom';

export interface EmailBrandAsset {
  id: string;
  org_id: string;
  name: string;
  asset_type: BrandAssetType;
  content_text: string | null;
  content_html: string | null;
  storage_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailGeneratedContent {
  id: string;
  org_id: string;
  segment_id: string | null;
  name: string;
  status: EmailStatus;
  email_type: EmailType;
  subject_line: string;
  preview_text: string | null;
  body_html: string | null;
  body_text: string | null;
  prompt_used: string | null;
  brand_asset_ids: string[];
  segment_context: Record<string, unknown>;
  generation_model: string;
  personalization_fields: string[];
  variants: Record<string, unknown>[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/* ── Campaign Engine types ─────────────────────────────── */

export type CampaignType = "per_customer" | "broadcast" | "sequence";
export type CampaignStatus = "draft" | "generating" | "review" | "approved" | "sending" | "sent" | "paused" | "cancelled" | "failed";
export type VariantStatus = "draft" | "approved" | "edited" | "rejected" | "sending" | "sent" | "failed";
export type DeliveryStatus = "pending" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "failed";
export type DeliveryChannel = "klaviyo" | "mailchimp" | "sendgrid" | "salesloft" | "gmail" | "outreach";

export type StepType =
  | "auto_email"
  | "manual_email"
  | "phone_call"
  | "linkedin_view"
  | "linkedin_connect"
  | "linkedin_message"
  | "custom_task";

export type ExecutionMode = "manual" | "automatic";

export type CampaignTaskStatus = "pending" | "in_progress" | "completed" | "skipped" | "failed";

export type ValidationFailureReason =
  | "missing_email"
  | "invalid_email"
  | "empty_subject"
  | "empty_body"
  | "missing_variables"
  | "provider_error"
  | "bounce_hard"
  | "bounce_soft";
export type CampaignEmailType = "promotional" | "win_back" | "nurture" | "announcement" | "welcome" | "follow_up" | "custom";

export interface EmailCampaign {
  id: string;
  org_id: string;
  name: string;
  campaign_type: CampaignType;
  segment_id: string | null;
  status: CampaignStatus;
  email_type: CampaignEmailType;
  prompt_used: string | null;
  delivery_channel: DeliveryChannel;
  delivery_config: Record<string, unknown>;
  template_id: string | null;
  total_variants: number;
  approved_count: number;
  sent_count: number;
  failed_count: number;
  stats: Record<string, unknown>;
  has_strategy: boolean;
  execution_mode: ExecutionMode;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailCustomerVariant {
  id: string;
  org_id: string;
  campaign_id: string;
  ecom_customer_id: string | null;
  customer_email: string;
  customer_name: string | null;
  subject_line: string | null;
  preview_text: string | null;
  body_html: string | null;
  body_text: string | null;
  personalization_context: Record<string, unknown>;
  status: VariantStatus;
  edited_content: Record<string, unknown> | null;
  strategy_group_id: string | null;
  step_number: number;
  delivery_id: string | null;
  delivery_status: DeliveryStatus;
  delivery_metrics: Record<string, unknown>;
  reviewed_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailSequenceStep {
  id: string;
  org_id: string;
  campaign_id: string;
  step_number: number;
  delay_days: number;
  email_type: CampaignEmailType;
  prompt: string | null;
  subject_template: string | null;
  status: "draft" | "generating" | "review" | "sending" | "sent";
  created_at: string;
  updated_at: string;
}

/* ── Campaign Strategy types ──────────────────────────── */

export interface StrategySequenceStep {
  step_number: number;
  delay_days: number;
  email_type: string;
  prompt: string;
  subject_hint?: string;
  step_type?: StepType;          // defaults to "auto_email" if absent (backward compat)
  channel?: DeliveryChannel;     // per-step channel override; falls back to campaign-level
  task_instructions?: string;    // instructions for manual/non-email steps
}

export interface CampaignStrategyGroup {
  id: string;
  org_id: string;
  campaign_id: string;
  group_name: string;
  group_description: string | null;
  ai_reasoning: string | null;
  filter_criteria: Record<string, unknown>;
  customer_ids: string[];
  customer_count: number;
  sequence_steps: StrategySequenceStep[];
  total_emails: number;
  sort_order: number;
  status: string;
  created_at: string;
  updated_at: string;
}

/* ── Campaign Task types ──────────────────────────────── */

export interface CampaignTask {
  id: string;
  org_id: string;
  campaign_id: string;
  variant_id: string | null;
  strategy_group_id: string | null;
  step_number: number;
  step_type: StepType;
  ecom_customer_id: string | null;
  customer_email: string;
  customer_name: string | null;
  assigned_to: string | null;
  title: string;
  instructions: string | null;
  status: CampaignTaskStatus;
  due_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SendValidationError {
  variant_id: string;
  customer_email: string;
  customer_name: string | null;
  reasons: ValidationFailureReason[];
  details?: Record<string, string>;
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
