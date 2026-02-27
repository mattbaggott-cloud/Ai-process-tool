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

  // Group items by category
  const grouped = useMemo(() => {
    const map = new Map<string, typeof data.items>();
    for (const item of data.items) {
      const cat = item.category || "Uncategorized";
      const group = map.get(cat) || [];
      group.push(item);
      map.set(cat, group);
    }
    return map;
  }, [data.items]);

  const handleItemClick = useCallback(() => {
    router.push("/library");
  }, [router]);

  return (
    <div className="slash-view slash-knowledge-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">Knowledge Base ({data.total_items})</h3>
        <div className="slash-knowledge-categories">
          {Object.entries(data.by_category).map(([cat, count]) => (
            <span key={cat} className="slash-category-badge">
              {cat}: {count}
            </span>
          ))}
        </div>
      </div>

      {data.items.length > 0 ? (
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
   CAMPAIGNS VIEW — Campaign list with status + metrics
   ═══════════════════════════════════════════════════════════ */

const CAMPAIGN_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: "#f3f4f6", text: "#6b7280" },
  generating: { bg: "#ede9fe", text: "#7c3aed" },
  ready: { bg: "#dbeafe", text: "#2563eb" },
  sending: { bg: "#fef3c7", text: "#d97706" },
  sent: { bg: "#dcfce7", text: "#16a34a" },
  paused: { bg: "#fee2e2", text: "#dc2626" },
};

export function SlashCampaignsView({ data }: { data: SlashCampaignsData }) {
  const router = useRouter();

  const handleCampaignClick = useCallback(() => {
    router.push("/campaigns");
  }, [router]);

  return (
    <div className="slash-view slash-campaigns-view">
      <div className="slash-view-header">
        <h3 className="slash-view-title">Campaigns ({data.total_campaigns})</h3>
        <div className="slash-campaigns-stats">
          {data.by_status && Object.entries(data.by_status).map(([status, count]) => (
            <span
              key={status}
              className="slash-status-badge"
              style={{
                background: CAMPAIGN_STATUS_COLORS[status]?.bg || "#f3f4f6",
                color: CAMPAIGN_STATUS_COLORS[status]?.text || "#6b7280",
              }}
            >
              {status}: {count}
            </span>
          ))}
        </div>
      </div>

      {data.campaigns.length > 0 ? (
        <div className="slash-campaigns-list">
          {data.campaigns.map((campaign) => (
            <div
              key={campaign.id}
              className="slash-campaign-card"
              onClick={handleCampaignClick}
              title="Click to view campaigns"
            >
              <div className="slash-campaign-top">
                <div className="slash-campaign-name">{campaign.name}</div>
                <span
                  className="slash-campaign-status"
                  style={{
                    background: CAMPAIGN_STATUS_COLORS[campaign.status]?.bg || "#f3f4f6",
                    color: CAMPAIGN_STATUS_COLORS[campaign.status]?.text || "#6b7280",
                  }}
                >
                  {campaign.status}
                </span>
              </div>
              {campaign.campaign_type && (
                <div className="slash-campaign-type">{campaign.campaign_type}</div>
              )}
              <div className="slash-campaign-metrics">
                <span>{campaign.variant_count} variants</span>
                {campaign.sent_count > 0 && <span>{formatNumber(campaign.sent_count)} sent</span>}
                {campaign.open_rate !== null && <span>{campaign.open_rate}% opened</span>}
                {campaign.click_rate !== null && <span>{campaign.click_rate}% clicked</span>}
              </div>
              <div className="slash-campaign-date">
                {campaign.sent_at
                  ? `Sent ${formatRelativeDate(campaign.sent_at)}`
                  : `Created ${formatRelativeDate(campaign.created_at)}`}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="slash-empty">No campaigns yet. Create one by saying &quot;Create a campaign for...&quot;</div>
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
