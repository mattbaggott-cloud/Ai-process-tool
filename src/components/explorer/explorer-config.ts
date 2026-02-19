/* ------------------------------------------------------------------ */
/*  Explorer Configuration — entity types, columns, sources           */
/*  Pure TypeScript — no React                                        */
/* ------------------------------------------------------------------ */

/* ── Types ──────────────────────────────────────────────── */

export type EntityType = "customers" | "companies" | "orders" | "products" | "deals";
export type SourceFilter = "all" | "hubspot" | "shopify" | "klaviyo";

export type CellRender = "text" | "currency" | "date" | "status" | "tags" | "source_badge" | "number" | "boolean";

export interface ColumnDef {
  key: string;
  label: string;
  sortable: boolean;
  render: CellRender;
  width?: string;
}

export interface MetricDef {
  label: string;
  value: string | number;
}

/* ── Entity type definitions ────────────────────────────── */

export const ENTITY_TYPES: { key: EntityType; label: string }[] = [
  { key: "customers", label: "Customers" },
  { key: "companies", label: "Companies" },
  { key: "orders",    label: "Orders" },
  { key: "products",  label: "Products" },
  { key: "deals",     label: "Deals" },
];

/* ── Source definitions ─────────────────────────────────── */

export const SOURCES: { key: SourceFilter; label: string; color: string }[] = [
  { key: "all",     label: "All Sources", color: "#6b7280" },
  { key: "hubspot", label: "HubSpot",     color: "#ff7a59" },
  { key: "shopify", label: "Shopify",     color: "#96bf48" },
  { key: "klaviyo", label: "Klaviyo",     color: "#2dd4bf" },
];

/* Which sources are available for each entity type */
export const ENTITY_SOURCE_MAP: Record<EntityType, SourceFilter[]> = {
  customers: ["all", "hubspot", "shopify", "klaviyo"],
  companies: ["all", "hubspot"],
  orders:    ["all", "shopify"],
  products:  ["all", "shopify"],
  deals:     ["all", "hubspot"],
};

/* ── Column definitions per entity type ─────────────────── */

const CUSTOMER_COLUMNS_ALL: ColumnDef[] = [
  { key: "name",           label: "Name",          sortable: true,  render: "text" },
  { key: "email",          label: "Email",         sortable: true,  render: "text" },
  { key: "_source",        label: "Source",        sortable: true,  render: "source_badge" },
  { key: "status",         label: "Status",        sortable: true,  render: "status" },
  { key: "orders_count",   label: "Orders",        sortable: true,  render: "number" },
  { key: "total_spent",    label: "Total Spent",   sortable: true,  render: "currency" },
  { key: "last_activity",  label: "Last Activity", sortable: true,  render: "date" },
];

const CUSTOMER_COLUMNS_HUBSPOT: ColumnDef[] = [
  { key: "name",         label: "Name",    sortable: true,  render: "text" },
  { key: "email",        label: "Email",   sortable: true,  render: "text" },
  { key: "company_name", label: "Company", sortable: true,  render: "text" },
  { key: "title",        label: "Title",   sortable: true,  render: "text" },
  { key: "status",       label: "Status",  sortable: true,  render: "status" },
  { key: "_source",      label: "Source",  sortable: false, render: "source_badge" },
];

const CUSTOMER_COLUMNS_SHOPIFY: ColumnDef[] = [
  { key: "name",            label: "Name",            sortable: true,  render: "text" },
  { key: "email",           label: "Email",           sortable: true,  render: "text" },
  { key: "orders_count",    label: "Orders",          sortable: true,  render: "number" },
  { key: "total_spent",     label: "Total Spent",     sortable: true,  render: "currency" },
  { key: "avg_order_value", label: "Avg Order Value", sortable: true,  render: "currency" },
  { key: "last_order_at",   label: "Last Order",      sortable: true,  render: "date" },
  { key: "_source",         label: "Source",           sortable: false, render: "source_badge" },
];

const CUSTOMER_COLUMNS_KLAVIYO: ColumnDef[] = [
  { key: "name",           label: "Name",         sortable: true,  render: "text" },
  { key: "email",          label: "Email",        sortable: true,  render: "text" },
  { key: "phone_number",   label: "Phone",        sortable: true,  render: "text" },
  { key: "company_name",   label: "Organization", sortable: true,  render: "text" },
  { key: "title",          label: "Title",        sortable: true,  render: "text" },
  { key: "city",           label: "City",         sortable: true,  render: "text" },
  { key: "last_activity",  label: "Synced",       sortable: true,  render: "date" },
  { key: "_source",        label: "Source",       sortable: false, render: "source_badge" },
];

const COMPANY_COLUMNS: ColumnDef[] = [
  { key: "name",           label: "Name",      sortable: true,  render: "text" },
  { key: "industry",       label: "Industry",  sortable: true,  render: "text" },
  { key: "size",           label: "Size",      sortable: true,  render: "status" },
  { key: "annual_revenue", label: "Revenue",   sortable: true,  render: "currency" },
  { key: "employees",      label: "Employees", sortable: true,  render: "number" },
  { key: "_source",        label: "Source",    sortable: false, render: "source_badge" },
  { key: "created_at",     label: "Created",   sortable: true,  render: "date" },
];

const ORDER_COLUMNS: ColumnDef[] = [
  { key: "order_number",       label: "Order #",      sortable: true,  render: "text" },
  { key: "email",              label: "Customer",     sortable: true,  render: "text" },
  { key: "total_price",        label: "Total",        sortable: true,  render: "currency" },
  { key: "financial_status",   label: "Status",       sortable: true,  render: "status" },
  { key: "fulfillment_status", label: "Fulfillment",  sortable: true,  render: "status" },
  { key: "line_items_count",   label: "Items",        sortable: true,  render: "number" },
  { key: "_source",            label: "Source",       sortable: false, render: "source_badge" },
  { key: "created_at",         label: "Date",         sortable: true,  render: "date" },
];

const PRODUCT_COLUMNS: ColumnDef[] = [
  { key: "title",         label: "Title",    sortable: true,  render: "text" },
  { key: "vendor",        label: "Vendor",   sortable: true,  render: "text" },
  { key: "product_type",  label: "Type",     sortable: true,  render: "text" },
  { key: "status",        label: "Status",   sortable: true,  render: "status" },
  { key: "variant_count", label: "Variants", sortable: true,  render: "number" },
  { key: "price_range",   label: "Price",    sortable: false, render: "text" },
  { key: "_source",       label: "Source",   sortable: false, render: "source_badge" },
];

const DEAL_COLUMNS: ColumnDef[] = [
  { key: "title",               label: "Title",          sortable: true,  render: "text" },
  { key: "value",               label: "Value",          sortable: true,  render: "currency" },
  { key: "stage",               label: "Stage",          sortable: true,  render: "status" },
  { key: "contact_name",        label: "Contact",        sortable: true,  render: "text" },
  { key: "company_name",        label: "Company",        sortable: true,  render: "text" },
  { key: "expected_close_date", label: "Expected Close", sortable: true,  render: "date" },
  { key: "_source",             label: "Source",         sortable: false, render: "source_badge" },
];

/* Get columns for a given entity type + source filter */
export function getColumns(entity: EntityType, source: SourceFilter): ColumnDef[] {
  if (entity === "customers") {
    if (source === "hubspot") return CUSTOMER_COLUMNS_HUBSPOT;
    if (source === "shopify") return CUSTOMER_COLUMNS_SHOPIFY;
    if (source === "klaviyo") return CUSTOMER_COLUMNS_KLAVIYO;
    return CUSTOMER_COLUMNS_ALL;
  }
  if (entity === "companies") return COMPANY_COLUMNS;
  if (entity === "orders")    return ORDER_COLUMNS;
  if (entity === "products")  return PRODUCT_COLUMNS;
  if (entity === "deals")     return DEAL_COLUMNS;
  return CUSTOMER_COLUMNS_ALL;
}

/* ── Default sort per entity type ───────────────────────── */

export const DEFAULT_SORT: Record<EntityType, { field: string; dir: "asc" | "desc" }> = {
  customers: { field: "name",       dir: "asc" },
  companies: { field: "name",       dir: "asc" },
  orders:    { field: "created_at", dir: "desc" },
  products:  { field: "title",      dir: "asc" },
  deals:     { field: "value",      dir: "desc" },
};

/* ── Source badge colors ────────────────────────────────── */

export const SOURCE_COLORS: Record<string, string> = {
  hubspot: "#ff7a59",
  shopify: "#96bf48",
  klaviyo: "#2dd4bf",
  both:    "#7c3aed",
  manual:  "#6b7280",
};

/* ── Formatting helpers ─────────────────────────────────── */

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString();
}
