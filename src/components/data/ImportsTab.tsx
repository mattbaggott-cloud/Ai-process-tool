"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import type { DataImport, CrmCustomField, CustomFieldType } from "@/lib/types/database";

/* ── CSV Parser ──────────────────────────────────────────── */
// Handles quoted fields with embedded newlines, commas, and escaped quotes.
// Shopify exports commonly have multi-line addresses and line items inside quotes.

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ("") → literal quote
        if (i + 1 < len && text[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        // Inside quotes: newlines, commas, anything goes — it's all part of the field
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === "," || ch === "\t") {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if (ch === "\n" || ch === "\r") {
        // Skip \r in \r\n
        if (ch === "\r" && i + 1 < len && text[i + 1] === "\n") i++;
        // End of row
        currentRow.push(currentField.trim());
        currentField = "";
        if (currentRow.some((f) => f !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        currentField += ch;
      }
    }
  }

  // Last field/row
  currentRow.push(currentField.trim());
  if (currentRow.some((f) => f !== "")) {
    rows.push(currentRow);
  }

  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0];
  const dataRows = rows.slice(1).map((vals) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] ?? "";
    });
    return obj;
  });
  return { headers, rows: dataRows };
}

/* ── Target table field definitions ──────────────────────── */

const TARGET_TABLES: { key: string; label: string }[] = [
  { key: "crm_contacts", label: "CRM Contacts" },
  { key: "crm_companies", label: "CRM Companies" },
  { key: "crm_deals", label: "CRM Deals" },
  { key: "crm_products", label: "CRM Products" },
  { key: "ecom_customers", label: "E-Commerce Customers" },
  { key: "ecom_orders", label: "E-Commerce Orders (+ Customers)" },
];

const TARGET_FIELDS: Record<string, { field: string; label: string; required: boolean }[]> = {
  crm_contacts: [
    { field: "first_name", label: "First Name", required: true },
    { field: "last_name", label: "Last Name", required: false },
    { field: "email", label: "Email", required: false },
    { field: "phone", label: "Phone", required: false },
    { field: "title", label: "Job Title", required: false },
    { field: "company_name", label: "Company Name (auto-links)", required: false },
    { field: "status", label: "Status (lead/active/inactive/churned)", required: false },
    { field: "notes", label: "Notes", required: false },
  ],
  crm_companies: [
    { field: "name", label: "Company Name", required: true },
    { field: "domain", label: "Domain", required: false },
    { field: "industry", label: "Industry", required: false },
    { field: "size", label: "Size", required: false },
    { field: "sector", label: "Sector", required: false },
    { field: "annual_revenue", label: "Annual Revenue", required: false },
    { field: "employees", label: "Employees", required: false },
    { field: "description", label: "Description", required: false },
  ],
  crm_deals: [
    { field: "title", label: "Title", required: true },
    { field: "value", label: "Value", required: false },
    { field: "stage", label: "Stage", required: false },
    { field: "probability", label: "Probability", required: false },
    { field: "expected_close_date", label: "Expected Close Date", required: false },
    { field: "notes", label: "Notes", required: false },
  ],
  crm_products: [
    { field: "name", label: "Product Name", required: true },
    { field: "sku", label: "SKU", required: false },
    { field: "category", label: "Category", required: false },
    { field: "unit_price", label: "Unit Price", required: false },
    { field: "description", label: "Description", required: false },
  ],
  ecom_customers: [
    { field: "email", label: "Email", required: true },
    { field: "full_name", label: "Full Name (splits into first + last)", required: false },
    { field: "first_name", label: "First Name", required: false },
    { field: "last_name", label: "Last Name", required: false },
    { field: "phone", label: "Phone", required: false },
    { field: "orders_count", label: "Orders Count", required: false },
    { field: "total_spent", label: "Total Spent", required: false },
    { field: "addr_address1", label: "Address Line 1", required: false },
    { field: "addr_city", label: "City", required: false },
    { field: "addr_province", label: "State/Province", required: false },
    { field: "addr_zip", label: "Zip Code", required: false },
    { field: "addr_country", label: "Country", required: false },
  ],
  ecom_orders: [
    { field: "email", label: "Customer Email", required: true },
    { field: "full_name", label: "Full Name (splits into first + last)", required: false },
    { field: "first_name", label: "Customer First Name", required: false },
    { field: "last_name", label: "Customer Last Name", required: false },
    { field: "phone", label: "Customer Phone", required: false },
    { field: "accepts_marketing", label: "Accepts Marketing", required: false },
    { field: "order_number", label: "Order Number / Name", required: false },
    { field: "total_price", label: "Total Price", required: false },
    { field: "subtotal_price", label: "Subtotal", required: false },
    { field: "total_tax", label: "Tax", required: false },
    { field: "total_discounts", label: "Discounts", required: false },
    { field: "total_shipping", label: "Shipping Cost", required: false },
    { field: "currency", label: "Currency", required: false },
    { field: "financial_status", label: "Financial Status", required: false },
    { field: "fulfillment_status", label: "Fulfillment Status", required: false },
    { field: "processed_at", label: "Order Date / Created At", required: false },
    { field: "discount_code", label: "Discount Code", required: false },
    { field: "shipping_method", label: "Shipping Method", required: false },
    { field: "note", label: "Notes", required: false },
    { field: "lineitem_name", label: "Line Item Name", required: false },
    { field: "lineitem_quantity", label: "Line Item Quantity", required: false },
    { field: "lineitem_price", label: "Line Item Price", required: false },
    { field: "lineitem_sku", label: "Line Item SKU", required: false },
    { field: "addr_address1", label: "Billing Address", required: false },
    { field: "addr_city", label: "Billing City", required: false },
    { field: "addr_province", label: "Billing State/Province", required: false },
    { field: "addr_zip", label: "Billing Zip", required: false },
    { field: "addr_country", label: "Billing Country", required: false },
    { field: "addr_phone", label: "Billing Phone", required: false },
    { field: "ship_address1", label: "Ship Address", required: false },
    { field: "ship_city", label: "Ship City", required: false },
    { field: "ship_province", label: "Ship State/Province", required: false },
    { field: "ship_zip", label: "Ship Zip", required: false },
    { field: "ship_country", label: "Ship Country", required: false },
    { field: "ship_phone", label: "Ship Phone", required: false },
  ],
};

/* ── Tables that support custom fields via crm_custom_fields table */
const CRM_CUSTOM_FIELD_TABLES = ["crm_contacts", "crm_companies", "crm_deals"];
/* Ecom tables support extra fields via metadata JSONB (no crm_custom_fields needed) */
const ECOM_TABLES = ["ecom_customers", "ecom_orders"];

/* ── Auto-suggest mapping ────────────────────────────────── */

// Shopify-specific column name → target field mappings
const SHOPIFY_HEADER_MAP: Record<string, string> = {
  "name": "order_number",
  "total": "total_price",
  "subtotal": "subtotal_price",
  "taxes": "total_tax",
  "shipping": "total_shipping",
  "discount amount": "total_discounts",
  "discount code": "discount_code",
  "shipping method": "shipping_method",
  "created at": "processed_at",
  "paid at": "processed_at",
  "financial status": "financial_status",
  "fulfillment status": "fulfillment_status",
  "accepts marketing": "accepts_marketing",
  "currency": "currency",
  "lineitem name": "lineitem_name",
  "lineitem quantity": "lineitem_quantity",
  "lineitem price": "lineitem_price",
  "lineitem sku": "lineitem_sku",
  "billing name": "full_name",
  "shipping name": "full_name",
  "billing address1": "addr_address1",
  "billing city": "addr_city",
  "billing province": "addr_province",
  "billing province name": "addr_province",
  "billing zip": "addr_zip",
  "billing country": "addr_country",
  "billing phone": "addr_phone",
  "shipping address1": "ship_address1",
  "shipping city": "ship_city",
  "shipping province": "ship_province",
  "shipping province name": "ship_province",
  "shipping zip": "ship_zip",
  "shipping country": "ship_country",
  "shipping phone": "ship_phone",
  "notes": "note",
  "phone": "phone",
};

function suggestMapping(
  csvHeader: string,
  fields: { field: string; label: string }[],
  customFields: CrmCustomField[]
): string {
  const norm = csvHeader.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lowerHeader = csvHeader.toLowerCase().trim();

  // Check Shopify-specific mappings first (exact match on lowercase header)
  if (SHOPIFY_HEADER_MAP[lowerHeader]) {
    const targetField = SHOPIFY_HEADER_MAP[lowerHeader];
    // Only return if this field exists in the current target table's fields
    if (fields.some((f) => f.field === targetField)) return targetField;
  }

  // Check standard fields
  for (const f of fields) {
    const fNorm = f.field.replace(/_/g, "");
    const lNorm = f.label.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm === fNorm || norm === lNorm) return f.field;
    if (norm.includes(fNorm) || fNorm.includes(norm)) return f.field;
    if (norm.includes(lNorm) || lNorm.includes(norm)) return f.field;
  }

  // Check custom fields
  for (const cf of customFields) {
    const keyNorm = cf.field_key.replace(/_/g, "");
    const labelNorm = cf.field_label.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm === keyNorm || norm === labelNorm) return `custom:${cf.field_key}`;
    if (norm.includes(keyNorm) || keyNorm.includes(norm)) return `custom:${cf.field_key}`;
    if (norm.includes(labelNorm) || labelNorm.includes(norm)) return `custom:${cf.field_key}`;
  }

  return "";
}

/* ── Component ─────────────────────────────────────────── */

type WizardStep = "upload" | "preview" | "map" | "importing" | "results";

export default function ImportsTab() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── History state ── */
  const [imports, setImports] = useState<DataImport[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  /* ── Wizard state ── */
  const [showWizard, setShowWizard] = useState(false);
  const [step, setStep] = useState<WizardStep>("upload");
  const [fileName, setFileName] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [targetTable, setTargetTable] = useState("crm_contacts");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [mapSearch, setMapSearch] = useState("");
  const [skippedCols, setSkippedCols] = useState<Set<string>>(new Set());
  const [importId, setImportId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [importErrors, setImportErrors] = useState<{ row: number; message: string }[]>([]);
  const [ecomStats, setEcomStats] = useState<{ customers: number; orders: number; skippedNoEmail: number } | null>(null);

  /* ── Custom field state ── */
  const [customFields, setCustomFields] = useState<CrmCustomField[]>([]);
  const [creatingFieldFor, setCreatingFieldFor] = useState<string | null>(null); // csv header
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>("text");
  const [creatingField, setCreatingField] = useState(false);

  /* ── Dropdown state ── */
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openDropdown]);

  /* ── Load custom fields ── */
  const loadCustomFields = useCallback(async () => {
    if (!user || !CRM_CUSTOM_FIELD_TABLES.includes(targetTable)) {
      setCustomFields([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("crm_custom_fields")
      .select("*")
      .eq("table_name", targetTable)
      .order("sort_order", { ascending: true });
    if (data) setCustomFields(data as CrmCustomField[]);
  }, [user, targetTable]);

  useEffect(() => {
    loadCustomFields();
  }, [loadCustomFields]);

  /* ── Load import history ── */
  const loadHistory = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("data_imports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setImports(data as DataImport[]);
    setLoadingHistory(false);
  }, [user]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const handler = () => loadHistory();
    window.addEventListener("workspace-updated", handler);
    return () => window.removeEventListener("workspace-updated", handler);
  }, [loadHistory]);

  /* ── Auto-detect target table from CSV headers ── */
  const detectTargetTable = (headers: string[]): string => {
    const lower = headers.map((h) => h.toLowerCase());
    const hasEcomSignals = lower.some((h) =>
      h.includes("order") || h.includes("lineitem") || h.includes("line item") ||
      h.includes("total") || h.includes("fulfillment") || h.includes("shipping") ||
      h.includes("sku") || h.includes("product") || h.includes("variant") ||
      h.includes("subtotal") || h.includes("discount")
    );
    const hasEmailOrName = lower.some((h) => h.includes("email") || h.includes("name"));

    if (hasEcomSignals && hasEmailOrName) return "ecom_orders";
    if (hasEcomSignals) return "ecom_orders";
    // Check for CRM-like signals
    const hasCrmSignals = lower.some((h) =>
      h.includes("company") || h.includes("deal") || h.includes("stage") ||
      h.includes("pipeline") || h.includes("lead") || h.includes("status")
    );
    if (hasCrmSignals && lower.some((h) => h.includes("value") || h.includes("stage"))) return "crm_deals";
    if (hasCrmSignals && lower.some((h) => h.includes("domain") || h.includes("industry"))) return "crm_companies";
    if (hasEmailOrName) return "crm_contacts";
    return "crm_contacts";
  };

  /* ── File handling ── */
  const handleFile = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["csv", "tsv", "txt"].includes(ext)) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);
      if (headers.length === 0) return;
      setCsvHeaders(headers);
      setCsvRows(rows);
      // Auto-detect the target table from headers
      setTargetTable(detectTargetTable(headers));
      setStep("preview");
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  /* ── Move to mapping step ── */
  const goToMapping = () => {
    const fields = TARGET_FIELDS[targetTable] || [];
    const autoMap: Record<string, string> = {};
    csvHeaders.forEach((h) => {
      autoMap[h] = suggestMapping(h, fields, customFields);
    });
    setMappings(autoMap);
    setStep("map");
  };

  /* ── Create custom field inline ── */
  const handleCreateCustomField = async (csvHeader: string) => {
    if (!user || !newFieldLabel.trim()) return;
    setCreatingField(true);

    const fieldKey = newFieldLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

    const isEcom = ECOM_TABLES.includes(targetTable);

    if (isEcom) {
      // Ecom tables: store in metadata JSONB — no DB record needed, just set the mapping
      setMappings((prev) => ({ ...prev, [csvHeader]: `meta:${fieldKey}` }));
      setCreatingFieldFor(null);
      setNewFieldLabel("");
      setNewFieldType("text");
      setCreatingField(false);
      return;
    }

    // CRM tables: create a crm_custom_fields record
    const supabase = createClient();
    const { data, error } = await supabase
      .from("crm_custom_fields")
      .insert({
        user_id: user.id,
        org_id: orgId,
        table_name: targetTable,
        field_key: fieldKey,
        field_label: newFieldLabel.trim(),
        field_type: newFieldType,
        sort_order: customFields.length,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Failed to create custom field:", error.message);
      setCreatingField(false);
      return;
    }

    // Add to local custom fields
    const newField = data as CrmCustomField;
    setCustomFields((prev) => [...prev, newField]);

    // Auto-map this CSV header to the new field
    setMappings((prev) => ({ ...prev, [csvHeader]: `custom:${fieldKey}` }));

    // Reset inline form
    setCreatingFieldFor(null);
    setNewFieldLabel("");
    setNewFieldType("text");
    setCreatingField(false);
  };

  /* ── Execute import ── */
  const executeImport = async () => {
    if (!user) return;
    setStep("importing");
    const supabase = createClient();
    const isEcom = targetTable.startsWith("ecom_");

    // Create import record
    const mappedFields = csvHeaders.map((h) => ({
      csv_column: h,
      target_field: mappings[h] || "",
      skipped: !mappings[h],
    }));

    const { data: impRow } = await supabase
      .from("data_imports")
      .insert({
        user_id: user.id,
        org_id: orgId,
        source_name: fileName,
        target_table: targetTable,
        status: "importing",
        total_rows: csvRows.length,
        mapped_fields: mappedFields,
        file_preview: csvRows.slice(0, 10),
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    const currentImportId = impRow?.id || null;
    setImportId(currentImportId);

    let imported = 0;
    let errorCount = 0;
    const errors: { row: number; message: string }[] = [];
    const BATCH = 50;

    setProgress({ done: 0, total: csvRows.length, errors: 0 });

    if (isEcom) {
      // ── E-Commerce import (customers + orders with dedup) ──
      const activeMappings = csvHeaders
        .filter((h) => mappings[h])
        .map((h) => ({ csv: h, field: mappings[h] }));

      const numericFields = ["total_price", "subtotal_price", "total_tax", "total_discounts", "total_shipping", "orders_count", "total_spent"];

      // Helper to get mapped value from row
      const getMapped = (row: Record<string, string>, fieldName: string): string => {
        const m = activeMappings.find((am) => am.field === fieldName);
        return m ? (row[m.csv] ?? "").trim() : "";
      };
      const getNumeric = (row: Record<string, string>, fieldName: string): number => {
        const val = getMapped(row, fieldName);
        const num = parseFloat(val.replace(/[^0-9.-]/g, ""));
        return isNaN(num) ? 0 : num;
      };

      // Group rows by email for customer dedup
      let skippedNoEmail = 0;
      const emailToRows = new Map<string, Record<string, string>[]>();
      for (const row of csvRows) {
        const email = getMapped(row, "email").toLowerCase();
        if (!email) { skippedNoEmail++; continue; }
        const existing = emailToRows.get(email) ?? [];
        existing.push(row);
        emailToRows.set(email, existing);
      }

      // Look up existing customers
      const emailToCustomerId = new Map<string, string>();
      const allEmails = [...emailToRows.keys()];
      for (let i = 0; i < allEmails.length; i += 200) {
        const batch = allEmails.slice(i, i + 200);
        const { data: existing } = await supabase
          .from("ecom_customers")
          .select("id, email")
          .eq("org_id", orgId)
          .in("email", batch);
        if (existing) {
          for (const c of existing) {
            emailToCustomerId.set((c.email as string).toLowerCase(), c.id as string);
          }
        }
      }

      // Insert new customers
      const newEmails = allEmails.filter((e) => !emailToCustomerId.has(e));
      for (let i = 0; i < newEmails.length; i += BATCH) {
        const batchEmails = newEmails.slice(i, i + BATCH);
        const insertRows = batchEmails.map((email) => {
          const firstRow = emailToRows.get(email)![0];
          const allRows = emailToRows.get(email)!;

          // Build address from addr_ fields
          const address: Record<string, string> = {};
          for (const m of activeMappings) {
            if (m.field.startsWith("addr_")) {
              const val = (firstRow[m.csv] ?? "").trim();
              if (val) address[m.field.replace("addr_", "")] = val;
            }
          }

          // Collect meta: fields into metadata
          const custMeta: Record<string, unknown> = { imported_by: user.id, imported_at: new Date().toISOString() };
          for (const m of activeMappings) {
            if (m.field.startsWith("meta:")) {
              const key = m.field.replace("meta:", "");
              const val = (firstRow[m.csv] ?? "").trim();
              if (val) custMeta[key] = val;
            }
          }

          // Count unique orders for this customer (not raw line item rows)
          const orderNumField = activeMappings.find((am) => am.field === "order_number");
          let custOrderCount = allRows.length;
          let custTotalSpent = allRows.reduce((s, r) => s + getNumeric(r, "total_price"), 0);
          if (orderNumField && targetTable === "ecom_orders") {
            const uniqueOrders = new Set<string>();
            custTotalSpent = 0;
            for (const r of allRows) {
              const oNum = (r[orderNumField.csv] ?? "").trim();
              if (oNum && !uniqueOrders.has(oNum)) {
                uniqueOrders.add(oNum);
                custTotalSpent += getNumeric(r, "total_price");
              }
            }
            custOrderCount = uniqueOrders.size;
          }

          // Handle full_name → split into first + last
          let firstName = getMapped(firstRow, "first_name") || null;
          let lastName = getMapped(firstRow, "last_name") || null;
          const fullName = getMapped(firstRow, "full_name");
          if (fullName && (!firstName || !lastName)) {
            const parts = fullName.trim().split(/\s+/);
            if (!firstName) firstName = parts[0] || null;
            if (!lastName) lastName = parts.slice(1).join(" ") || null;
          }

          return {
            org_id: orgId,
            external_id: `import-${email}`,
            external_source: "import",
            email,
            first_name: firstName,
            last_name: lastName,
            phone: getMapped(firstRow, "phone") || null,
            default_address: Object.keys(address).length > 0 ? address : null,
            accepts_marketing: getMapped(firstRow, "accepts_marketing") === "yes" || getMapped(firstRow, "accepts_marketing") === "true" || false,
            orders_count: targetTable === "ecom_orders" ? custOrderCount : (getNumeric(firstRow, "orders_count") || 0),
            total_spent: targetTable === "ecom_orders"
              ? Math.round(custTotalSpent * 100) / 100
              : (getNumeric(firstRow, "total_spent") || 0),
            metadata: custMeta,
          };
        });

        const { data: inserted, error } = await supabase
          .from("ecom_customers")
          .insert(insertRows)
          .select("id, email");

        if (error) {
          errorCount += batchEmails.length;
          errors.push({ row: i + 1, message: `Customers: ${error.message}` });
        } else if (inserted) {
          for (const c of inserted) {
            emailToCustomerId.set((c.email as string).toLowerCase(), c.id as string);
            imported++;
          }
        }
        setProgress({ done: Math.min(i + BATCH, newEmails.length), total: csvRows.length, errors: errorCount });
      }

      // Insert orders (for ecom_orders target)
      if (targetTable === "ecom_orders") {
        // Group rows by order_number (Shopify: multiple rows per order = line items)
        const orderNumField = activeMappings.find((am) => am.field === "order_number");
        const lineitemNameField = activeMappings.find((am) => am.field === "lineitem_name");
        const lineitemQtyField = activeMappings.find((am) => am.field === "lineitem_quantity");
        const lineitemPriceField = activeMappings.find((am) => am.field === "lineitem_price");
        const lineitemSkuField = activeMappings.find((am) => am.field === "lineitem_sku");
        const hasLineitemFields = !!(lineitemNameField || lineitemSkuField);

        const orderGroups = new Map<string, Record<string, string>[]>();
        for (const row of csvRows) {
          const email = getMapped(row, "email").toLowerCase();
          // Don't skip rows without email — import them as unlinked orders
          const orderNum = orderNumField ? (row[orderNumField.csv] ?? "").trim() : "";
          const groupKey = orderNum || `row-${orderGroups.size}`;
          // Only add to group if we haven't seen this order yet OR it's a line item row
          const existing = orderGroups.get(groupKey) ?? [];
          existing.push(row);
          orderGroups.set(groupKey, existing);
        }

        const orderRows: Record<string, unknown>[] = [];
        let orderIdx = 0;

        for (const [, groupRows] of orderGroups) {
          const primaryRow = groupRows[0];
          const email = getMapped(primaryRow, "email").toLowerCase();
          const customerId = email ? emailToCustomerId.get(email) : null;

          // Build shipping address
          const shipAddr: Record<string, string> = {};
          for (const m of activeMappings) {
            if (m.field.startsWith("ship_")) {
              const val = (primaryRow[m.csv] ?? "").trim();
              if (val) shipAddr[m.field.replace("ship_", "")] = val;
            }
          }

          // Build line items from all rows in this order group
          const lineItems: unknown[] = [];
          if (hasLineitemFields) {
            for (const row of groupRows) {
              const item: Record<string, unknown> = {};
              if (lineitemNameField) item.name = (row[lineitemNameField.csv] ?? "").trim();
              if (lineitemQtyField) {
                const q = parseFloat((row[lineitemQtyField.csv] ?? "").replace(/[^0-9.-]/g, ""));
                item.quantity = isNaN(q) ? 1 : q;
              }
              if (lineitemPriceField) {
                const p = parseFloat((row[lineitemPriceField.csv] ?? "").replace(/[^0-9.-]/g, ""));
                item.price = isNaN(p) ? 0 : p;
              }
              if (lineitemSkuField) item.sku = (row[lineitemSkuField.csv] ?? "").trim();
              if (item.name || item.sku) lineItems.push(item);
            }
          } else {
            const itemText = getMapped(primaryRow, "line_items_text");
            if (itemText) lineItems.push({ title: itemText, quantity: 1, price: getNumeric(primaryRow, "total_price") });
          }

          // Collect meta: fields
          const orderMeta: Record<string, unknown> = { imported_by: user.id, imported_at: new Date().toISOString() };
          for (const m of activeMappings) {
            if (m.field.startsWith("meta:")) {
              const key = m.field.replace("meta:", "");
              const val = (primaryRow[m.csv] ?? "").trim();
              if (val) orderMeta[key] = val;
            }
          }

          const orderNum = getMapped(primaryRow, "order_number") || `IMP-${Date.now()}-${orderIdx}`;
          orderIdx++;

          const processedAt = getMapped(primaryRow, "processed_at");
          let parsedDate: string | null = null;
          if (processedAt) {
            const d = new Date(processedAt);
            parsedDate = isNaN(d.getTime()) ? null : d.toISOString();
          }

          orderRows.push({
            org_id: orgId,
            external_id: `import-${orderNum}`,
            external_source: "import",
            customer_id: customerId || null,
            customer_external_id: email,
            order_number: orderNum,
            email,
            financial_status: getMapped(primaryRow, "financial_status") || "paid",
            fulfillment_status: getMapped(primaryRow, "fulfillment_status") || "fulfilled",
            total_price: getNumeric(primaryRow, "total_price"),
            subtotal_price: getNumeric(primaryRow, "subtotal_price") || getNumeric(primaryRow, "total_price"),
            total_tax: getNumeric(primaryRow, "total_tax"),
            total_discounts: getNumeric(primaryRow, "total_discounts"),
            total_shipping: getNumeric(primaryRow, "total_shipping"),
            currency: getMapped(primaryRow, "currency") || "USD",
            line_items: lineItems,
            shipping_address: Object.keys(shipAddr).length > 0 ? shipAddr : null,
            note: getMapped(primaryRow, "note") || null,
            source_name: "import",
            processed_at: parsedDate || new Date().toISOString(),
            metadata: orderMeta,
          });
        }

        for (let i = 0; i < orderRows.length; i += BATCH) {
          const batch = orderRows.slice(i, i + BATCH);
          const { error } = await supabase.from("ecom_orders").insert(batch);
          if (error) {
            errorCount += batch.length;
            errors.push({ row: i + 1, message: `Orders: ${error.message}` });
          } else {
            imported += batch.length;
          }
          setProgress({ done: newEmails.length + i + batch.length, total: orderRows.length + newEmails.length, errors: errorCount });
        }

        // Update customer aggregates
        for (const [, custId] of emailToCustomerId) {
          const { data: orderAgg } = await supabase
            .from("ecom_orders")
            .select("total_price, processed_at")
            .eq("org_id", orgId)
            .eq("customer_id", custId)
            .order("processed_at", { ascending: true });
          if (orderAgg && orderAgg.length > 0) {
            const totalSpent = orderAgg.reduce((s, o) => s + ((o.total_price as number) || 0), 0);
            await supabase
              .from("ecom_customers")
              .update({
                orders_count: orderAgg.length,
                total_spent: Math.round(totalSpent * 100) / 100,
                avg_order_value: Math.round((totalSpent / orderAgg.length) * 100) / 100,
                first_order_at: orderAgg[0].processed_at as string,
                last_order_at: orderAgg[orderAgg.length - 1].processed_at as string,
              })
              .eq("id", custId);
          }
        }

        // Set ecom-specific stats for the results page
        setEcomStats({
          customers: allEmails.length,
          orders: orderGroups.size,
          skippedNoEmail,  // informational: rows with no email (still imported as unlinked orders)
        });
      }
    } else {
      // ── CRM import (original logic) ──
      const activeMappings = csvHeaders
        .filter((h) => mappings[h])
        .map((h) => ({ csv: h, field: mappings[h] }));

      const standardMappings = activeMappings.filter((m) => !m.field.startsWith("custom:"));
      const customMappingsArr = activeMappings.filter((m) => m.field.startsWith("custom:"));

      // For contacts: resolve company_name → company_id
      const companyNameMapping = standardMappings.find((m) => m.field === "company_name");
      const companyCache: Record<string, string> = {};

      if (targetTable === "crm_contacts" && companyNameMapping) {
        const uniqueNames = [...new Set(csvRows.map((r) => (r[companyNameMapping.csv] ?? "").trim()).filter(Boolean))];
        if (uniqueNames.length > 0) {
          const { data: existing } = await supabase
            .from("crm_companies")
            .select("id, name")
            .in("name", uniqueNames);
          if (existing) existing.forEach((c) => { companyCache[c.name] = c.id; });
          const missing = uniqueNames.filter((n) => !companyCache[n]);
          for (const name of missing) {
            const { data: created } = await supabase
              .from("crm_companies")
              .insert({ user_id: user.id, org_id: orgId, name })
              .select("id")
              .single();
            if (created) companyCache[name] = created.id;
          }
        }
      }

      for (let i = 0; i < csvRows.length; i += BATCH) {
        const batch = csvRows.slice(i, i + BATCH);
        const insertRows = batch.map((row) => {
          const mapped: Record<string, unknown> = { user_id: user.id, org_id: orgId };
          const metadata: Record<string, unknown> = {};

          for (const m of standardMappings) {
            const val = row[m.csv] ?? "";
            if (m.field === "company_name" && targetTable === "crm_contacts") {
              const companyId = companyCache[val.trim()];
              if (companyId) mapped.company_id = companyId;
              continue;
            }
            if (["value", "probability", "unit_price", "annual_revenue", "employees"].includes(m.field)) {
              const num = parseFloat(val);
              mapped[m.field] = isNaN(num) ? 0 : num;
            } else {
              mapped[m.field] = val;
            }
          }

          for (const m of customMappingsArr) {
            const fieldKey = m.field.replace("custom:", "");
            const val = row[m.csv] ?? "";
            const cfDef = customFields.find((cf) => cf.field_key === fieldKey);
            if (cfDef?.field_type === "number") {
              const num = parseFloat(val);
              metadata[fieldKey] = isNaN(num) ? null : num;
            } else if (cfDef?.field_type === "boolean") {
              metadata[fieldKey] = ["true", "yes", "1"].includes(val.toLowerCase());
            } else {
              metadata[fieldKey] = val;
            }
          }

          if (Object.keys(metadata).length > 0) mapped.metadata = metadata;
          if (targetTable === "crm_contacts") mapped.source = "import";
          return mapped;
        });

        const { error } = await supabase.from(targetTable).insert(insertRows);
        if (error) {
          errorCount += batch.length;
          errors.push({ row: i + 1, message: error.message });
        } else {
          imported += batch.length;
        }
        setProgress({ done: i + batch.length, total: csvRows.length, errors: errorCount });
      }
    }

    // Update import record
    if (currentImportId) {
      await supabase
        .from("data_imports")
        .update({
          status: errorCount === csvRows.length ? "failed" : "completed",
          imported_rows: imported,
          error_rows: errorCount,
          errors: errors.map((e) => ({ row: e.row, field: "", message: e.message })),
          completed_at: new Date().toISOString(),
        })
        .eq("id", currentImportId);
    }

    // Log to sync log
    await supabase.from("data_sync_log").insert({
      user_id: user.id,
      org_id: orgId,
      import_id: currentImportId,
      event_type: errorCount === 0 ? "success" : errorCount === csvRows.length ? "error" : "warning",
      message: `Imported ${imported} of ${csvRows.length} rows to ${targetTable}${errorCount > 0 ? ` (${errorCount} errors)` : ""}`,
      details: { imported, errors: errorCount, source: fileName },
    });

    setImportErrors(errors);
    setProgress({ done: csvRows.length, total: csvRows.length, errors: errorCount });
    setStep("results");
    window.dispatchEvent(new Event("workspace-updated"));
    loadHistory();
  };

  /* ── Reset wizard ── */
  const resetWizard = () => {
    setShowWizard(false);
    setStep("upload");
    setFileName("");
    setCsvHeaders([]);
    setCsvRows([]);
    setTargetTable("crm_contacts");
    setMappings({});
    setImportId(null);
    setProgress({ done: 0, total: 0, errors: 0 });
    setImportErrors([]);
    setCreatingFieldFor(null);
    setNewFieldLabel("");
    setNewFieldType("text");
    setEcomStats(null);
    setSkippedCols(new Set());
    if (fileRef.current) fileRef.current.value = "";
  };

  /* ── Computed values ── */
  const mappedCount = Object.values(mappings).filter(Boolean).length;
  const customMappedCount = Object.values(mappings).filter((v) => v.startsWith("custom:") || v.startsWith("meta:")).length;
  const standardMappedCount = mappedCount - customMappedCount;
  const skippedCount = csvHeaders.length - mappedCount;
  const requiredFields = (TARGET_FIELDS[targetTable] || []).filter((f) => f.required);
  const unmappedRequired = requiredFields.filter(
    (rf) => !Object.values(mappings).includes(rf.field)
  );
  const isCrmCustom = CRM_CUSTOM_FIELD_TABLES.includes(targetTable);
  const isEcomTable = ECOM_TABLES.includes(targetTable);
  const supportsCustomFields = isCrmCustom || isEcomTable;

  /* ── Ecom data breakdown (computed from CSV before import) ── */
  const ecomBreakdown = React.useMemo(() => {
    if (!targetTable.startsWith("ecom_") || csvRows.length === 0) return null;

    // Find email and order number columns
    const lowerHeaders = csvHeaders.map((h) => h.toLowerCase());
    const emailCol = csvHeaders.find((_, i) => lowerHeaders[i] === "email");
    const orderCol = csvHeaders.find((_, i) =>
      lowerHeaders[i] === "name" || lowerHeaders[i] === "order number" || lowerHeaders[i] === "order_number" || lowerHeaders[i] === "order"
    );

    const uniqueOrders = new Set<string>();
    const uniqueEmails = new Set<string>();
    let rowsWithEmail = 0;
    let rowsNoEmail = 0;

    for (const row of csvRows) {
      const email = emailCol ? (row[emailCol] ?? "").trim().toLowerCase() : "";
      const orderNum = orderCol ? (row[orderCol] ?? "").trim() : "";
      if (orderNum) uniqueOrders.add(orderNum);
      if (email) {
        uniqueEmails.add(email);
        rowsWithEmail++;
      } else {
        rowsNoEmail++;
      }
    }

    return {
      totalRows: csvRows.length,
      uniqueOrders: uniqueOrders.size,
      uniqueCustomers: uniqueEmails.size,
      rowsWithEmail,
      rowsNoEmail,
      hasOrderGrouping: uniqueOrders.size > 0 && uniqueOrders.size < csvRows.length,
    };
  }, [csvRows, csvHeaders, targetTable]);

  /* ── Type chip options ── */
  const TYPE_CHIPS: { type: CustomFieldType; label: string; icon: string }[] = [
    { type: "text", label: "Text", icon: "Text" },
    { type: "number", label: "Number", icon: "Number" },
    { type: "date", label: "Date", icon: "Date" },
    { type: "boolean", label: "Yes/No", icon: "Yes/No" },
  ];

  /* ── Format helper ── */
  const fmtDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const statusColor = (s: string) => {
    const colors: Record<string, { bg: string; fg: string }> = {
      pending: { bg: "rgba(107,114,128,0.1)", fg: "#6b7280" },
      mapping: { bg: "rgba(245,158,11,0.1)", fg: "#d97706" },
      importing: { bg: "rgba(37,99,235,0.1)", fg: "#2563eb" },
      completed: { bg: "rgba(22,163,74,0.1)", fg: "#16a34a" },
      failed: { bg: "rgba(220,38,38,0.1)", fg: "#dc2626" },
    };
    return colors[s] || colors.pending;
  };

  /* ── Helper: get display info for a mapping value ── */
  const getMappingInfo = (val: string) => {
    if (!val) return { label: "Select field...", color: "gray" as const, icon: "–" };
    if (val.startsWith("custom:")) {
      const key = val.replace("custom:", "");
      const cf = customFields.find((f) => f.field_key === key);
      return { label: cf?.field_label || key, color: "blue" as const, icon: "★" };
    }
    if (val.startsWith("meta:")) {
      const key = val.replace("meta:", "").replace(/_/g, " ");
      return { label: key, color: "blue" as const, icon: "+" };
    }
    const stdFields = TARGET_FIELDS[targetTable] || [];
    const f = stdFields.find((sf) => sf.field === val);
    return { label: f?.label || val, color: "green" as const, icon: "✓" };
  };

  /* ── Render ── */
  return (
    <div className="data-tab-content">
      {/* ── Wizard ── */}
      {showWizard ? (
        <div className="data-wizard">
          {/* Step indicators */}
          <div className="data-wizard-steps">
            {["Upload", "Preview", "Map Fields", "Import", "Results"].map((label, idx) => {
              const stepKeys: WizardStep[] = ["upload", "preview", "map", "importing", "results"];
              const currentIdx = stepKeys.indexOf(step);
              return (
                <div
                  key={label}
                  className={`data-wizard-step ${idx <= currentIdx ? "data-wizard-step-active" : ""} ${idx === currentIdx ? "data-wizard-step-current" : ""}`}
                >
                  <span className="data-wizard-step-num">{idx + 1}</span>
                  {label}
                </div>
              );
            })}
          </div>

          {/* Upload */}
          {step === "upload" && (
            <div
              className={`data-upload-zone ${dragOver ? "data-upload-zone-active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <svg width="40" height="40" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6v20M12 14l8-8 8 8" />
                <path d="M6 26v4a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4v-4" />
              </svg>
              <p style={{ margin: "12px 0 4px", fontWeight: 600, color: "#374151" }}>
                Drop a CSV file here or click to browse
              </p>
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Supports .csv, .tsv, .txt files</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleFileInput}
                style={{ display: "none" }}
              />
            </div>
          )}

          {/* Preview */}
          {step === "preview" && (
            <div>
              <div className="data-preview-header">
                <div>
                  <strong>{fileName}</strong> — {csvRows.length.toLocaleString()} rows, {csvHeaders.length} columns
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ fontSize: 13, color: "#6b7280" }}>Import to:</label>
                  <select
                    className="crm-input"
                    value={targetTable}
                    onChange={(e) => setTargetTable(e.target.value)}
                    style={{ width: "auto" }}
                  >
                    {TARGET_TABLES.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="data-preview-table-wrap">
                <table className="data-preview-table">
                  <thead>
                    <tr>
                      {csvHeaders.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.slice(0, 10).map((row, i) => (
                      <tr key={i}>
                        {csvHeaders.map((h) => (
                          <td key={h}>{row[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {csvRows.length > 10 && (
                <p style={{ fontSize: 13, color: "#6b7280", margin: "8px 0 0" }}>
                  Showing first 10 of {csvRows.length.toLocaleString()} rows
                </p>
              )}

              {/* Ecom data breakdown panel */}
              {ecomBreakdown && ecomBreakdown.hasOrderGrouping && (
                <div className="data-ecom-breakdown">
                  <div className="data-ecom-breakdown-title">Data Breakdown</div>
                  <div className="data-ecom-breakdown-flow">
                    <div className="data-ecom-breakdown-stat">
                      <div className="data-ecom-breakdown-value">{ecomBreakdown.totalRows.toLocaleString()}</div>
                      <div className="data-ecom-breakdown-label">CSV rows (line items)</div>
                    </div>
                    <div className="data-ecom-breakdown-arrow">→</div>
                    <div className="data-ecom-breakdown-stat">
                      <div className="data-ecom-breakdown-value">{ecomBreakdown.uniqueOrders.toLocaleString()}</div>
                      <div className="data-ecom-breakdown-label">unique orders</div>
                    </div>
                    <div className="data-ecom-breakdown-arrow">→</div>
                    <div className="data-ecom-breakdown-stat">
                      <div className="data-ecom-breakdown-value">{ecomBreakdown.uniqueCustomers.toLocaleString()}</div>
                      <div className="data-ecom-breakdown-label">unique customers</div>
                    </div>
                  </div>
                  {ecomBreakdown.rowsNoEmail > 0 && (
                    <div className="data-ecom-breakdown-note">
                      {ecomBreakdown.rowsNoEmail.toLocaleString()} rows have no email — these orders will import without a customer link
                    </div>
                  )}
                  <div className="data-ecom-breakdown-note" style={{ opacity: 0.6 }}>
                    Multiple rows per order (line items) will be grouped into a single order record with a line_items array.
                  </div>
                </div>
              )}

              <div className="data-wizard-actions">
                <button className="btn" onClick={resetWizard}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={goToMapping}>
                  Map Fields →
                </button>
              </div>
            </div>
          )}

          {/* Map Fields */}
          {step === "map" && (
            <div>
              {/* Header with stats + progress + actions */}
              <div className="data-map-header">
                <div className="data-map-stats">
                  {standardMappedCount > 0 && (
                    <span className="data-map-stat data-map-stat-green">
                      <span className="data-map-stat-dot" />
                      {standardMappedCount} mapped
                    </span>
                  )}
                  {customMappedCount > 0 && (
                    <span className="data-map-stat data-map-stat-blue">
                      <span className="data-map-stat-dot" />
                      {customMappedCount} custom
                    </span>
                  )}
                  {skippedCount > 0 && (
                    <span className="data-map-stat data-map-stat-gray">
                      <span className="data-map-stat-dot" />
                      {skippedCount} skipped
                    </span>
                  )}
                  {unmappedRequired.length > 0 && (
                    <span className="data-map-stat data-map-stat-red">
                      Missing: {unmappedRequired.map((f) => f.label).join(", ")}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                  {/* Skip all unmapped columns at once */}
                  {(() => {
                    const unmappedCount = csvHeaders.filter((h) => !mappings[h] && !skippedCols.has(h)).length;
                    return unmappedCount > 0 ? (
                      <button
                        className="btn btn-sm"
                        style={{ fontSize: 11, padding: "3px 10px", background: "var(--bg-danger, #4a2020)", color: "var(--text-primary, #eee)", border: "1px solid var(--border-danger, #6b3030)" }}
                        onClick={() => {
                          setSkippedCols((prev) => {
                            const next = new Set(prev);
                            csvHeaders.forEach((h) => { if (!mappings[h]) next.add(h); });
                            return next;
                          });
                        }}
                      >
                        ✕ Skip {unmappedCount} unmapped
                      </button>
                    ) : null;
                  })()}
                  {/* Show skipped count + restore */}
                  {skippedCols.size > 0 && (
                    <button
                      className="btn btn-sm"
                      style={{ fontSize: 11, padding: "3px 10px", opacity: 0.7 }}
                      onClick={() => setSkippedCols(new Set())}
                    >
                      Show {skippedCols.size} hidden columns
                    </button>
                  )}
                  <div className="data-map-progress-wrap" style={{ flex: 1 }}>
                    <div className="data-map-progress">
                      <div
                        className="data-map-progress-fill"
                        style={{ width: `${csvHeaders.length > 0 ? (mappedCount / csvHeaders.length) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Card list */}
              <div className="data-map-list">
                {csvHeaders.filter((h) => !skippedCols.has(h)).map((h) => {
                  const val = mappings[h] || "";
                  const info = getMappingInfo(val);
                  const isCreating = creatingFieldFor === h;
                  const isCustom = val.startsWith("custom:");
                  const isMapped = !!val;
                  const cardColor = isCreating ? "amber" : isCustom ? "blue" : isMapped ? "green" : "gray";
                  const iconColor = isCreating ? "amber" : isCustom ? "blue" : isMapped ? "green" : "gray";
                  const sample = csvRows[0]?.[h] || "";

                  return (
                    <React.Fragment key={h}>
                      <div className={`data-map-card data-map-card-${cardColor}`}>
                        {/* Status icon */}
                        <div className={`data-map-card-icon data-map-card-icon-${iconColor}`}>
                          {isCreating ? "+" : isMapped ? info.icon : "–"}
                        </div>

                        {/* Source column */}
                        <div className="data-map-card-source">
                          <div className="data-map-card-col">{h}</div>
                          {sample && (
                            <div className="data-map-card-sample">
                              e.g. &ldquo;{sample.length > 32 ? sample.slice(0, 32) + "..." : sample}&rdquo;
                            </div>
                          )}
                        </div>

                        {/* Arrow */}
                        <div className="data-map-card-arrow">→</div>

                        {/* Target tag + dropdown */}
                        <div className="data-map-card-target" ref={openDropdown === h ? dropdownRef : undefined}>
                          <div
                            className={`data-map-tag data-map-tag-${isMapped ? info.color : "placeholder"}`}
                            onClick={() => { setOpenDropdown(openDropdown === h ? null : h); if (openDropdown === h) setMapSearch(""); }}
                          >
                            {isMapped ? info.label : "Select field..."}
                            <span className={`data-map-tag-chevron ${openDropdown === h ? "data-map-tag-chevron-open" : ""}`}>
                              ▾
                            </span>
                          </div>

                          {/* Dropdown panel */}
                          {openDropdown === h && (
                            <div className="data-map-dropdown">
                              {/* Search within dropdown */}
                              <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-secondary, #333)" }}>
                                <input
                                  className="crm-input"
                                  type="text"
                                  placeholder="Search fields..."
                                  value={mapSearch}
                                  onChange={(e) => setMapSearch(e.target.value)}
                                  autoFocus
                                  style={{ width: "100%", fontSize: 12, padding: "4px 8px" }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                              <div className="data-map-dropdown-scroll">
                                {/* Skip option */}
                                {(!mapSearch.trim() || "skip".includes(mapSearch.toLowerCase())) && (
                                <div
                                  className="data-map-dropdown-skip"
                                  onClick={() => {
                                    setMappings((prev) => ({ ...prev, [h]: "" }));
                                    setOpenDropdown(null);
                                    setMapSearch("");
                                    if (creatingFieldFor === h) setCreatingFieldFor(null);
                                  }}
                                >
                                  — Skip this column
                                </div>
                                )}

                                {/* Standard fields */}
                                {(() => {
                                  const q = mapSearch.toLowerCase().trim();
                                  const filtered = (TARGET_FIELDS[targetTable] || []).filter((f) =>
                                    !q || f.field.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
                                  );
                                  if (filtered.length === 0 && q) return null;
                                  return (<>
                                <div className="data-map-dropdown-section">Standard Fields</div>
                                {filtered.map((f) => (
                                  <div
                                    key={f.field}
                                    className={`data-map-dropdown-item ${val === f.field ? "data-map-dropdown-item-active" : ""}`}
                                    onClick={() => {
                                      setMappings((prev) => ({ ...prev, [h]: f.field }));
                                      setMapSearch("");
                                      setOpenDropdown(null);
                                      if (creatingFieldFor === h) setCreatingFieldFor(null);
                                    }}
                                  >
                                    <span>
                                      {f.label}
                                      {f.required && <span className="data-map-dropdown-item-req">REQ</span>}
                                    </span>
                                    {val === f.field && <span className="data-map-dropdown-item-check">✓</span>}
                                  </div>
                                ))}
                                  </>);
                                })()}

                                {/* Custom fields */}
                                {supportsCustomFields && customFields.length > 0 && (
                                  <>
                                    <div className="data-map-dropdown-section">Custom Fields</div>
                                    {customFields.map((cf) => {
                                      const cfVal = `custom:${cf.field_key}`;
                                      return (
                                        <div
                                          key={cf.field_key}
                                          className={`data-map-dropdown-item ${val === cfVal ? "data-map-dropdown-item-active" : ""}`}
                                          onClick={() => {
                                            setMappings((prev) => ({ ...prev, [h]: cfVal }));
                                            setOpenDropdown(null);
                                            if (creatingFieldFor === h) setCreatingFieldFor(null);
                                          }}
                                        >
                                          <span>{cf.field_label} <span style={{ opacity: 0.5, fontSize: 11 }}>({cf.field_type})</span></span>
                                          {val === cfVal && <span className="data-map-dropdown-item-check">✓</span>}
                                        </div>
                                      );
                                    })}
                                  </>
                                )}
                              </div>

                              {/* Create custom field action */}
                              {supportsCustomFields && (
                                <div
                                  className="data-map-dropdown-create"
                                  onClick={() => {
                                    setCreatingFieldFor(h);
                                    setNewFieldLabel(h);
                                    setNewFieldType("text");
                                    setMappings((prev) => ({ ...prev, [h]: "" }));
                                    setOpenDropdown(null);
                                  }}
                                >
                                  + Create Custom Field
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Dismiss / skip column button */}
                        <button
                          className="data-map-card-dismiss"
                          title="Skip this column"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMappings((prev) => ({ ...prev, [h]: "" }));
                            setSkippedCols((prev) => { const next = new Set(prev); next.add(h); return next; });
                            if (creatingFieldFor === h) setCreatingFieldFor(null);
                          }}
                        >
                          ✕
                        </button>
                      </div>

                      {/* Create custom field panel */}
                      {isCreating && (
                        <div className="data-map-create-panel">
                          <div className="data-map-create-row">
                            <input
                              className="crm-input"
                              type="text"
                              placeholder="Field name"
                              value={newFieldLabel}
                              onChange={(e) => setNewFieldLabel(e.target.value)}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && newFieldLabel.trim()) handleCreateCustomField(h);
                                if (e.key === "Escape") setCreatingFieldFor(null);
                              }}
                            />
                            <div className="data-map-type-chips">
                              {TYPE_CHIPS.map((tc) => (
                                <div
                                  key={tc.type}
                                  className={`data-map-type-chip ${newFieldType === tc.type ? "data-map-type-chip-active" : ""}`}
                                  onClick={() => setNewFieldType(tc.type)}
                                  title={tc.label}
                                >
                                  {tc.icon}
                                </div>
                              ))}
                            </div>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleCreateCustomField(h)}
                              disabled={!newFieldLabel.trim() || creatingField}
                            >
                              {creatingField ? "..." : "Create"}
                            </button>
                            <button
                              className="btn btn-sm"
                              onClick={() => setCreatingFieldFor(null)}
                              style={{ padding: "4px 8px", fontSize: 12 }}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              <div className="data-wizard-actions">
                <button className="btn" onClick={() => setStep("preview")}>
                  ← Back
                </button>
                <button
                  className="btn btn-primary"
                  onClick={executeImport}
                  disabled={mappedCount === 0 || unmappedRequired.length > 0}
                >
                  Import {csvRows.length.toLocaleString()} Rows
                </button>
              </div>
            </div>
          )}

          {/* Importing */}
          {step === "importing" && (
            <div className="data-importing">
              <div className="data-progress-text">
                Importing row {progress.done.toLocaleString()} of{" "}
                {progress.total.toLocaleString()}...
              </div>
              <div className="data-progress-bar">
                <div
                  className="data-progress-fill"
                  style={{
                    width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              {progress.errors > 0 && (
                <div style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>
                  {progress.errors} errors so far
                </div>
              )}
            </div>
          )}

          {/* Results */}
          {step === "results" && (
            <div className="data-results">
              <div className="data-results-summary">
                {ecomStats ? (
                  <>
                    <div className="data-results-stat data-results-stat-success">
                      <div className="data-results-stat-value">{ecomStats.customers.toLocaleString()}</div>
                      <div className="data-results-stat-label">Customers</div>
                    </div>
                    <div className="data-results-stat data-results-stat-success">
                      <div className="data-results-stat-value">{ecomStats.orders.toLocaleString()}</div>
                      <div className="data-results-stat-label">Orders</div>
                    </div>
                    <div className="data-results-stat">
                      <div className="data-results-stat-value">{csvRows.length.toLocaleString()}</div>
                      <div className="data-results-stat-label">CSV Rows</div>
                    </div>
                    {ecomStats.skippedNoEmail > 0 && (
                      <div className="data-results-stat" style={{ opacity: 0.7 }}>
                        <div className="data-results-stat-value">{ecomStats.skippedNoEmail.toLocaleString()}</div>
                        <div className="data-results-stat-label">Rows without email (imported unlinked)</div>
                      </div>
                    )}
                    {progress.errors > 0 && (
                      <div className="data-results-stat data-results-stat-error">
                        <div className="data-results-stat-value">{progress.errors.toLocaleString()}</div>
                        <div className="data-results-stat-label">Errors</div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="data-results-stat data-results-stat-success">
                      <div className="data-results-stat-value">{(progress.total - progress.errors).toLocaleString()}</div>
                      <div className="data-results-stat-label">Rows Imported</div>
                    </div>
                    {progress.errors > 0 && (
                      <div className="data-results-stat data-results-stat-error">
                        <div className="data-results-stat-value">{progress.errors.toLocaleString()}</div>
                        <div className="data-results-stat-label">Errors</div>
                      </div>
                    )}
                    <div className="data-results-stat">
                      <div className="data-results-stat-value">{progress.total.toLocaleString()}</div>
                      <div className="data-results-stat-label">Total Rows</div>
                    </div>
                  </>
                )}
              </div>

              {importErrors.length > 0 && (
                <div className="data-results-errors">
                  <h4 style={{ margin: "0 0 8px" }}>Errors</h4>
                  {importErrors.slice(0, 20).map((err, i) => (
                    <div key={i} className="data-results-error-row">
                      <span style={{ color: "#dc2626", fontWeight: 600 }}>Row {err.row}</span>: {err.message}
                    </div>
                  ))}
                  {importErrors.length > 20 && (
                    <p style={{ color: "#6b7280", fontSize: 13 }}>
                      ...and {importErrors.length - 20} more errors
                    </p>
                  )}
                </div>
              )}

              <div className="data-wizard-actions">
                <button className="btn" onClick={resetWizard}>
                  Import Another
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    resetWizard();
                    if (targetTable.startsWith("ecom_")) {
                      window.location.href = "/explorer?entity=customers";
                    } else {
                      const tabMap: Record<string, string> = {
                        crm_contacts: "contacts",
                        crm_companies: "companies",
                        crm_deals: "deals",
                        crm_products: "products",
                      };
                      window.location.href = targetTable === "crm_products"
                        ? "/organization/products"
                        : `/crm?tab=${tabMap[targetTable] || "contacts"}`;
                    }
                  }}
                >
                  {targetTable.startsWith("ecom_") ? "View in Explorer →" : "View in CRM →"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── Import History ── */
        <div>
          <div className="data-toolbar">
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Import History</h3>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowWizard(true)}
            >
              + New Import
            </button>
          </div>

          {loadingHistory ? (
            <div className="data-empty">Loading...</div>
          ) : imports.length === 0 ? (
            <div className="data-empty">
              <p>No imports yet</p>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowWizard(true)}
              >
                Import your first CSV
              </button>
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Rows</th>
                    <th>Errors</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((imp) => {
                    const sc = statusColor(imp.status);
                    return (
                      <tr key={imp.id}>
                        <td style={{ fontWeight: 500 }}>{imp.source_name || "—"}</td>
                        <td>{imp.target_table.replace("crm_", "").replace(/_/g, " ")}</td>
                        <td>
                          <span
                            className="data-status-badge"
                            style={{ backgroundColor: sc.bg, color: sc.fg }}
                          >
                            {imp.status}
                          </span>
                        </td>
                        <td>
                          {imp.imported_rows}/{imp.total_rows}
                        </td>
                        <td style={{ color: imp.error_rows > 0 ? "#dc2626" : undefined }}>
                          {imp.error_rows}
                        </td>
                        <td style={{ color: "#6b7280", fontSize: 13 }}>{fmtDate(imp.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
