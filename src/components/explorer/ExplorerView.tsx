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
import IdentityResolutionPanel from "./IdentityResolutionPanel";
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

  /* ── Customers — always loads ALL sources, merges via graph edges, then filters ── */
  async function loadCustomers(source: SourceFilter): Promise<ExplorerRow[]> {
    const out: ExplorerRow[] = [];

    // Always load ALL sources so identity-resolved records merge correctly.
    // We filter by the selected source AFTER merging.

    // ── Load CRM contacts ──
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
          _sources: ["hubspot"],
          _primarySource: "hubspot",
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

    // ── Load ecom customers ──
    const { data: ecomCustomers } = await supabase
      .from("ecom_customers")
      .select("*")
      .order("created_at", { ascending: false });

    if (ecomCustomers) {
      for (const e of ecomCustomers as EcomCustomer[]) {
        out.push({
          id: e.id,
          _entityType: "customers",
          _source: "shopify",
          _sources: ["shopify"],
          _primarySource: "shopify",
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

    // ── Load Klaviyo profiles ──
    const { data: profiles, error: klaviyoError } = await supabase
      .from("klaviyo_profiles")
      .select("id, org_id, email, phone_number, first_name, last_name, organization, title, city, region, country, synced_at, created_at")
      .order("created_at", { ascending: false });

    if (klaviyoError) {
      console.error("[Explorer] Klaviyo profiles query failed:", klaviyoError);
    }

    if (profiles) {
      for (const p of profiles as Record<string, unknown>[]) {
        const email = (p.email as string) || "";
        out.push({
          id: p.id as string,
          _entityType: "customers",
          _source: "klaviyo",
          _sources: ["klaviyo"],
          _primarySource: "klaviyo",
          name: [(p.first_name as string), (p.last_name as string)].filter(Boolean).join(" ") || email || "Unknown",
          email,
          status: null,
          orders_count: null,
          total_spent: null,
          avg_order_value: null,
          last_activity: (p.synced_at as string) || (p.created_at as string),
          last_order_at: null,
          company_name: (p.organization as string) || null,
          title: (p.title as string) || null,
          phone_number: (p.phone_number as string) || null,
          city: (p.city as string) || null,
        });
      }
    }

    // ── Merge records linked via identity resolution graph edges ──
    let merged = out;
    try {
      const SOURCE_TYPE_MAP: Record<string, string> = {
        hubspot: "crm_contacts",
        shopify: "ecom_customers",
        klaviyo: "klaviyo_profiles",
      };

      const entityKeyToIdx = new Map<string, number>();
      for (let i = 0; i < out.length; i++) {
        const src = out[i]._source as string;
        const entityType = SOURCE_TYPE_MAP[src] || src;
        entityKeyToIdx.set(`${entityType}:${out[i].id}`, i);
      }

      const entityIds = out.map((r) => r.id as string);
      const { data: graphNodes } = await supabase
        .from("graph_nodes")
        .select("id, entity_type, entity_id")
        .in("entity_type", ["crm_contacts", "ecom_customers", "klaviyo_profiles"])
        .in("entity_id", entityIds);

      if (graphNodes && graphNodes.length > 0) {
        const nodeIdToEntityKey = new Map<string, string>();
        const nodeIds: string[] = [];
        for (const gn of graphNodes) {
          nodeIdToEntityKey.set(gn.id, `${gn.entity_type}:${gn.entity_id}`);
          nodeIds.push(gn.id);
        }

        const { data: edges } = await supabase
          .from("graph_edges")
          .select("source_node_id, target_node_id")
          .eq("relation_type", "same_person")
          .is("valid_until", null)
          .in("source_node_id", nodeIds)
          .in("target_node_id", nodeIds);

        if (edges && edges.length > 0) {
          // Union-Find
          const parent = new Map<number, number>();
          function find(x: number): number {
            if (!parent.has(x)) parent.set(x, x);
            let p = parent.get(x)!;
            while (p !== parent.get(p)!) p = parent.get(p)!;
            parent.set(x, p);
            return p;
          }
          function union(a: number, b: number) {
            const ra = find(a), rb = find(b);
            if (ra !== rb) parent.set(rb, ra);
          }

          for (const edge of edges) {
            const keyA = nodeIdToEntityKey.get(edge.source_node_id);
            const keyB = nodeIdToEntityKey.get(edge.target_node_id);
            if (!keyA || !keyB) continue;
            const idxA = entityKeyToIdx.get(keyA);
            const idxB = entityKeyToIdx.get(keyB);
            if (idxA == null || idxB == null) continue;
            union(idxA, idxB);
          }

          const groups = new Map<number, number[]>();
          for (let i = 0; i < out.length; i++) {
            const root = find(i);
            const group = groups.get(root);
            if (group) group.push(i);
            else groups.set(root, [i]);
          }

          const mergedRows: ExplorerRow[] = [];
          const PRIORITY: Record<string, number> = { hubspot: 0, shopify: 1, klaviyo: 2 };

          for (const [, indices] of groups) {
            if (indices.length === 1) {
              mergedRows.push(out[indices[0]]);
              continue;
            }

            indices.sort((a, b) => {
              const pa = PRIORITY[out[a]._source as string] ?? 9;
              const pb = PRIORITY[out[b]._source as string] ?? 9;
              return pa - pb;
            });

            const primary = { ...out[indices[0]] };
            const allSources = new Set<string>();
            for (const idx of indices) {
              allSources.add(out[idx]._source as string);
              const r = out[idx];
              if (!primary.email && r.email) primary.email = r.email;
              if (!primary.name || primary.name === "Unknown") {
                if (r.name && r.name !== "Unknown") primary.name = r.name;
              }
              if (!primary.company_name && r.company_name) primary.company_name = r.company_name;
              if (!primary.title && r.title) primary.title = r.title;
              if (!primary.phone_number && r.phone_number) primary.phone_number = r.phone_number;
              if (!primary.city && r.city) primary.city = r.city;
              if (primary.orders_count == null && r.orders_count != null) primary.orders_count = r.orders_count;
              if (primary.total_spent == null && r.total_spent != null) primary.total_spent = r.total_spent;
              if (primary.avg_order_value == null && r.avg_order_value != null) primary.avg_order_value = r.avg_order_value;
              if (!primary.last_order_at && r.last_order_at) primary.last_order_at = r.last_order_at;
              if (!primary.status && r.status) primary.status = r.status;
            }

            const sourcesArr = [...allSources];
            primary._sources = sourcesArr;
            primary._source = sourcesArr.length > 1 ? "both" : sourcesArr[0];
            mergedRows.push(primary);
          }

          merged = mergedRows;
        }
      }
    } catch (err) {
      console.error("[Explorer] Graph-based merge failed (showing unmerged):", err);
    }

    // ── Apply source filter AFTER merging ──
    // "all" shows everything. A specific source shows unified records
    // that include that source (e.g. "klaviyo" shows records where
    // _sources contains "klaviyo", including merged multi-source records).
    if (source !== "all") {
      merged = merged.filter((r) => {
        const sources = (r._sources as string[]) || [r._source as string];
        return sources.includes(source);
      });
    }

    return merged;
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
        const sources = rows.map((r) => (r._sources as string[]) || [r._source as string]);
        const fromHub = sources.filter((s) => s.includes("hubspot")).length;
        const fromShop = sources.filter((s) => s.includes("shopify")).length;
        const fromKlaviyo = sources.filter((s) => s.includes("klaviyo")).length;
        const linked = rows.filter((r) => {
          const s = (r._sources as string[]) || [];
          return s.length > 1;
        }).length;
        const metrics: MetricDef[] = [
          { label: "Total People", value: formatNumber(total) },
        ];
        if (fromHub > 0) metrics.push({ label: "HubSpot", value: formatNumber(fromHub) });
        if (fromShop > 0) metrics.push({ label: "Shopify", value: formatNumber(fromShop) });
        if (fromKlaviyo > 0) metrics.push({ label: "Klaviyo", value: formatNumber(fromKlaviyo) });
        if (linked > 0) metrics.push({ label: "Identity Linked", value: formatNumber(linked) });
        return metrics;
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

  /* ── Should we show the resolve panel? ─────────────── */
  // Note: Do NOT include `!loading` here — the panel must stay mounted
  // during data reloads so its local state (applied / review) persists.
  const showResolvePanel = entityType === "customers" && sourceFilter === "all";
  const multiSourceCount = useMemo(() => {
    const sourcesWithData = new Set<string>();
    for (const r of rows) {
      const s = (r._sources as string[]) || [r._source as string];
      s.forEach((src) => sourcesWithData.add(src));
    }
    return sourcesWithData.size;
  }, [rows]);

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

      {/* ── Identity Resolution Panel ────────────── */}
      {showResolvePanel && multiSourceCount >= 2 && (
        <IdentityResolutionPanel
          multiSourceCount={multiSourceCount}
          onResolutionComplete={loadData}
        />
      )}

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
