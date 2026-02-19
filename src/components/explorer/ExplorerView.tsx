"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/components/crm/shared";
import CrmPagination from "@/components/crm/CrmPagination";
import ExplorerMetrics from "./ExplorerMetrics";
import ExplorerTable from "./ExplorerTable";
import type { ExplorerRow } from "./ExplorerTable";
import {
  ENTITY_TYPES,
  SOURCES,
  ENTITY_SOURCE_MAP,
  getColumns,
  DEFAULT_SORT,
  formatNumber,
} from "./explorer-config";
import type { EntityType, SourceFilter, MetricDef } from "./explorer-config";
import type {
  CrmContact,
  CrmCompany,
  CrmDeal,
  EcomCustomer,
  EcomOrder,
  EcomProduct,
  CustomerIdentityLink,
} from "@/lib/types/database";

/* ================================================================== */
/*  ExplorerView — main client component for unified data browsing    */
/* ================================================================== */

export default function ExplorerView() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  /* ── URL-driven state ──────────────────────────────────── */
  const paramEntity = searchParams.get("entity") as EntityType | null;
  const paramSource = searchParams.get("source") as SourceFilter | null;

  const [entityType, setEntityType] = useState<EntityType>(
    paramEntity && ENTITY_TYPES.some((e) => e.key === paramEntity) ? paramEntity : "customers"
  );
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(
    paramSource && SOURCES.some((s) => s.key === paramSource) ? paramSource : "all"
  );

  /* ── Data + UI state ───────────────────────────────────── */
  const [rows, setRows] = useState<ExplorerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState(DEFAULT_SORT[entityType].field);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(DEFAULT_SORT[entityType].dir);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  /* ── Update URL when filters change ────────────────────── */
  const updateUrl = useCallback(
    (entity: EntityType, source: SourceFilter) => {
      router.replace(`/explorer?entity=${entity}&source=${source}`, { scroll: false });
    },
    [router]
  );

  /* ── Entity type change handler ────────────────────────── */
  const switchEntity = useCallback(
    (entity: EntityType) => {
      setEntityType(entity);
      setSearch("");
      setCurrentPage(1);
      setSortField(DEFAULT_SORT[entity].field);
      setSortDir(DEFAULT_SORT[entity].dir);

      // If current source isn't available for new entity, reset to "all"
      const available = ENTITY_SOURCE_MAP[entity];
      const newSource = available.includes(sourceFilter) ? sourceFilter : "all";
      setSourceFilter(newSource);
      updateUrl(entity, newSource);
    },
    [sourceFilter, updateUrl]
  );

  /* ── Source filter change handler ──────────────────────── */
  const switchSource = useCallback(
    (source: SourceFilter) => {
      setSourceFilter(source);
      setCurrentPage(1);
      updateUrl(entityType, source);
    },
    [entityType, updateUrl]
  );

  /* ── Sort handler ──────────────────────────────────────── */
  const handleSort = useCallback(
    (field: string) => {
      if (field === sortField) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("asc");
      }
    },
    [sortField]
  );

  /* ================================================================ */
  /*  DATA LOADING                                                    */
  /* ================================================================ */

  const loadData = useCallback(async () => {
    if (!user || !orgId) return;
    setLoading(true);

    try {
      let result: ExplorerRow[] = [];

      switch (entityType) {
        case "customers":
          result = await loadCustomers(sourceFilter);
          break;
        case "companies":
          result = await loadCompanies();
          break;
        case "orders":
          result = await loadOrders();
          break;
        case "products":
          result = await loadProducts();
          break;
        case "deals":
          result = await loadDeals();
          break;
      }

      setRows(result);
    } catch (err) {
      console.error("[Explorer] Failed to load data:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, orgId, entityType, sourceFilter]);

  /* ── Customers (merged CRM + Ecom) ─────────────────────── */
  async function loadCustomers(source: SourceFilter): Promise<ExplorerRow[]> {
    const out: ExplorerRow[] = [];

    if (source === "all" || source === "hubspot") {
      const { data: contacts } = await supabase
        .from("crm_contacts")
        .select("*, crm_companies(name)")
        .order("created_at", { ascending: false });

      if (contacts) {
        for (const c of contacts as (CrmContact & { crm_companies?: { name: string } | null })[]) {
          out.push({
            id: c.id,
            _entityType: "customers",
            _source: "hubspot",
            name: [c.first_name, c.last_name].filter(Boolean).join(" "),
            email: c.email,
            status: c.status,
            company_name: c.crm_companies?.name ?? "",
            title: c.title,
            orders_count: null,
            total_spent: null,
            avg_order_value: null,
            last_activity: c.updated_at,
            last_order_at: null,
            _crm_id: c.id,
          });
        }
      }
    }

    if (source === "all" || source === "shopify") {
      const { data: ecomCustomers } = await supabase
        .from("ecom_customers")
        .select("*")
        .order("created_at", { ascending: false });

      if (ecomCustomers) {
        // If showing all sources, check for identity links to mark "both"
        let linkedEcomIds: Set<string> = new Set();
        let linkedCrmIds: Set<string> = new Set();

        if (source === "all") {
          const { data: links } = await supabase
            .from("customer_identity_links")
            .select("crm_contact_id, ecom_customer_id")
            .eq("is_active", true);

          if (links) {
            for (const l of links as CustomerIdentityLink[]) {
              linkedEcomIds.add(l.ecom_customer_id);
              linkedCrmIds.add(l.crm_contact_id);
            }
          }

          // Update CRM rows that are linked
          for (const row of out) {
            if (row._crm_id && linkedCrmIds.has(row._crm_id as string)) {
              row._source = "both";
            }
          }
        }

        for (const e of ecomCustomers as EcomCustomer[]) {
          // If this ecom customer is linked to a CRM contact, skip (already marked as "both")
          if (source === "all" && linkedEcomIds.has(e.id)) {
            // Find the corresponding CRM row and enrich with ecom data
            const crmRow = out.find(
              (r) => r._source === "both" && r._crm_id &&
              linkedCrmIds.has(r._crm_id as string)
            );
            // Simple approach: just enrich any matching "both" row we find
            if (crmRow) {
              crmRow.orders_count = e.orders_count;
              crmRow.total_spent = e.total_spent;
              crmRow.avg_order_value = e.avg_order_value;
              crmRow.last_order_at = e.last_order_at;
            }
            continue;
          }

          out.push({
            id: e.id,
            _entityType: "customers",
            _source: "shopify",
            name: [e.first_name, e.last_name].filter(Boolean).join(" ") || e.email || "Unknown",
            email: e.email,
            status: null,
            orders_count: e.orders_count,
            total_spent: e.total_spent,
            avg_order_value: e.avg_order_value,
            last_activity: e.last_order_at,
            last_order_at: e.last_order_at,
            company_name: null,
            title: null,
          });
        }
      }
    }

    return out;
  }

  /* ── Companies ─────────────────────────────────────────── */
  async function loadCompanies(): Promise<ExplorerRow[]> {
    const { data } = await supabase
      .from("crm_companies")
      .select("*")
      .order("name");

    if (!data) return [];
    return (data as CrmCompany[]).map((c) => ({
      id: c.id,
      _entityType: "companies" as EntityType,
      _source: "hubspot",
      name: c.name,
      industry: c.industry,
      size: c.size,
      annual_revenue: c.annual_revenue,
      employees: c.employees,
      created_at: c.created_at,
    }));
  }

  /* ── Orders ────────────────────────────────────────────── */
  async function loadOrders(): Promise<ExplorerRow[]> {
    const { data } = await supabase
      .from("ecom_orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (!data) return [];
    return (data as EcomOrder[]).map((o) => ({
      id: o.id,
      _entityType: "orders" as EntityType,
      _source: "shopify",
      order_number: o.order_number ?? o.external_id,
      email: o.email,
      total_price: o.total_price,
      financial_status: o.financial_status,
      fulfillment_status: o.fulfillment_status ?? "unfulfilled",
      line_items_count: Array.isArray(o.line_items) ? o.line_items.length : 0,
      created_at: o.created_at,
    }));
  }

  /* ── Products ──────────────────────────────────────────── */
  async function loadProducts(): Promise<ExplorerRow[]> {
    const { data } = await supabase
      .from("ecom_products")
      .select("*")
      .order("title");

    if (!data) return [];
    return (data as EcomProduct[]).map((p) => {
      const variants = Array.isArray(p.variants) ? p.variants : [];
      const prices = variants.map((v) => v.price).filter((x) => x != null);
      let priceRange = "—";
      if (prices.length === 1) priceRange = formatCurrency(prices[0]);
      else if (prices.length > 1) {
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        priceRange = min === max ? formatCurrency(min) : `${formatCurrency(min)} – ${formatCurrency(max)}`;
      }

      return {
        id: p.id,
        _entityType: "products" as EntityType,
        _source: "shopify",
        title: p.title,
        vendor: p.vendor,
        product_type: p.product_type,
        status: p.status,
        variant_count: variants.length,
        price_range: priceRange,
      };
    });
  }

  /* ── Deals ─────────────────────────────────────────────── */
  async function loadDeals(): Promise<ExplorerRow[]> {
    const [dealsRes, contactsRes, companiesRes] = await Promise.all([
      supabase.from("crm_deals").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_contacts").select("id, first_name, last_name"),
      supabase.from("crm_companies").select("id, name"),
    ]);

    if (!dealsRes.data) return [];

    const contactMap: Record<string, string> = {};
    if (contactsRes.data) {
      for (const c of contactsRes.data) {
        contactMap[c.id] = [c.first_name, c.last_name].filter(Boolean).join(" ");
      }
    }

    const companyMap: Record<string, string> = {};
    if (companiesRes.data) {
      for (const c of companiesRes.data) companyMap[c.id] = c.name;
    }

    return (dealsRes.data as CrmDeal[]).map((d) => ({
      id: d.id,
      _entityType: "deals" as EntityType,
      _source: "hubspot",
      title: d.title,
      value: d.value,
      stage: d.stage,
      contact_name: d.contact_id ? contactMap[d.contact_id] ?? "" : "",
      company_name: d.company_id ? companyMap[d.company_id] ?? "" : "",
      expected_close_date: d.expected_close_date,
    }));
  }

  /* ── Load on mount + when filters change ───────────────── */
  useEffect(() => {
    loadData();
  }, [loadData]);

  /* Listen for workspace updates */
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadData]);

  /* ================================================================ */
  /*  FILTERING, SORTING, PAGINATION                                  */
  /* ================================================================ */

  const processedRows = useMemo(() => {
    let filtered = rows;

    // Search filter — search across all string values
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((row) =>
        Object.values(row).some(
          (v) => v != null && String(v).toLowerCase().includes(q)
        )
      );
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let cmp = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal), undefined, { sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return filtered;
  }, [rows, search, sortField, sortDir]);

  // Paginated rows
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedRows.slice(start, start + pageSize);
  }, [processedRows, currentPage, pageSize]);

  /* ================================================================ */
  /*  METRICS COMPUTATION                                             */
  /* ================================================================ */

  const metrics = useMemo((): MetricDef[] => {
    if (loading || rows.length === 0) return [];

    switch (entityType) {
      case "customers": {
        const total = rows.length;
        const fromHub = rows.filter((r) => r._source === "hubspot").length;
        const fromShop = rows.filter((r) => r._source === "shopify").length;
        const linked = rows.filter((r) => r._source === "both").length;
        return [
          { label: "Total People", value: formatNumber(total) },
          { label: "From HubSpot", value: formatNumber(fromHub) },
          { label: "From Shopify", value: formatNumber(fromShop) },
          { label: "Linked (Both)", value: formatNumber(linked) },
        ];
      }
      case "companies": {
        const total = rows.length;
        const rev = rows.reduce((sum, r) => sum + ((r.annual_revenue as number) || 0), 0);
        const emps = rows.filter((r) => r.employees != null);
        const avgEmps = emps.length > 0
          ? Math.round(emps.reduce((s, r) => s + (r.employees as number), 0) / emps.length)
          : 0;
        return [
          { label: "Total Companies", value: formatNumber(total) },
          { label: "Total Revenue", value: formatCurrency(rev) },
          { label: "Avg Employees", value: formatNumber(avgEmps) },
        ];
      }
      case "orders": {
        const total = rows.length;
        const rev = rows.reduce((s, r) => s + ((r.total_price as number) || 0), 0);
        const aov = total > 0 ? rev / total : 0;
        const fulfilled = rows.filter((r) => r.fulfillment_status === "fulfilled").length;
        const rate = total > 0 ? Math.round((fulfilled / total) * 100) : 0;
        return [
          { label: "Total Orders", value: formatNumber(total) },
          { label: "Revenue", value: formatCurrency(rev) },
          { label: "Avg Order Value", value: formatCurrency(aov) },
          { label: "Fulfillment Rate", value: `${rate}%` },
        ];
      }
      case "products": {
        const total = rows.length;
        const active = rows.filter((r) => r.status === "active").length;
        const totalVariants = rows.reduce((s, r) => s + ((r.variant_count as number) || 0), 0);
        return [
          { label: "Total Products", value: formatNumber(total) },
          { label: "Active", value: formatNumber(active) },
          { label: "Total Variants", value: formatNumber(totalVariants) },
        ];
      }
      case "deals": {
        const total = rows.length;
        const pipeline = rows
          .filter((r) => r.stage !== "won" && r.stage !== "lost")
          .reduce((s, r) => s + ((r.value as number) || 0), 0);
        const avg = total > 0
          ? rows.reduce((s, r) => s + ((r.value as number) || 0), 0) / total
          : 0;
        const won = rows.filter((r) => r.stage === "won").length;
        const closed = rows.filter((r) => r.stage === "won" || r.stage === "lost").length;
        const winRate = closed > 0 ? Math.round((won / closed) * 100) : 0;
        return [
          { label: "Total Deals", value: formatNumber(total) },
          { label: "Pipeline Value", value: formatCurrency(pipeline) },
          { label: "Avg Deal Size", value: formatCurrency(avg) },
          { label: "Win Rate", value: `${winRate}%` },
        ];
      }
      default:
        return [];
    }
  }, [entityType, rows, loading]);

  /* ── Columns for current entity + source ───────────────── */
  const columns = useMemo(() => getColumns(entityType, sourceFilter), [entityType, sourceFilter]);

  /* ── Available sources for current entity ──────────────── */
  const availableSources = ENTITY_SOURCE_MAP[entityType];

  /* ================================================================ */
  /*  RENDER                                                          */
  /* ================================================================ */

  return (
    <div className="explorer-page">
      {/* ── Header ──────────────────────────────────── */}
      <div className="explorer-header">
        <h1 className="explorer-title">Data Explorer</h1>
        <p className="explorer-subtitle">
          Browse all your data across connected sources
        </p>
      </div>

      {/* ── Entity type pills ───────────────────────── */}
      <div className="explorer-pills">
        {ENTITY_TYPES.map((e) => (
          <button
            key={e.key}
            className={`explorer-pill ${entityType === e.key ? "explorer-pill-active" : ""}`}
            onClick={() => switchEntity(e.key)}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* ── Source filter pills ──────────────────────── */}
      <div className="explorer-source-pills">
        {SOURCES.map((s) => {
          const available = availableSources.includes(s.key);
          return (
            <button
              key={s.key}
              className={`explorer-source-pill ${
                sourceFilter === s.key ? "explorer-source-pill-active" : ""
              } ${!available ? "explorer-pill-disabled" : ""}`}
              onClick={() => available && switchSource(s.key)}
              disabled={!available}
            >
              {s.key !== "all" && (
                <span
                  className="explorer-source-dot"
                  style={{ backgroundColor: s.color }}
                />
              )}
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ── Metrics bar ─────────────────────────────── */}
      <ExplorerMetrics metrics={metrics} />

      {/* ── Search toolbar ──────────────────────────── */}
      <div className="crm-toolbar" style={{ flexShrink: 0 }}>
        <input
          className="crm-search-input"
          type="text"
          placeholder={`Search ${entityType}...`}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCurrentPage(1);
          }}
        />
        <span className="crm-record-count">
          {processedRows.length.toLocaleString()} {entityType}
        </span>
      </div>

      {/* ── Scrollable content (table + pagination) ── */}
      <div className="explorer-scroll">
        <ExplorerTable
          rows={paginatedRows}
          columns={columns}
          sortField={sortField}
          sortDirection={sortDir}
          onSort={handleSort}
          loading={loading}
        />

        <CrmPagination
          totalItems={processedRows.length}
          pageSize={pageSize}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          label={entityType}
        />
      </div>
    </div>
  );
}
