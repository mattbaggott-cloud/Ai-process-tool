"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge, formatCurrency } from "./shared";
import type {
  CrmReport,
  ReportEntityType,
  ReportFilter,
  ReportSortConfig,
  FilterOperator,
  CrmCustomField,
  CustomFieldType,
} from "@/lib/types/database";

/* ── Field Definition Registry ──────────────────────────── */

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "select" | "currency";
  options?: string[];
  isJoin?: boolean;
  isComputed?: boolean;
  defaultVisible?: boolean;
}

const ENTITY_FIELDS: Record<ReportEntityType, FieldDef[]> = {
  contacts: [
    { key: "first_name", label: "First Name", type: "text", defaultVisible: true },
    { key: "last_name", label: "Last Name", type: "text", defaultVisible: true },
    { key: "email", label: "Email", type: "text", defaultVisible: true },
    { key: "phone", label: "Phone", type: "text" },
    { key: "title", label: "Job Title", type: "text" },
    { key: "status", label: "Status", type: "select", options: ["lead", "active", "inactive", "churned"], defaultVisible: true },
    { key: "source", label: "Source", type: "select", options: ["manual", "import", "ai", "referral"] },
    { key: "company_name", label: "Company", type: "text", isJoin: true, defaultVisible: true },
    { key: "tags", label: "Tags", type: "text" },
    { key: "created_at", label: "Created", type: "date" },
    { key: "updated_at", label: "Updated", type: "date" },
  ],
  companies: [
    { key: "name", label: "Name", type: "text", defaultVisible: true },
    { key: "domain", label: "Domain", type: "text" },
    { key: "industry", label: "Industry", type: "text", defaultVisible: true },
    { key: "size", label: "Size", type: "select", options: ["startup", "small", "medium", "large", "enterprise"], defaultVisible: true },
    { key: "website", label: "Website", type: "text" },
    { key: "phone", label: "Phone", type: "text" },
    { key: "address", label: "Address", type: "text" },
    { key: "annual_revenue", label: "Annual Revenue", type: "currency" },
    { key: "employees", label: "Employees", type: "number" },
    { key: "sector", label: "Sector", type: "text" },
    { key: "account_owner", label: "Account Owner", type: "text" },
    { key: "contact_count", label: "Contacts", type: "number", isComputed: true },
    { key: "deal_count", label: "Deals", type: "number", isComputed: true },
    { key: "created_at", label: "Created", type: "date" },
    { key: "updated_at", label: "Updated", type: "date" },
  ],
  deals: [
    { key: "title", label: "Title", type: "text", defaultVisible: true },
    { key: "value", label: "Value", type: "currency", defaultVisible: true },
    { key: "stage", label: "Stage", type: "select", options: ["lead", "qualified", "proposal", "negotiation", "won", "lost"], defaultVisible: true },
    { key: "probability", label: "Probability", type: "number" },
    { key: "expected_close_date", label: "Expected Close", type: "date", defaultVisible: true },
    { key: "contact_name", label: "Contact", type: "text", isJoin: true },
    { key: "company_name", label: "Company", type: "text", isJoin: true },
    { key: "close_reason", label: "Close Reason", type: "text" },
    { key: "lost_to", label: "Lost To", type: "text" },
    { key: "closed_at", label: "Closed At", type: "date" },
    { key: "created_at", label: "Created", type: "date" },
    { key: "updated_at", label: "Updated", type: "date" },
  ],
  activities: [
    { key: "type", label: "Type", type: "select", options: ["call", "email", "meeting", "note", "task"], defaultVisible: true },
    { key: "subject", label: "Subject", type: "text", defaultVisible: true },
    { key: "description", label: "Description", type: "text" },
    { key: "contact_name", label: "Contact", type: "text", isJoin: true, defaultVisible: true },
    { key: "company_name", label: "Company", type: "text", isJoin: true },
    { key: "scheduled_at", label: "Scheduled", type: "date" },
    { key: "completed_at", label: "Completed", type: "date" },
    { key: "created_at", label: "Created", type: "date", defaultVisible: true },
  ],
};

/* ── Operators per field type ───────────────────────────── */

const OPERATORS_BY_TYPE: Record<string, { value: FilterOperator; label: string }[]> = {
  text: [
    { value: "contains", label: "contains" },
    { value: "equals", label: "equals" },
    { value: "not_equals", label: "does not equal" },
    { value: "starts_with", label: "starts with" },
    { value: "is_empty", label: "is empty" },
    { value: "is_not_empty", label: "is not empty" },
  ],
  number: [
    { value: "equals", label: "=" },
    { value: "not_equals", label: "≠" },
    { value: "gt", label: ">" },
    { value: "gte", label: "≥" },
    { value: "lt", label: "<" },
    { value: "lte", label: "≤" },
    { value: "is_empty", label: "is empty" },
  ],
  currency: [
    { value: "equals", label: "=" },
    { value: "gt", label: ">" },
    { value: "gte", label: "≥" },
    { value: "lt", label: "<" },
    { value: "lte", label: "≤" },
  ],
  date: [
    { value: "before", label: "before" },
    { value: "after", label: "after" },
    { value: "equals", label: "on" },
    { value: "is_empty", label: "is empty" },
    { value: "is_not_empty", label: "is not empty" },
  ],
  boolean: [
    { value: "is_true", label: "is true" },
    { value: "is_false", label: "is false" },
  ],
  select: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
  ],
};

const NO_VALUE_OPERATORS: FilterOperator[] = ["is_empty", "is_not_empty", "is_true", "is_false"];

/* ── Component ──────────────────────────────────────────── */

type ReportView = "list" | "builder" | "viewer";

export default function ReportsTab() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const router = useRouter();
  const supabase = createClient();

  // View state
  const [view, setView] = useState<ReportView>("list");

  // Report list state
  const [reports, setReports] = useState<CrmReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchReports, setSearchReports] = useState("");

  // Builder state
  const [editingReport, setEditingReport] = useState<CrmReport | null>(null);
  const [builderEntityType, setBuilderEntityType] = useState<ReportEntityType>("contacts");
  const [builderName, setBuilderName] = useState("");
  const [builderDescription, setBuilderDescription] = useState("");
  const [builderColumns, setBuilderColumns] = useState<string[]>([]);
  const [builderFilters, setBuilderFilters] = useState<ReportFilter[]>([]);
  const [builderSort, setBuilderSort] = useState<ReportSortConfig>({ field: "created_at", direction: "desc" });
  const [saving, setSaving] = useState(false);

  // Viewer state
  const [activeReport, setActiveReport] = useState<CrmReport | null>(null);
  const [reportData, setReportData] = useState<Record<string, unknown>[]>([]);
  const [reportLoading, setReportLoading] = useState(false);

  // Clay-style viewer state
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [viewerSort, setViewerSort] = useState<{ field: string; direction: "asc" | "desc" }>({ field: "", direction: "asc" });

  // Custom fields
  const [customFields, setCustomFields] = useState<CrmCustomField[]>([]);

  /* ── Load reports ─────────────────────────────────────── */

  const loadReports = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("crm_reports")
      .select("*")
      .order("updated_at", { ascending: false });
    // Normalize JSONB fields that may come as strings
    const parsed = (data || []).map((r: Record<string, unknown>) => ({
      ...r,
      columns: typeof r.columns === "string" ? JSON.parse(r.columns as string) : r.columns ?? [],
      filters: typeof r.filters === "string" ? JSON.parse(r.filters as string) : r.filters ?? [],
      sort_config: typeof r.sort_config === "string"
        ? JSON.parse(r.sort_config as string)
        : r.sort_config ?? { field: "created_at", direction: "desc" },
    })) as CrmReport[];
    setReports(parsed);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    const handler = () => loadReports();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadReports]);

  /* ── Expose active report to AI chat ───────────────────── */
  useEffect(() => {
    if (view === "viewer" && activeReport) {
      (window as unknown as Record<string, unknown>).__activeReport = {
        id: activeReport.id,
        name: activeReport.name,
        entity_type: activeReport.entity_type,
        columns: activeReport.columns,
        filters: activeReport.filters,
        sort_config: activeReport.sort_config,
        resultCount: reportData.length,
      };
    } else {
      (window as unknown as Record<string, unknown>).__activeReport = null;
    }
    return () => {
      (window as unknown as Record<string, unknown>).__activeReport = null;
    };
  }, [view, activeReport, reportData.length]);

  /* ── Load custom fields for entity type ───────────────── */

  const loadCustomFields = useCallback(async (entityType: ReportEntityType) => {
    if (!user) return;
    const tableName = `crm_${entityType}`;
    const { data } = await supabase
      .from("crm_custom_fields")
      .select("*")
      .eq("table_name", tableName)
      .order("sort_order", { ascending: true });
    setCustomFields((data as CrmCustomField[]) || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* ── Helpers ──────────────────────────────────────────── */

  const getFieldType = (fieldKey: string, entityType: ReportEntityType): string => {
    if (fieldKey.startsWith("cf:")) {
      const cfKey = fieldKey.replace("cf:", "");
      const cf = customFields.find((f) => f.field_key === cfKey);
      return cf?.field_type || "text";
    }
    const field = ENTITY_FIELDS[entityType]?.find((f) => f.key === fieldKey);
    return field?.type || "text";
  };

  const getOperatorsForField = (fieldKey: string): { value: FilterOperator; label: string }[] => {
    const type = getFieldType(fieldKey, builderEntityType);
    return OPERATORS_BY_TYPE[type] || OPERATORS_BY_TYPE.text;
  };

  const getFieldOptions = (fieldKey: string): string[] => {
    if (fieldKey.startsWith("cf:")) {
      const cfKey = fieldKey.replace("cf:", "");
      const cf = customFields.find((f) => f.field_key === cfKey);
      return cf?.options || [];
    }
    const field = ENTITY_FIELDS[builderEntityType]?.find((f) => f.key === fieldKey);
    return field?.options || [];
  };

  const getColumnLabel = (colKey: string, entityType: ReportEntityType): string => {
    if (colKey.startsWith("cf:")) {
      const cfKey = colKey.replace("cf:", "");
      const cf = customFields.find((f) => f.field_key === cfKey);
      return cf?.field_label || cfKey;
    }
    const field = ENTITY_FIELDS[entityType]?.find((f) => f.key === colKey);
    return field?.label || colKey;
  };

  /* ── Builder actions ──────────────────────────────────── */

  const handleCreateReport = () => {
    setEditingReport(null);
    setBuilderEntityType("contacts");
    setBuilderName("");
    setBuilderDescription("");
    const defaults = ENTITY_FIELDS["contacts"].filter((f) => f.defaultVisible).map((f) => f.key);
    setBuilderColumns(defaults);
    setBuilderFilters([]);
    setBuilderSort({ field: "created_at", direction: "desc" });
    loadCustomFields("contacts");
    setView("builder");
  };

  const handleEditReport = (report: CrmReport) => {
    setEditingReport(report);
    setBuilderEntityType(report.entity_type);
    setBuilderName(report.name);
    setBuilderDescription(report.description);
    setBuilderColumns([...report.columns]);
    setBuilderFilters(report.filters.map((f) => ({ ...f })));
    const sc = typeof report.sort_config === "string"
      ? JSON.parse(report.sort_config) as { field: string; direction: "asc" | "desc" }
      : report.sort_config ?? { field: "created_at", direction: "desc" as const };
    setBuilderSort({ field: sc.field || "created_at", direction: sc.direction || "desc" });
    loadCustomFields(report.entity_type);
    setView("builder");
  };

  const handleEntityTypeChange = (et: ReportEntityType) => {
    setBuilderEntityType(et);
    const defaults = ENTITY_FIELDS[et].filter((f) => f.defaultVisible).map((f) => f.key);
    setBuilderColumns(defaults);
    setBuilderFilters([]);
    setBuilderSort({ field: "created_at", direction: "desc" });
    loadCustomFields(et);
  };

  const toggleColumn = (key: string) => {
    setBuilderColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const addFilter = () => {
    setBuilderFilters((prev) => [...prev, { field: "", operator: "contains" as FilterOperator, value: "" }]);
  };

  const updateFilter = (idx: number, key: keyof ReportFilter, value: string) => {
    setBuilderFilters((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [key]: value };
      if (key === "field") {
        const fType = getFieldType(value, builderEntityType);
        const ops = OPERATORS_BY_TYPE[fType] || OPERATORS_BY_TYPE.text;
        updated[idx].operator = ops[0].value;
        updated[idx].value = "";
      }
      return updated;
    });
  };

  const removeFilter = (idx: number) => {
    setBuilderFilters((prev) => prev.filter((_, i) => i !== idx));
  };

  /* ── Save report ──────────────────────────────────────── */

  const handleSaveReport = async () => {
    if (!user || !builderName.trim() || builderColumns.length === 0) return;
    setSaving(true);

    const validFilters = builderFilters.filter(
      (f) =>
        f.field &&
        f.operator &&
        (NO_VALUE_OPERATORS.includes(f.operator) || f.value)
    );

    const reportPayload = {
      name: builderName.trim(),
      description: builderDescription.trim(),
      entity_type: builderEntityType,
      columns: builderColumns,
      filters: validFilters,
      sort_config: builderSort,
      updated_at: new Date().toISOString(),
    };

    if (editingReport) {
      const { error } = await supabase
        .from("crm_reports")
        .update(reportPayload)
        .eq("id", editingReport.id);
      if (!error) {
        await loadReports();
        const updated = { ...editingReport, ...reportPayload } as CrmReport;
        setActiveReport(updated);
        executeReport(updated);
        setView("viewer");
      }
    } else {
      const { data, error } = await supabase
        .from("crm_reports")
        .insert({ ...reportPayload, user_id: user.id, org_id: orgId })
        .select()
        .single();
      if (!error && data) {
        await loadReports();
        const created = data as CrmReport;
        setActiveReport(created);
        executeReport(created);
        setView("viewer");
      }
    }
    setSaving(false);
  };

  /* ── Delete report ────────────────────────────────────── */

  const handleDeleteReport = async (id: string) => {
    await supabase.from("crm_reports").delete().eq("id", id);
    loadReports();
  };

  /* ── Open / Execute report ────────────────────────────── */

  const openReport = (report: CrmReport) => {
    setActiveReport(report);
    loadCustomFields(report.entity_type);
    executeReport(report);
    setView("viewer");
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const applySupabaseFilter = (query: any, filter: ReportFilter) => {
    const { field, operator, value } = filter;
    switch (operator) {
      case "equals": case "is": return query.eq(field, value);
      case "not_equals": case "is_not": return query.neq(field, value);
      case "contains": return query.ilike(field, `%${value}%`);
      case "starts_with": return query.ilike(field, `${value}%`);
      case "gt": return query.gt(field, value);
      case "gte": return query.gte(field, value);
      case "lt": return query.lt(field, value);
      case "lte": return query.lte(field, value);
      case "before": return query.lt(field, value);
      case "after": return query.gt(field, value);
      case "is_empty": return query.is(field, null);
      case "is_not_empty": return query.not(field, "is", null);
      case "is_true": return query.eq(field, true);
      case "is_false": return query.eq(field, false);
      default: return query;
    }
  };

  const evaluateFilter = (value: unknown, filter: ReportFilter): boolean => {
    const strVal = String(value ?? "").toLowerCase();
    const filterVal = filter.value.toLowerCase();
    switch (filter.operator) {
      case "contains": return strVal.includes(filterVal);
      case "equals": case "is": return strVal === filterVal;
      case "not_equals": case "is_not": return strVal !== filterVal;
      case "starts_with": return strVal.startsWith(filterVal);
      case "gt": return Number(value) > Number(filter.value);
      case "gte": return Number(value) >= Number(filter.value);
      case "lt": return Number(value) < Number(filter.value);
      case "lte": return Number(value) <= Number(filter.value);
      case "before": return String(value) < filter.value;
      case "after": return String(value) > filter.value;
      case "is_empty": return !value || strVal === "";
      case "is_not_empty": return !!value && strVal !== "";
      case "is_true": return value === true || strVal === "true";
      case "is_false": return !value || value === false || strVal === "false";
      default: return true;
    }
  };

  const isClientSideFilter = (filter: ReportFilter): boolean => {
    return (
      filter.field.startsWith("cf:") ||
      filter.field.endsWith("_name") ||
      filter.field.endsWith("_count")
    );
  };

  const fetchJoinData = async (
    entityType: ReportEntityType,
    primaryData: any[]
  ): Promise<Record<string, Record<string, string>>> => {
    const joinData: Record<string, Record<string, string>> = {};

    if (entityType === "contacts") {
      const companyIds = [...new Set(primaryData.map((r) => r.company_id).filter(Boolean))];
      if (companyIds.length > 0) {
        const { data } = await supabase.from("crm_companies").select("id, name").in("id", companyIds);
        if (data) {
          joinData.company = {};
          for (const c of data) joinData.company[c.id] = c.name;
        }
      }
    }

    if (entityType === "deals") {
      const contactIds = [...new Set(primaryData.map((r) => r.contact_id).filter(Boolean))];
      const companyIds = [...new Set(primaryData.map((r) => r.company_id).filter(Boolean))];
      const [contactsRes, companiesRes] = await Promise.all([
        contactIds.length > 0
          ? supabase.from("crm_contacts").select("id, first_name, last_name").in("id", contactIds)
          : Promise.resolve({ data: [] }),
        companyIds.length > 0
          ? supabase.from("crm_companies").select("id, name").in("id", companyIds)
          : Promise.resolve({ data: [] }),
      ]);
      joinData.contact = {};
      joinData.company = {};
      if (contactsRes.data) for (const c of contactsRes.data) joinData.contact[c.id] = `${c.first_name} ${c.last_name}`.trim();
      if (companiesRes.data) for (const c of companiesRes.data) joinData.company[c.id] = c.name;
    }

    if (entityType === "activities") {
      const contactIds = [...new Set(primaryData.map((r) => r.contact_id).filter(Boolean))];
      const companyIds = [...new Set(primaryData.map((r) => r.company_id).filter(Boolean))];
      const [contactsRes, companiesRes] = await Promise.all([
        contactIds.length > 0
          ? supabase.from("crm_contacts").select("id, first_name, last_name").in("id", contactIds)
          : Promise.resolve({ data: [] }),
        companyIds.length > 0
          ? supabase.from("crm_companies").select("id, name").in("id", companyIds)
          : Promise.resolve({ data: [] }),
      ]);
      joinData.contact = {};
      joinData.company = {};
      if (contactsRes.data) for (const c of contactsRes.data) joinData.contact[c.id] = `${c.first_name} ${c.last_name}`.trim();
      if (companiesRes.data) for (const c of companiesRes.data) joinData.company[c.id] = c.name;
    }

    if (entityType === "companies") {
      const companyIds = primaryData.map((r) => r.id);
      if (companyIds.length > 0) {
        const [contactsRes, dealsRes] = await Promise.all([
          supabase.from("crm_contacts").select("id, company_id").in("company_id", companyIds),
          supabase.from("crm_deals").select("id, company_id").in("company_id", companyIds),
        ]);
        joinData._contact_counts = {};
        joinData._deal_counts = {};
        if (contactsRes.data) {
          for (const c of contactsRes.data) {
            const cid = c.company_id as string;
            joinData._contact_counts[cid] = String((parseInt(joinData._contact_counts[cid] || "0") + 1));
          }
        }
        if (dealsRes.data) {
          for (const d of dealsRes.data) {
            const cid = d.company_id as string;
            joinData._deal_counts[cid] = String((parseInt(joinData._deal_counts[cid] || "0") + 1));
          }
        }
      }
    }

    return joinData;
  };

  const enrichRows = (
    entityType: ReportEntityType,
    primaryData: any[],
    joinData: Record<string, Record<string, string>>
  ): Record<string, unknown>[] => {
    return primaryData.map((row) => {
      const enriched: Record<string, unknown> = { ...row };

      if (entityType === "contacts") {
        enriched.company_name = row.company_id ? joinData.company?.[row.company_id] || "" : "";
      }
      if (entityType === "deals") {
        enriched.contact_name = row.contact_id ? joinData.contact?.[row.contact_id] || "" : "";
        enriched.company_name = row.company_id ? joinData.company?.[row.company_id] || "" : "";
      }
      if (entityType === "activities") {
        enriched.contact_name = row.contact_id ? joinData.contact?.[row.contact_id] || "" : "";
        enriched.company_name = row.company_id ? joinData.company?.[row.company_id] || "" : "";
      }
      if (entityType === "companies") {
        enriched.contact_count = parseInt(joinData._contact_counts?.[row.id] || "0");
        enriched.deal_count = parseInt(joinData._deal_counts?.[row.id] || "0");
      }

      // Extract custom field values from metadata
      const metadata = (row.metadata as Record<string, unknown>) || {};
      for (const [key, val] of Object.entries(metadata)) {
        enriched[`cf:${key}`] = val;
      }

      return enriched;
    });
  };

  const executeReport = async (report: CrmReport) => {
    if (!user) return;
    setReportLoading(true);

    const tableName = `crm_${report.entity_type}`;

    // Safely parse sort_config (may be string from DB or have missing field)
    const sortConfig = typeof report.sort_config === "string"
      ? JSON.parse(report.sort_config) as { field: string; direction: "asc" | "desc" }
      : report.sort_config ?? { field: "created_at", direction: "desc" as const };
    const sortConfigField = sortConfig.field || "created_at";
    const sortConfigDirection = sortConfig.direction || "desc";

    // Build query
    const sortField = sortConfigField.startsWith("cf:") ? "created_at" : sortConfigField;
    const isJoinSort = sortConfigField.endsWith("_name") || sortConfigField.endsWith("_count");
    let query = supabase
      .from(tableName)
      .select("*")
      .order(isJoinSort ? "created_at" : sortField, { ascending: sortConfigDirection === "asc" });

    // Apply Supabase-native filters for standard fields
    for (const filter of report.filters) {
      if (!isClientSideFilter(filter)) {
        query = applySupabaseFilter(query, filter);
      }
    }

    const { data: primaryData } = await query;
    if (!primaryData) {
      setReportData([]);
      setReportLoading(false);
      return;
    }

    // Fetch join data
    const joinData = await fetchJoinData(report.entity_type, primaryData);

    // Enrich rows
    let rows = enrichRows(report.entity_type, primaryData, joinData);

    // Apply client-side filters
    const clientFilters = report.filters.filter(isClientSideFilter);
    if (clientFilters.length > 0) {
      rows = rows.filter((row) =>
        clientFilters.every((filter) => evaluateFilter(row[filter.field], filter))
      );
    }

    // Sort by custom/join field if needed
    if (sortConfigField.startsWith("cf:") || isJoinSort) {
      const sf = sortConfigField;
      rows.sort((a, b) => {
        const va = String(a[sf] ?? "");
        const vb = String(b[sf] ?? "");
        return sortConfigDirection === "asc"
          ? va.localeCompare(vb)
          : vb.localeCompare(va);
      });
    }

    setReportData(rows);
    setSelectedRows(new Set());
    setViewerSort({ field: "", direction: "asc" });
    setReportLoading(false);
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /* ── Cell formatting ──────────────────────────────────── */

  const formatCellValue = (
    colKey: string,
    value: unknown,
    row: Record<string, unknown>,
    entityType: ReportEntityType
  ): React.ReactNode => {
    if (value === null || value === undefined || value === "") return "\u2014";

    const field = ENTITY_FIELDS[entityType]?.find((f) => f.key === colKey);
    const fieldType = field?.type || (colKey.startsWith("cf:") ? getFieldType(colKey, entityType) : "text");

    switch (fieldType) {
      case "date":
        try {
          return new Date(String(value)).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
        } catch {
          return String(value);
        }

      case "currency":
        return formatCurrency(Number(value), String(row.currency || "USD"));

      case "number":
        return typeof value === "number" ? value.toLocaleString() : String(value);

      case "boolean":
        return value === true || value === "true" ? "Yes" : "No";

      case "select":
        if (colKey === "status" || colKey === "stage") {
          return <StatusBadge status={String(value)} />;
        }
        return String(value);

      default:
        if (Array.isArray(value)) return value.join(", ");
        return String(value);
    }
  };

  const navigateToEntity = (entityType: ReportEntityType, id: string) => {
    const pathMap: Record<ReportEntityType, string> = {
      contacts: `/crm/contacts/${id}`,
      companies: `/crm/companies/${id}`,
      deals: `/crm/deals/${id}`,
      activities: "",
    };
    const path = pathMap[entityType];
    if (path) router.push(path);
  };

  /* ── Filter value input renderer ──────────────────────── */

  const renderFilterValueInput = (filter: ReportFilter, idx: number) => {
    if (NO_VALUE_OPERATORS.includes(filter.operator)) return null;

    const fieldType = getFieldType(filter.field, builderEntityType);

    if (fieldType === "select") {
      const options = getFieldOptions(filter.field);
      return (
        <select
          className="crm-input"
          value={filter.value}
          onChange={(e) => updateFilter(idx, "value", e.target.value)}
        >
          <option value="">Select...</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    }

    if (fieldType === "date") {
      return (
        <input
          className="crm-input"
          type="date"
          value={filter.value}
          onChange={(e) => updateFilter(idx, "value", e.target.value)}
        />
      );
    }

    if (fieldType === "number" || fieldType === "currency") {
      return (
        <input
          className="crm-input"
          type="number"
          placeholder="Value..."
          value={filter.value}
          onChange={(e) => updateFilter(idx, "value", e.target.value)}
        />
      );
    }

    return (
      <input
        className="crm-input"
        type="text"
        placeholder="Value..."
        value={filter.value}
        onChange={(e) => updateFilter(idx, "value", e.target.value)}
      />
    );
  };

  /* ── Clay table handlers ────────────────────────────────── */

  const handleToggleRow = (id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedRows.size === reportData.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(reportData.map((r) => String(r.id))));
    }
  };

  const handleColumnSort = (colKey: string) => {
    setViewerSort((prev) => {
      if (prev.field === colKey) {
        return { field: colKey, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field: colKey, direction: "asc" };
    });
  };

  const sortedData = useMemo(() => {
    if (!viewerSort.field) return reportData;

    const sf = viewerSort.field;
    const entityType = activeReport?.entity_type || "contacts";
    const field = ENTITY_FIELDS[entityType]?.find((f) => f.key === sf);
    const fieldType = field?.type || (sf.startsWith("cf:") ? getFieldType(sf, entityType) : "text");

    return [...reportData].sort((a, b) => {
      const va = a[sf];
      const vb = b[sf];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;

      let cmp = 0;
      if (fieldType === "number" || fieldType === "currency") {
        cmp = Number(va) - Number(vb);
      } else if (fieldType === "date") {
        cmp = new Date(String(va)).getTime() - new Date(String(vb)).getTime();
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      return viewerSort.direction === "asc" ? cmp : -cmp;
    });
  }, [reportData, viewerSort, activeReport?.entity_type]);

  /* ── Filtered reports for list ────────────────────────── */

  const filteredReports = reports.filter((r) =>
    !searchReports || r.name.toLowerCase().includes(searchReports.toLowerCase())
  );

  /* ── All fields for builder (standard + custom) ───────── */

  const allFields: FieldDef[] = [
    ...ENTITY_FIELDS[builderEntityType],
    ...customFields.map((cf): FieldDef => ({
      key: `cf:${cf.field_key}`,
      label: cf.field_label,
      type: cf.field_type as FieldDef["type"],
    })),
  ];

  /* ── RENDER ───────────────────────────────────────────── */

  if (loading && view === "list") {
    return <div className="crm-loading">Loading reports...</div>;
  }

  /* ── List View ────────────────────────────────────────── */

  if (view === "list") {
    return (
      <div className="crm-tab-content">
        <div className="crm-toolbar">
          <input
            className="crm-search-input"
            placeholder="Search reports..."
            value={searchReports}
            onChange={(e) => setSearchReports(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" onClick={handleCreateReport}>
            + Report
          </button>
        </div>

        {filteredReports.length === 0 ? (
          <div className="crm-empty">
            {reports.length === 0
              ? "No reports yet. Create your first report to view filtered CRM data."
              : "No reports match your search."}
          </div>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Columns</th>
                  <th>Filters</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredReports.map((report) => (
                  <tr
                    key={report.id}
                    className="crm-table-row crm-clickable"
                    onClick={() => openReport(report)}
                  >
                    <td className="crm-cell-name">
                      {report.name}
                      {report.description && (
                        <span className="crm-report-row-desc">{report.description}</span>
                      )}
                    </td>
                    <td>
                      <span className="crm-report-entity-badge">{report.entity_type}</span>
                    </td>
                    <td>{report.columns.length}</td>
                    <td>{report.filters.length}</td>
                    <td className="crm-cell-date">
                      {new Date(report.updated_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td>
                      <button
                        className="crm-action-btn crm-action-delete"
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteReport(report.id);
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ── Builder View ─────────────────────────────────────── */

  const ENTITY_ICONS: Record<ReportEntityType, string> = {
    contacts: "👤",
    companies: "🏢",
    deals: "💰",
    activities: "📋",
  };

  if (view === "builder") {
    return (
      <div className="crm-tab-content">
        <div className="crm-toolbar">
          <button className="btn btn-sm" onClick={() => setView(editingReport ? "viewer" : "list")}>
            ← Back
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => setView(editingReport ? "viewer" : "list")}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSaveReport}
            disabled={!builderName.trim() || builderColumns.length === 0 || saving}
          >
            {saving ? "Saving..." : editingReport ? "Update Report" : "Save Report"}
          </button>
        </div>

        <div className="crm-report-builder">
          {/* Top: Name + Entity Type in one row */}
          <div className="crm-builder-top">
            <div className="crm-builder-name-wrap">
              <input
                className="crm-builder-name-input"
                placeholder="Report name..."
                value={builderName}
                onChange={(e) => setBuilderName(e.target.value)}
                autoFocus
              />
              <input
                className="crm-builder-desc-input"
                placeholder="Add a description (optional)"
                value={builderDescription}
                onChange={(e) => setBuilderDescription(e.target.value)}
              />
            </div>
            {!editingReport && (
              <div className="crm-builder-entity-grid">
                {(["contacts", "companies", "deals", "activities"] as const).map((et) => (
                  <button
                    key={et}
                    className={`crm-builder-entity-btn ${builderEntityType === et ? "crm-builder-entity-active" : ""}`}
                    onClick={() => handleEntityTypeChange(et)}
                  >
                    <span className="crm-builder-entity-icon">{ENTITY_ICONS[et]}</span>
                    {et.charAt(0).toUpperCase() + et.slice(1)}
                  </button>
                ))}
              </div>
            )}
            {editingReport && (
              <div className="crm-builder-entity-locked">
                <span className="crm-builder-entity-icon">{ENTITY_ICONS[builderEntityType]}</span>
                {builderEntityType.charAt(0).toUpperCase() + builderEntityType.slice(1)}
              </div>
            )}
          </div>

          {/* Two-column layout: Columns + Filters/Sort */}
          <div className="crm-builder-body">
            {/* Left: Columns */}
            <div className="crm-builder-panel">
              <div className="crm-builder-panel-header">
                <span className="crm-builder-panel-title">Columns</span>
                <span className="crm-builder-panel-count">{builderColumns.length} selected</span>
              </div>
              <div className="crm-builder-columns">
                {ENTITY_FIELDS[builderEntityType].map((f) => (
                  <label key={f.key} className="crm-builder-col-check">
                    <input
                      type="checkbox"
                      checked={builderColumns.includes(f.key)}
                      onChange={() => toggleColumn(f.key)}
                    />
                    <span>{f.label}</span>
                    <span className="crm-builder-col-type">{f.type}</span>
                  </label>
                ))}
                {customFields.length > 0 && (
                  <>
                    <div className="crm-builder-col-divider">Custom Fields</div>
                    {customFields.map((cf) => (
                      <label key={`cf:${cf.field_key}`} className="crm-builder-col-check">
                        <input
                          type="checkbox"
                          checked={builderColumns.includes(`cf:${cf.field_key}`)}
                          onChange={() => toggleColumn(`cf:${cf.field_key}`)}
                        />
                        <span>{cf.field_label}</span>
                        <span className="crm-builder-col-type">{cf.field_type}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* Right: Filters + Sort */}
            <div className="crm-builder-panel">
              <div className="crm-builder-panel-header">
                <span className="crm-builder-panel-title">Filters</span>
                <button className="crm-builder-add-filter" onClick={addFilter}>
                  + Add
                </button>
              </div>
              {builderFilters.length === 0 ? (
                <p className="crm-builder-hint">No filters — all records will be shown.</p>
              ) : (
                <div className="crm-builder-filters">
                  {builderFilters.map((filter, idx) => (
                    <div key={idx} className="crm-builder-filter-card">
                      <select
                        className="crm-builder-filter-select"
                        value={filter.field}
                        onChange={(e) => updateFilter(idx, "field", e.target.value)}
                      >
                        <option value="">Field...</option>
                        <optgroup label="Standard">
                          {ENTITY_FIELDS[builderEntityType]
                            .filter((f) => !f.isComputed)
                            .map((f) => (
                              <option key={f.key} value={f.key}>{f.label}</option>
                            ))}
                        </optgroup>
                        {customFields.length > 0 && (
                          <optgroup label="Custom">
                            {customFields.map((cf) => (
                              <option key={`cf:${cf.field_key}`} value={`cf:${cf.field_key}`}>
                                {cf.field_label}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>

                      <select
                        className="crm-builder-filter-select"
                        value={filter.operator}
                        onChange={(e) => updateFilter(idx, "operator", e.target.value as FilterOperator)}
                        disabled={!filter.field}
                      >
                        {getOperatorsForField(filter.field).map((op) => (
                          <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                      </select>

                      {renderFilterValueInput(filter, idx)}

                      <button
                        className="crm-builder-filter-remove"
                        onClick={() => removeFilter(idx)}
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Sort */}
              <div className="crm-builder-panel-header" style={{ marginTop: 16 }}>
                <span className="crm-builder-panel-title">Sort</span>
              </div>
              <div className="crm-builder-sort-row">
                <select
                  className="crm-builder-filter-select"
                  value={builderSort.field}
                  onChange={(e) => setBuilderSort({ ...builderSort, field: e.target.value })}
                >
                  {allFields
                    .filter((f) => !f.isComputed)
                    .map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                </select>
                <select
                  className="crm-builder-filter-select"
                  value={builderSort.direction}
                  onChange={(e) => setBuilderSort({ ...builderSort, direction: e.target.value as "asc" | "desc" })}
                >
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Viewer View ──────────────────────────────────────── */

  if (view === "viewer" && activeReport) {
    return (
      <div className="crm-tab-content">
        <div className="crm-toolbar">
          <button className="btn btn-sm" onClick={() => setView("list")}>
            ← Reports
          </button>
          <h2 className="crm-report-viewer-title">{activeReport.name}</h2>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => handleEditReport(activeReport)}>
            Edit
          </button>
        </div>

        {activeReport.description && (
          <p className="crm-report-description">{activeReport.description}</p>
        )}

        <div className="crm-report-meta-bar">
          <span className="crm-report-meta-item">
            {activeReport.entity_type.charAt(0).toUpperCase() + activeReport.entity_type.slice(1)}
          </span>
          <span className="crm-report-meta-item">
            {reportData.length} result{reportData.length !== 1 ? "s" : ""}
          </span>
          {activeReport.filters.length > 0 && (
            <span className="crm-report-meta-item">
              {activeReport.filters.length} filter{activeReport.filters.length !== 1 ? "s" : ""}
            </span>
          )}
          {selectedRows.size > 0 && (
            <span className="crm-report-meta-item" style={{ background: "#eff6ff", color: "#1d4ed8" }}>
              {selectedRows.size} selected
            </span>
          )}
        </div>

        {reportLoading ? (
          <div className="crm-loading">Running report...</div>
        ) : reportData.length === 0 ? (
          <div className="clay-sheet-container">
            <div className="clay-sheet-empty">No records match this report&apos;s filters.</div>
          </div>
        ) : (
          <div className="clay-sheet-container">
            <div className="clay-sheet">
              <table className="clay-grid">
                <thead>
                  <tr className="clay-header-row">
                    {/* Checkbox header */}
                    <th className="clay-hdr clay-hdr-checkbox">
                      <div className="clay-hdr-content">
                        <input
                          type="checkbox"
                          className="clay-checkbox"
                          checked={selectedRows.size === reportData.length && reportData.length > 0}
                          onChange={handleSelectAll}
                        />
                      </div>
                    </th>
                    {/* Row number header */}
                    <th className="clay-hdr clay-hdr-rownum">
                      <div className="clay-hdr-content" style={{ justifyContent: "center" }}>#</div>
                    </th>
                    {/* Data column headers */}
                    {activeReport.columns.map((colKey, colIdx) => (
                      <th
                        key={colKey}
                        className={`clay-hdr${colIdx === 0 ? " clay-hdr-pin" : ""}`}
                        onClick={() => handleColumnSort(colKey)}
                      >
                        <div className="clay-hdr-content">
                          <span className="clay-hdr-label">
                            {getColumnLabel(colKey, activeReport.entity_type)}
                          </span>
                          {viewerSort.field === colKey && (
                            <span className="clay-sort-indicator">
                              {viewerSort.direction === "asc" ? "▲" : "▼"}
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedData.map((row, rowIdx) => (
                    <tr
                      key={String(row.id)}
                      className={`clay-row${selectedRows.has(String(row.id)) ? " clay-row-selected" : ""}`}
                    >
                      {/* Checkbox cell */}
                      <td className="clay-cell clay-cell-checkbox">
                        <input
                          type="checkbox"
                          className="clay-checkbox"
                          checked={selectedRows.has(String(row.id))}
                          onChange={() => handleToggleRow(String(row.id))}
                        />
                      </td>
                      {/* Row number cell */}
                      <td className="clay-cell clay-cell-rownum">{rowIdx + 1}</td>
                      {/* Data cells */}
                      {activeReport.columns.map((colKey, colIdx) => (
                        <td
                          key={colKey}
                          className={`clay-cell${colIdx === 0 ? " clay-cell-pin" : ""}`}
                          onClick={() => {
                            if (colIdx === 0 && activeReport.entity_type !== "activities") {
                              navigateToEntity(activeReport.entity_type, String(row.id));
                            }
                          }}
                        >
                          <div className="clay-cell-content">
                            {formatCellValue(colKey, row[colKey], row, activeReport.entity_type)}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
