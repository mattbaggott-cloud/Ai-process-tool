"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  SlashPipelineData,
  SlashPeopleData,
  SlashAccountsData,
  SlashKnowledgeData,
  SlashCampaignsData,
  SlashProjectsData,
  SlashCustomersData,
  SlashOrdersData,
  SlashProductsData,
  SlashDashboardData,
  SlashToolsData,
  SlashGoalsData,
  SlashPainpointsData,
  SlashCadenceData,
  SlashOrganizationData,
  SlashDataData,
  SlashTasksData,
} from "@/components/chat/ChatMessageRenderer";

/* ── Helpers ─────────────────────────────────────────────── */

function formatCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatNumber(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

/* ═══════════════════════════════════════════════════════════
   PIPELINE VIEW — Kanban board with stage columns
   ═══════════════════════════════════════════════════════════ */

export function SlashPipelineView({ data }: { data: SlashPipelineData }) {
  const router = useRouter();

  const handleDealClick = useCallback((dealId: string) => {
    router.push(`/crm/deals/${dealId}`);
  }, [router]);

  return (
    <div className="slash-view slash-pipeline-view">
      {/* Summary bar */}
      <div className="slash-view-header">
        <h3 className="slash-view-title">Deal Pipeline</h3>
        <div className="slash-pipeline-stats">
          <span className="slash-stat">
            <span className="slash-stat-label">Pipeline</span>
            <span className="slash-stat-value">{formatCurrency(data.total_value)}</span>
          </span>
          <span className="slash-stat">
            <span className="slash-stat-label">Weighted</span>
            <span className="slash-stat-value">{formatCurrency(data.weighted_value)}</span>
          </span>
          <span className="slash-stat">
            <span className="slash-stat-label">Deals</span>
            <span className="slash-stat-value">{data.active_deals}</span>
          </span>
          {data.won_value > 0 && (
            <span className="slash-stat">
              <span className="slash-stat-label">Won</span>
              <span className="slash-stat-value slash-stat-won">{formatCurrency(data.won_value)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Kanban columns */}
      <div className="slash-pipeline-columns">
        {data.columns.map((col) => (
          <div key={col.stage} className="slash-pipeline-column">
            <div className="slash-pipeline-col-header" style={{ borderTopColor: col.color }}>
              <span className="slash-pipeline-stage-name">{col.label}</span>
              <span className="slash-pipeline-stage-count">{col.deal_count}</span>
            </div>
            {col.deals.map((deal) => (
              <div
                key={deal.id}
                className="slash-pipeline-card"
                onClick={() => handleDealClick(deal.id)}
                title="Click to view deal details"
              >
                <div className="slash-pipeline-card-title">{deal.title}</div>
                <div className="slash-pipeline-card-value">{formatCurrency(deal.value, deal.currency)}</div>
                {(deal.contact_name || deal.company_name) && (
                  <div className="slash-pipeline-card-meta">
                    {deal.contact_name}
                    {deal.contact_name && deal.company_name ? " \u00B7 " : ""}
                    {deal.company_name}
                  </div>
                )}
                {deal.expected_close_date && (
                  <div className="slash-pipeline-card-date">
                    Close: {formatRelativeDate(deal.expected_close_date)}
                  </div>
                )}
              </div>
            ))}
            {col.deals.length === 0 && (
              <div className="slash-pipeline-empty">No deals</div>
            )}
          </div>
        ))}
      </div>

      {data.total_deals === 0 && (
        <div className="slash-empty">No deals in your pipeline yet. Create one by saying &quot;Create a deal for...&quot;</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PEOPLE VIEW — Sortable contact table
   ═══════════════════════════════════════════════════════════ */

export function SlashPeopleView({ data }: { data: SlashPeopleData }) {
  const router = useRouter();
  const [sortField, setSortField] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    return [...data.contacts].sort((a, b) => {
      const av = (a as unknown as Record<string, string>)[sortField] || "";
      const bv = (b as unknown as Record<string, string>)[sortField] || "";
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data.contacts, sortField, sortDir]);

  const sortIndicator = (field: string) =>
    sortField === field ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "";

  const handleContactClick = useCallback((contactId: string) => {
    router.push(`/crm/contacts/${contactId}`);
  }, [router]);

  return (
    <div className="slash-view slash-people-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">People ({data.total_contacts})</h3>
        <div className="slash-people-status-badges">
          {Object.entries(data.by_status).map(([status, count]) => (
            <span key={status} className={`slash-status-badge slash-status-${status.toLowerCase()}`}>
              {status}: {count}
            </span>
          ))}
        </div>
      </div>

      {data.contacts.length > 0 ? (
        <div className="slash-table-scroll">
          <table className="slash-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort("name")}>Name{sortIndicator("name")}</th>
                <th onClick={() => toggleSort("company_name")}>Company{sortIndicator("company_name")}</th>
                <th onClick={() => toggleSort("email")}>Email{sortIndicator("email")}</th>
                <th onClick={() => toggleSort("status")}>Status{sortIndicator("status")}</th>
                <th onClick={() => toggleSort("last_activity")}>Last Activity{sortIndicator("last_activity")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((contact) => (
                <tr key={contact.id} onClick={() => handleContactClick(contact.id)} title="Click to view contact">
                  <td className="slash-people-name">{contact.name}</td>
                  <td>{contact.company_name || "\u2014"}</td>
                  <td>{contact.email || "\u2014"}</td>
                  <td>
                    <span className={`slash-status-pill slash-status-${contact.status.toLowerCase()}`}>
                      {contact.status}
                    </span>
                  </td>
                  <td>{contact.last_activity ? formatRelativeDate(contact.last_activity) : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="slash-empty">No contacts yet. Create one by saying &quot;Create a contact for...&quot;</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ACCOUNTS VIEW — Company card grid
   ═══════════════════════════════════════════════════════════ */

export function SlashAccountsView({ data }: { data: SlashAccountsData }) {
  const router = useRouter();

  const handleCompanyClick = useCallback((companyId: string) => {
    router.push(`/crm/companies/${companyId}`);
  }, [router]);

  return (
    <div className="slash-view slash-accounts-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">Accounts ({data.total_companies})</h3>
      </div>

      {data.companies.length > 0 ? (
        <div className="slash-accounts-grid">
          {data.companies.map((company) => (
            <div
              key={company.id}
              className="slash-account-card"
              onClick={() => handleCompanyClick(company.id)}
              title="Click to view account details"
            >
              <div className="slash-account-name">{company.name}</div>
              {company.industry && <div className="slash-account-industry">{company.industry}</div>}
              <div className="slash-account-stats">
                <span>{company.contact_count} contacts</span>
                <span>{company.deal_count} deals</span>
                {company.total_deal_value > 0 && <span>{formatCurrency(company.total_deal_value)}</span>}
              </div>
              {company.size && (
                <span className="slash-account-size">{company.size}</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="slash-empty">No companies yet. Create one by saying &quot;Create a company for...&quot;</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   KNOWLEDGE VIEW — Grouped library items
   ═══════════════════════════════════════════════════════════ */

export function SlashKnowledgeView({ data }: { data: SlashKnowledgeData }) {
  const router = useRouter();

  const items = data?.items ?? [];
  const byCategory = data?.by_category ?? {};
  const totalItems = data?.total_items ?? items.length;

  // Group items by category
  const grouped = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const cat = item.category || "Uncategorized";
      const group = map.get(cat) || [];
      group.push(item);
      map.set(cat, group);
    }
    return map;
  }, [items]);

  const handleItemClick = useCallback(() => {
    router.push("/library");
  }, [router]);

  return (
    <div className="slash-view slash-knowledge-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">Knowledge Base ({totalItems})</h3>
        <div className="slash-knowledge-categories">
          {Object.entries(byCategory).map(([cat, count]) => (
            <span key={cat} className="slash-category-badge">
              {cat}: {count}
            </span>
          ))}
        </div>
      </div>

      {items.length > 0 ? (
        <>
          {[...grouped.entries()].map(([category, items]) => (
            <div key={category} className="slash-knowledge-group">
              <div className="slash-knowledge-group-title">{category}</div>
              {items.map((item) => (
                <div key={item.id} className="slash-knowledge-item" onClick={handleItemClick} title="Click to view in library">
                  <div className="slash-knowledge-item-title">{item.title}</div>
                  {item.content_preview && (
                    <div className="slash-knowledge-item-preview">{item.content_preview}</div>
                  )}
                  <div className="slash-knowledge-item-meta">
                    {item.tags.length > 0 && item.tags.map((t) => (
                      <span key={t} className="slash-knowledge-tag">{t}</span>
                    ))}
                    <span className="slash-knowledge-date">{formatRelativeDate(item.updated_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      ) : (
        <div className="slash-empty">No knowledge items yet. Create one by saying &quot;Create a document about...&quot;</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CAMPAIGNS VIEW — Table-based, matching pipeline/people pattern
   ═══════════════════════════════════════════════════════════ */

export function SlashCampaignsView({ data }: { data: SlashCampaignsData }) {
  const router = useRouter();

  const handleCampaignClick = useCallback(() => {
    router.push("/campaigns");
  }, [router]);

  return (
    <div className="slash-view slash-campaigns-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">Campaigns</h3>
        <div className="slash-pipeline-stats">
          {data.by_status && Object.entries(data.by_status).map(([status, count]) => (
            <div key={status} className="slash-stat">
              <span className="slash-stat-label">{status}</span>
              <span className="slash-stat-value">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {data.campaigns.length > 0 ? (
        <div className="slash-table-scroll">
          <table className="slash-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Type</th>
                <th>Variants</th>
                <th>Sent</th>
                <th>Opens</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.id} onClick={handleCampaignClick}>
                  <td>
                    <span className="slash-people-name">{c.name}</span>
                  </td>
                  <td>
                    <span className={`slash-status-pill slash-camp-st-${c.status}`}>
                      {c.status}
                    </span>
                  </td>
                  <td style={{ color: "var(--color-gray-500)" }}>
                    {c.campaign_category || c.campaign_type || "\u2014"}
                  </td>
                  <td>{c.variant_count || "\u2014"}</td>
                  <td>{c.sent_count ? formatNumber(c.sent_count) : "\u2014"}</td>
                  <td>{c.open_rate !== null ? `${c.open_rate}%` : "\u2014"}</td>
                  <td style={{ color: "var(--color-gray-400)", fontSize: 11 }}>
                    {c.sent_at
                      ? formatRelativeDate(c.sent_at)
                      : formatRelativeDate(c.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="slash-empty">
          No campaigns yet. Create one by saying &quot;Create a campaign for...&quot;
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PROJECTS VIEW — Project card grid with mode indicators
   ═══════════════════════════════════════════════════════════ */

const MODE_ICONS: Record<string, string> = {
  canvas: "\u{1F4DD}",
  workflow: "\u26A1",
  chat: "\u{1F4AC}",
};

export function SlashProjectsView({ data }: { data: SlashProjectsData }) {
  const router = useRouter();

  const handleProjectClick = useCallback((slug: string) => {
    router.push(`/projects/${slug}`);
  }, [router]);

  return (
    <div className="slash-view slash-projects-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">Projects ({data.total_projects})</h3>
        <div className="slash-projects-modes">
          {data.by_mode && Object.entries(data.by_mode).map(([mode, count]) => (
            <span key={mode} className="slash-status-badge">
              {MODE_ICONS[mode] || ""} {mode}: {count}
            </span>
          ))}
        </div>
      </div>

      {data.projects.length > 0 ? (
        <div className="slash-projects-grid">
          {data.projects.map((project) => (
            <div
              key={project.id}
              className="slash-project-card"
              onClick={() => handleProjectClick(project.slug)}
              title="Click to open project"
            >
              <div className="slash-project-top">
                <div className="slash-project-name">{project.name}</div>
                <span className="slash-project-mode">
                  {MODE_ICONS[project.active_mode] || ""} {project.active_mode}
                </span>
              </div>
              {project.description && (
                <div className="slash-project-desc">{project.description}</div>
              )}
              <div className="slash-project-meta">
                {project.block_count > 0 && <span>{project.block_count} blocks</span>}
                {project.node_count > 0 && <span>{project.node_count} nodes</span>}
                {project.message_count > 0 && <span>{project.message_count} messages</span>}
                <span className="slash-project-date">{formatRelativeDate(project.updated_at)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="slash-empty">No projects yet. Create one by saying &quot;Create a project called...&quot;</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CUSTOMERS VIEW — E-commerce customer list (B2C)
   ═══════════════════════════════════════════════════════════ */

export function SlashCustomersView({ data }: { data: SlashCustomersData }) {
  const [sortField, setSortField] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    return [...data.customers].sort((a, b) => {
      const av = (a as unknown as Record<string, string | number>)[sortField] ?? "";
      const bv = (b as unknown as Record<string, string | number>)[sortField] ?? "";
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data.customers, sortField, sortDir]);

  const sortIndicator = (field: string) =>
    sortField === field ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "";

  return (
    <div className="slash-view slash-customers-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">Customers ({data.total_customers})</h3>
        <div className="slash-pipeline-stats">
          <span className="slash-stat">
            <span className="slash-stat-label">Total Revenue</span>
            <span className="slash-stat-value">{formatCurrency(data.total_revenue)}</span>
          </span>
          <span className="slash-stat">
            <span className="slash-stat-label">Avg Order</span>
            <span className="slash-stat-value">{formatCurrency(data.avg_order_value)}</span>
          </span>
        </div>
      </div>

      {data.customers.length > 0 ? (
        <div className="slash-table-scroll">
          <table className="slash-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort("name")}>Customer{sortIndicator("name")}</th>
                <th onClick={() => toggleSort("email")}>Email{sortIndicator("email")}</th>
                <th onClick={() => toggleSort("order_count")}>Orders{sortIndicator("order_count")}</th>
                <th onClick={() => toggleSort("total_spent")}>Total Spent{sortIndicator("total_spent")}</th>
                <th onClick={() => toggleSort("last_order_date")}>Last Order{sortIndicator("last_order_date")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((customer) => (
                <tr key={customer.id}>
                  <td className="slash-people-name">
                    {customer.first_name} {customer.last_name}
                  </td>
                  <td>{customer.email || "\u2014"}</td>
                  <td>{customer.order_count}</td>
                  <td style={{ fontWeight: 600 }}>{formatCurrency(customer.total_spent)}</td>
                  <td>{customer.last_order_date ? formatRelativeDate(customer.last_order_date) : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="slash-empty">No customers yet. Import your customer data to get started.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ORDERS VIEW — Recent orders list (B2C)
   ═══════════════════════════════════════════════════════════ */

const ORDER_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: "#fef3c7", text: "#d97706" },
  paid: { bg: "#dcfce7", text: "#16a34a" },
  fulfilled: { bg: "#dbeafe", text: "#2563eb" },
  shipped: { bg: "#ede9fe", text: "#7c3aed" },
  delivered: { bg: "#dcfce7", text: "#16a34a" },
  cancelled: { bg: "#fee2e2", text: "#dc2626" },
  refunded: { bg: "#f3f4f6", text: "#6b7280" },
};

export function SlashOrdersView({ data }: { data: SlashOrdersData }) {
  return (
    <div className="slash-view slash-orders-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">Orders ({data.total_orders})</h3>
        <div className="slash-pipeline-stats">
          <span className="slash-stat">
            <span className="slash-stat-label">Revenue</span>
            <span className="slash-stat-value">{formatCurrency(data.total_revenue)}</span>
          </span>
          <span className="slash-stat">
            <span className="slash-stat-label">Avg Value</span>
            <span className="slash-stat-value">{formatCurrency(data.avg_order_value)}</span>
          </span>
          {data.by_status && Object.entries(data.by_status).map(([status, count]) => (
            <span key={status} className="slash-stat">
              <span className="slash-stat-label">{status}</span>
              <span className="slash-stat-value">{count}</span>
            </span>
          ))}
        </div>
      </div>

      {data.orders.length > 0 ? (
        <div className="slash-table-scroll">
          <table className="slash-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Items</th>
                <th>Total</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <tr key={order.id}>
                  <td style={{ fontWeight: 500 }}>#{order.order_number || order.id.slice(0, 8)}</td>
                  <td>{order.customer_name || "\u2014"}</td>
                  <td>
                    <span
                      className="slash-status-pill"
                      style={{
                        background: ORDER_STATUS_COLORS[order.financial_status]?.bg || "#f3f4f6",
                        color: ORDER_STATUS_COLORS[order.financial_status]?.text || "#6b7280",
                      }}
                    >
                      {order.financial_status}
                    </span>
                  </td>
                  <td>{order.item_count}</td>
                  <td style={{ fontWeight: 600 }}>{formatCurrency(order.total_price)}</td>
                  <td>{formatRelativeDate(order.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="slash-empty">No orders yet. Import your order data to get started.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRODUCTS VIEW — Product catalog grid (B2C)
   ═══════════════════════════════════════════════════════════ */

export function SlashProductsView({ data }: { data: SlashProductsData }) {
  return (
    <div className="slash-view slash-products-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">Products ({data.total_products})</h3>
        <div className="slash-pipeline-stats">
          {data.by_type && Object.entries(data.by_type).map(([type, count]) => (
            <span key={type} className="slash-stat">
              <span className="slash-stat-label">{type}</span>
              <span className="slash-stat-value">{count}</span>
            </span>
          ))}
        </div>
      </div>

      {data.products.length > 0 ? (
        <div className="slash-accounts-grid">
          {data.products.map((product) => (
            <div key={product.id} className="slash-account-card">
              <div className="slash-account-name" style={{ color: "var(--color-gray-800)" }}>
                {product.title}
              </div>
              {product.product_type && (
                <div className="slash-account-industry">{product.product_type}</div>
              )}
              <div className="slash-account-stats">
                {product.price > 0 && <span>{formatCurrency(product.price)}</span>}
                {product.variant_count > 1 && <span>{product.variant_count} variants</span>}
                {product.total_sold > 0 && <span>{formatNumber(product.total_sold)} sold</span>}
              </div>
              {product.status && product.status !== "active" && (
                <span className="slash-account-size" style={{ background: "#fee2e2", color: "#dc2626" }}>
                  {product.status}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="slash-empty">No products yet. Import your product catalog to get started.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD VIEW — Aggregated overview metrics
   ═══════════════════════════════════════════════════════════ */

const TREND_ICONS: Record<string, string> = {
  up: "\u25B2",
  down: "\u25BC",
  neutral: "\u2022",
};

const HIGHLIGHT_ICONS: Record<string, string> = {
  deal: "\uD83D\uDCBC",
  contact: "\uD83D\uDC64",
  campaign: "\uD83D\uDCE7",
  order: "\uD83D\uDCE6",
  warning: "\u26A0\uFE0F",
  star: "\u2B50",
  info: "\u2139\uFE0F",
};

export function SlashDashboardView({ data }: { data: SlashDashboardData }) {
  return (
    <div className="slash-view slash-dashboard-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">Dashboard Overview</h3>
      </div>

      {/* Metric sections */}
      <div className="slash-dashboard-sections">
        {data.sections.map((section, sIdx) => (
          <div key={sIdx} className="slash-dashboard-section">
            <div className="slash-dashboard-section-title">{section.title}</div>
            <div className="slash-dashboard-metrics">
              {section.metrics.map((metric, mIdx) => (
                <div key={mIdx} className="slash-dashboard-metric">
                  <div className="slash-dashboard-metric-label">{metric.label}</div>
                  <div className="slash-dashboard-metric-value">{metric.value}</div>
                  {metric.change && (
                    <div className={`slash-dashboard-metric-change slash-trend-${metric.trend || "neutral"}`}>
                      {TREND_ICONS[metric.trend || "neutral"]} {metric.change}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Highlights */}
      {data.highlights && data.highlights.length > 0 && (
        <div className="slash-dashboard-highlights">
          <div className="slash-dashboard-section-title">Highlights</div>
          {data.highlights.map((highlight, hIdx) => (
            <div key={hIdx} className="slash-dashboard-highlight">
              <span className="slash-dashboard-highlight-icon">
                {HIGHLIGHT_ICONS[highlight.icon] || highlight.icon}
              </span>
              <span>{highlight.text}</span>
            </div>
          ))}
        </div>
      )}

      {data.sections.length === 0 && (
        <div className="slash-empty">No data to display yet. Start by creating contacts, deals, or importing data.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   /tools — Tech Stack View
   ═══════════════════════════════════════════════════════════ */

const STATUS_COLORS: Record<string, string> = {
  Active: "#16a34a",
  Evaluating: "#d97706",
  Deprecated: "#6b7280",
};

export function SlashToolsView({ data }: { data: SlashToolsData }) {
  const router = useRouter();

  if (data.tools.length === 0) {
    return (
      <div className="slash-view">
        <div className="slash-view-header">
          <span className="slash-view-title">Tech Stack (0)</span>
        </div>
        <div className="slash-empty">No tools in your stack yet. Add tools via the Tools page or ask the AI to help build your stack.</div>
      </div>
    );
  }

  const statusEntries = Object.entries(data.status_counts).sort((a, b) => b[1] - a[1]);
  const categoryEntries = Object.entries(data.category_counts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="slash-view">
      <div className="slash-view-header">
        <span className="slash-view-title">Tech Stack ({data.total})</span>
      </div>

      {/* Status summary */}
      <div className="slash-tools-status-bar">
        {statusEntries.map(([status, count]) => (
          <span
            key={status}
            className="slash-tools-status-pill"
            style={{ color: STATUS_COLORS[status] || "#6b7280" }}
          >
            <span className="slash-tools-status-dot" style={{ background: STATUS_COLORS[status] || "#6b7280" }} />
            {status}: {count}
          </span>
        ))}
      </div>

      {/* Category breakdown bar */}
      {categoryEntries.length > 1 && (
        <div className="slash-tools-categories">
          {categoryEntries.map(([cat, count]) => (
            <span key={cat} className="slash-tools-cat-chip">
              {cat} <span className="slash-tools-cat-count">{count}</span>
            </span>
          ))}
        </div>
      )}

      {/* Tool cards */}
      <div className="slash-tools-grid">
        {data.tools.map((tool) => (
          <div
            key={tool.id}
            className="slash-tools-card"
            onClick={() => router.push("/tools")}
          >
            <div className="slash-tools-card-top">
              <span className="slash-tools-card-name">{tool.name}</span>
              <span
                className="slash-tools-card-status"
                style={{ color: STATUS_COLORS[tool.status] || "#6b7280" }}
              >
                {tool.status}
              </span>
            </div>
            {tool.category && (
              <span className="slash-tools-card-category">{tool.category}</span>
            )}
            {tool.description && (
              <div className="slash-tools-card-desc">{tool.description}</div>
            )}
            {tool.teams.length > 0 && (
              <div className="slash-tools-card-teams">
                {tool.teams.map((t) => (
                  <span key={t} className="slash-tools-team-tag">{t}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   /goals VIEW
   ═══════════════════════════════════════════════════════════ */

const GOAL_STATUS_COLORS: Record<string, string> = {
  Backlog: "#6b7280",
  "Not Started": "#6b7280",
  "In Progress": "#3b82f6",
  "On Track": "#10b981",
  "At Risk": "#f59e0b",
  Completed: "#10b981",
  Done: "#10b981",
  Blocked: "#ef4444",
};

export function SlashGoalsView({ data }: { data: SlashGoalsData }) {
  const router = useRouter();

  if (data.goals.length === 0) {
    return (
      <div className="slash-view">
        <div className="slash-view-header">
          <span className="slash-view-title">Goals (0)</span>
        </div>
        <div className="slash-empty">No goals yet. Ask the AI to help define your organization&#39;s goals.</div>
      </div>
    );
  }

  const statusEntries = Object.entries(data.status_counts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="slash-view">
      <div className="slash-view-header">
        <span className="slash-view-title">Goals ({data.total})</span>
        {data.total_sub_goals > 0 && (
          <span className="slash-view-subtitle">{data.total_sub_goals} sub-goals</span>
        )}
      </div>

      {/* Status bar */}
      <div className="slash-goals-status-bar">
        {statusEntries.map(([status, count]) => (
          <span key={status} className="slash-goals-status-pill" style={{ color: GOAL_STATUS_COLORS[status] || "#6b7280" }}>
            <span className="slash-goals-status-dot" style={{ background: GOAL_STATUS_COLORS[status] || "#6b7280" }} />
            {status}: {count}
          </span>
        ))}
      </div>

      {/* Goal cards */}
      <div className="slash-goals-list">
        {data.goals.map((goal) => {
          const completedSubs = goal.sub_goals.filter((sg) => sg.status === "Completed" || sg.status === "Done").length;
          const totalSubs = goal.sub_goals.length;
          const progressPct = totalSubs > 0 ? Math.round((completedSubs / totalSubs) * 100) : null;

          return (
            <div
              key={goal.id}
              className="slash-goals-card"
              onClick={() => router.push("/organization/goals")}
            >
              <div className="slash-goals-card-top">
                <span className="slash-goals-card-name">{goal.name}</span>
                <span className="slash-goals-card-status" style={{ color: GOAL_STATUS_COLORS[goal.status] || "#6b7280" }}>
                  {goal.status}
                </span>
              </div>

              {goal.description && (
                <div className="slash-goals-card-desc">{goal.description}</div>
              )}

              <div className="slash-goals-card-meta">
                {goal.owner && <span className="slash-goals-meta-item">Owner: {goal.owner}</span>}
                {goal.metric && (
                  <span className="slash-goals-meta-item">
                    {goal.metric}{goal.metric_target ? ` → ${goal.metric_target}` : ""}
                  </span>
                )}
                {goal.start_date && goal.end_date && (
                  <span className="slash-goals-meta-item">
                    {new Date(goal.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {" – "}
                    {new Date(goal.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>

              {goal.teams.length > 0 && (
                <div className="slash-goals-card-teams">
                  {goal.teams.map((t) => <span key={t} className="slash-goals-team-tag">{t}</span>)}
                </div>
              )}

              {/* Sub-goals with progress */}
              {totalSubs > 0 && (
                <div className="slash-goals-subs">
                  <div className="slash-goals-subs-header">
                    <span>Sub-goals ({completedSubs}/{totalSubs})</span>
                    {progressPct !== null && (
                      <div className="slash-goals-progress">
                        <div className="slash-goals-progress-bar" style={{ width: `${progressPct}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="slash-goals-subs-list">
                    {goal.sub_goals.map((sg) => (
                      <div key={sg.id} className="slash-goals-sub-item">
                        <span className={`slash-goals-sub-check ${sg.status === "Completed" || sg.status === "Done" ? "done" : ""}`}>
                          {sg.status === "Completed" || sg.status === "Done" ? "✓" : "○"}
                        </span>
                        <span className="slash-goals-sub-name">{sg.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   /painpoints VIEW
   ═══════════════════════════════════════════════════════════ */

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#dc2626",
  High: "#ef4444",
  Medium: "#f59e0b",
  Low: "#6b7280",
};

const PAINPOINT_STATUS_COLORS: Record<string, string> = {
  Backlog: "#6b7280",
  "In Progress": "#3b82f6",
  Mitigated: "#10b981",
  Resolved: "#10b981",
  Accepted: "#8b5cf6",
};

export function SlashPainpointsView({ data }: { data: SlashPainpointsData }) {
  const router = useRouter();

  if (data.pain_points.length === 0) {
    return (
      <div className="slash-view">
        <div className="slash-view-header">
          <span className="slash-view-title">Pain Points (0)</span>
        </div>
        <div className="slash-empty">No pain points tracked yet. Ask the AI to help identify organizational challenges.</div>
      </div>
    );
  }

  const severityEntries = Object.entries(data.severity_counts).sort((a, b) => {
    const order = ["Critical", "High", "Medium", "Low"];
    return order.indexOf(a[0]) - order.indexOf(b[0]);
  });

  return (
    <div className="slash-view">
      <div className="slash-view-header">
        <span className="slash-view-title">Pain Points ({data.total})</span>
      </div>

      {/* Severity bar */}
      <div className="slash-pp-severity-bar">
        {severityEntries.map(([severity, count]) => (
          <span key={severity} className="slash-pp-severity-pill" style={{ color: SEVERITY_COLORS[severity] || "#6b7280" }}>
            <span className="slash-pp-severity-dot" style={{ background: SEVERITY_COLORS[severity] || "#6b7280" }} />
            {severity}: {count}
          </span>
        ))}
      </div>

      {/* Pain point cards */}
      <div className="slash-pp-list">
        {data.pain_points.map((pp) => (
          <div
            key={pp.id}
            className="slash-pp-card"
            onClick={() => router.push("/organization/goals")}
          >
            <div className="slash-pp-card-top">
              <div className="slash-pp-card-title-row">
                <span className="slash-pp-severity-badge" style={{ background: SEVERITY_COLORS[pp.severity] || "#6b7280" }}>
                  {pp.severity}
                </span>
                <span className="slash-pp-card-name">{pp.name}</span>
              </div>
              <span className="slash-pp-card-status" style={{ color: PAINPOINT_STATUS_COLORS[pp.status] || "#6b7280" }}>
                {pp.status}
              </span>
            </div>

            {pp.description && (
              <div className="slash-pp-card-desc">{pp.description}</div>
            )}

            <div className="slash-pp-card-meta">
              {pp.owner && <span className="slash-pp-meta-item">Owner: {pp.owner}</span>}
              {pp.impact_metric && <span className="slash-pp-meta-item">Impact: {pp.impact_metric}</span>}
              {pp.linked_goal && <span className="slash-pp-meta-item">Goal: {pp.linked_goal}</span>}
            </div>

            {pp.teams.length > 0 && (
              <div className="slash-pp-card-teams">
                {pp.teams.map((t) => <span key={t} className="slash-pp-team-tag">{t}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   /cadence VIEW — DEPRECATED, kept for backward compat.
   Now redirects to unified campaigns view at the API level.
   ═══════════════════════════════════════════════════════════ */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SlashCadenceView({ data }: { data: SlashCadenceData }) {
  // This should no longer be rendered since get_cadence_view redirects
  // to get_campaigns_view. Kept for TypeScript/import compatibility.
  return (
    <div className="slash-view">
      <div className="slash-view-header">
        <span className="slash-view-title">Sales Cadences</span>
      </div>
      <div className="slash-empty">
        Cadences are now unified with campaigns. Use /campaigns to see all campaigns and cadences.
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   /organization — Organization profile & team
   ══════════════════════════════════════════════════════════════ */

const ROLE_COLORS: Record<string, string> = {
  owner: "#7c3aed",
  admin: "#2563eb",
  member: "#6b7280",
  viewer: "#9ca3af",
};

export function SlashOrganizationView({ data }: { data: SlashOrganizationData }) {
  const router = useRouter();
  const hasInfo = data.name || data.description || data.industry;

  return (
    <div className="slash-view">
      <div className="slash-view-header">
        <span className="slash-view-title">{data.name || "Organization"}</span>
        {data.member_count > 0 && (
          <span className="slash-view-subtitle">{data.member_count} member{data.member_count !== 1 ? "s" : ""}</span>
        )}
      </div>

      <div className="slash-org-card" onClick={() => router.push("/organization")}>
        {/* Company info */}
        {hasInfo && (
          <div className="slash-org-info">
            {data.description && (
              <div className="slash-org-field">
                <div className="slash-org-label">About</div>
                <div className="slash-org-value">{data.description}</div>
              </div>
            )}
            <div className="slash-org-grid">
              {data.industry && (
                <div className="slash-org-field">
                  <div className="slash-org-label">Industry</div>
                  <div className="slash-org-value">{data.industry}</div>
                </div>
              )}
              {data.stage && (
                <div className="slash-org-field">
                  <div className="slash-org-label">Stage</div>
                  <div className="slash-org-value">{data.stage}</div>
                </div>
              )}
              {data.website && (
                <div className="slash-org-field">
                  <div className="slash-org-label">Website</div>
                  <div className="slash-org-value slash-org-link">{data.website}</div>
                </div>
              )}
              {data.target_market && (
                <div className="slash-org-field">
                  <div className="slash-org-label">Target Market</div>
                  <div className="slash-org-value">{data.target_market}</div>
                </div>
              )}
            </div>
            {data.differentiators && (
              <div className="slash-org-field">
                <div className="slash-org-label">Differentiators</div>
                <div className="slash-org-value">{data.differentiators}</div>
              </div>
            )}
            {data.notes && (
              <div className="slash-org-field">
                <div className="slash-org-label">Notes</div>
                <div className="slash-org-value">{data.notes}</div>
              </div>
            )}
          </div>
        )}

        {!hasInfo && (
          <div className="slash-empty">No organization info set yet. Tell the AI about your company to get started.</div>
        )}

        {/* Team members */}
        {data.members.length > 0 && (
          <div className="slash-org-members">
            <div className="slash-org-members-title">Team</div>
            <div className="slash-org-members-list">
              {data.members.map((m, i) => (
                <div key={i} className="slash-org-member-row">
                  <div className="slash-org-member-avatar">
                    {(m.display_name ?? "?")[0].toUpperCase()}
                  </div>
                  <div className="slash-org-member-info">
                    <span className="slash-org-member-name">{m.display_name ?? "Unnamed"}</span>
                    {m.job_title && <span className="slash-org-member-title">{m.job_title}</span>}
                  </div>
                  <span
                    className="slash-org-member-role"
                    style={{ color: ROLE_COLORS[m.role] ?? "#6b7280" }}
                  >
                    {m.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="slash-org-card-hint">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Click to open full organization settings
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DATA VIEW — Data connections & imports
   ═══════════════════════════════════════════════════════════ */

function ConnectorIcon({ type, size = 18 }: { type: string; size?: number }) {
  switch (type) {
    case "shopify":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M6 8l1-4h10l1 4" stroke="#95BF47" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 8h14l-1.5 12H6.5L5 8z" stroke="#95BF47" strokeWidth="2" strokeLinejoin="round" fill="#95BF47" fillOpacity="0.15" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" stroke="#95BF47" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "hubspot":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3.5" stroke="#FF7A59" strokeWidth="2" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5.64 5.64l2.83 2.83M15.54 15.54l2.83 2.83M5.64 18.36l2.83-2.83M15.54 8.46l2.83-2.83" stroke="#FF7A59" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "klaviyo":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="#2BBD7E" strokeWidth="2" fill="#2BBD7E" fillOpacity="0.1" />
          <path d="M3 7l9 5.5L21 7" stroke="#2BBD7E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "salesforce":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M4.5 14.5A3.5 3.5 0 0 1 4 7.5a4.5 4.5 0 0 1 8.5-1.5A3.5 3.5 0 0 1 19 8a3 3 0 0 1 1 5.82A3.5 3.5 0 0 1 16.5 18h-9A3.5 3.5 0 0 1 4.5 14.5z" stroke="#00A1E0" strokeWidth="2" fill="#00A1E0" fillOpacity="0.15" />
        </svg>
      );
    case "csv":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="#6B7280" strokeWidth="2" fill="#6B7280" fillOpacity="0.08" />
          <path d="M14 2v6h6" stroke="#6B7280" strokeWidth="2" strokeLinejoin="round" />
          <path d="M8 14h8M8 18h5" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="#9CA3AF" strokeWidth="2" />
          <path d="M8 12h8" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: "#dcfce7", text: "#166534", label: "Connected" },
  disconnected: { bg: "#f3f4f6", text: "#6b7280", label: "Disconnected" },
  error: { bg: "#fee2e2", text: "#991b1b", label: "Error" },
  syncing: { bg: "#dbeafe", text: "#1e40af", label: "Syncing" },
};

export function SlashDataView({ data }: { data: SlashDataData }) {
  const router = useRouter();
  const connectors = data?.connectors ?? [];
  const recentImports = data?.recent_imports ?? [];
  const availableTypes = data?.available_types ?? ["shopify", "hubspot", "klaviyo", "salesforce", "csv"];
  const activeCount = data?.active_connectors ?? 0;

  return (
    <div
      className="slash-view slash-data-view"
      onClick={() => router.push("/data")}
      style={{ cursor: "pointer" }}
      title="Click to manage data connections"
    >
      <div className="slash-view-header">
        <h3 className="slash-view-title">Data Connections</h3>
        {activeCount > 0 && (
          <span className="slash-data-active-count">{activeCount} active</span>
        )}
      </div>

      <div className="slash-data-body">
        {connectors.length > 0 ? (
          <div className="slash-data-connectors">
            {connectors.map((c) => {
              const status = STATUS_STYLES[c.status] ?? STATUS_STYLES.disconnected;
              return (
                <div key={c.id} className="slash-data-connector">
                  <span className="slash-data-connector-icon">
                    <ConnectorIcon type={c.type} size={24} />
                  </span>
                  <div className="slash-data-connector-info">
                    <div className="slash-data-connector-name">{c.name}</div>
                    {c.last_sync && (
                      <div className="slash-data-connector-sync">
                        Last synced {formatRelativeDate(c.last_sync)}
                      </div>
                    )}
                  </div>
                  <span
                    className="slash-data-status-badge"
                    style={{ background: status.bg, color: status.text }}
                  >
                    {status.label}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="slash-data-empty">
            <div className="slash-data-empty-icon">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-gray-300)" }}>
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
            </div>
            <div className="slash-data-empty-title">No data sources connected yet</div>
            <div className="slash-data-empty-desc">
              Connect your tools to unlock analytics, segmentation, and AI-powered insights.
            </div>
            <div className="slash-data-available">
              {availableTypes.map((t) => (
                <span key={t} className="slash-data-available-badge">
                  <ConnectorIcon type={t} size={16} />
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </span>
              ))}
            </div>
          </div>
        )}

        {recentImports.length > 0 && (
          <div className="slash-data-imports">
            <div className="slash-data-imports-title">Recent Imports</div>
            {recentImports.map((imp) => (
              <div key={imp.id} className="slash-data-import-row">
                <span>{imp.source}</span>
                <span className="slash-data-import-count">{imp.row_count.toLocaleString()} rows</span>
                <span className="slash-data-import-status">{imp.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="slash-data-footer">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        Manage connections
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   /tasks VIEW — Unified task hub
   ═══════════════════════════════════════════════════════════ */

export function SlashTasksView({ data }: { data: SlashTasksData }) {
  const activeTasks = useMemo(() =>
    data.tasks.filter(t => t.status === "pending" || t.status === "in_progress"),
  [data.tasks]);

  return (
    <div className="slash-view slash-tasks-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">Tasks</h3>
        <div className="slash-pipeline-stats">
          <div className="slash-stat">
            <span className="slash-stat-label">Active</span>
            <span className="slash-stat-value">{data.stats.pending + data.stats.in_progress}</span>
          </div>
          <div className="slash-stat">
            <span className="slash-stat-label">Done</span>
            <span className="slash-stat-value slash-stat-won">{data.stats.completed}</span>
          </div>
          {data.stats.overdue > 0 && (
            <div className="slash-stat">
              <span className="slash-stat-label">Overdue</span>
              <span className="slash-stat-value" style={{ color: "#dc2626" }}>{data.stats.overdue}</span>
            </div>
          )}
        </div>
      </div>

      {activeTasks.length > 0 ? (
        <div className="slash-table-scroll">
          <table className="slash-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Type</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {activeTasks.map((task) => {
                const isOverdue = task.due_at && new Date(task.due_at) < new Date() &&
                  task.status !== "completed" && task.status !== "cancelled";
                return (
                  <tr key={task.id}>
                    <td>
                      <div className="slash-people-name" style={{ cursor: "default" }}>{task.title}</div>
                      {task.campaign_name && (
                        <div style={{ fontSize: 10, color: "var(--color-gray-400)", marginTop: 1 }}>
                          {task.campaign_name}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`slash-status-pill slash-task-st-${task.status.replace(/_/g, "-")}`}>
                        {task.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>
                      {task.priority ? (
                        <span className={`slash-status-pill slash-task-pri-${task.priority}`}>
                          {task.priority}
                        </span>
                      ) : "\u2014"}
                    </td>
                    <td style={{ color: "var(--color-gray-500)", textTransform: "capitalize" }}>
                      {task.source === "campaign_task" ? "Campaign" : task.task_type.replace(/_/g, " ")}
                    </td>
                    <td style={{ color: isOverdue ? "#dc2626" : "var(--color-gray-400)", fontSize: 11, fontWeight: isOverdue ? 600 : 400 }}>
                      {task.due_at ? formatRelativeDate(task.due_at) : "\u2014"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="slash-empty">
          No active tasks. Ask the AI to create a reminder or to-do.
        </div>
      )}
    </div>
  );
}
