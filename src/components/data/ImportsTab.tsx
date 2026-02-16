"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import type { DataImport } from "@/lib/types/database";

/* ── CSV Parser ──────────────────────────────────────────── */

function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] ?? "";
    });
    return obj;
  });
  return { headers, rows };
}

/* ── Target table field definitions ──────────────────────── */

const TARGET_TABLES: { key: string; label: string }[] = [
  { key: "crm_contacts", label: "CRM Contacts" },
  { key: "crm_companies", label: "CRM Companies" },
  { key: "crm_deals", label: "CRM Deals" },
  { key: "crm_products", label: "CRM Products" },
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
};

/* ── Auto-suggest mapping ────────────────────────────────── */

function suggestMapping(csvHeader: string, fields: { field: string; label: string }[]): string {
  const norm = csvHeader.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const f of fields) {
    const fNorm = f.field.replace(/_/g, "");
    const lNorm = f.label.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm === fNorm || norm === lNorm) return f.field;
    if (norm.includes(fNorm) || fNorm.includes(norm)) return f.field;
    if (norm.includes(lNorm) || lNorm.includes(norm)) return f.field;
  }
  return "";
}

/* ── Component ─────────────────────────────────────────── */

type WizardStep = "upload" | "preview" | "map" | "importing" | "results";

export default function ImportsTab() {
  const { user } = useAuth();
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
  const [importId, setImportId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [importErrors, setImportErrors] = useState<{ row: number; message: string }[]>([]);

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

  /* ── File handling ── */
  const handleFile = (file: File) => {
    if (!file.name.endsWith(".csv")) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);
      if (headers.length === 0) return;
      setCsvHeaders(headers);
      setCsvRows(rows);
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
      autoMap[h] = suggestMapping(h, fields);
    });
    setMappings(autoMap);
    setStep("map");
  };

  /* ── Execute import ── */
  const executeImport = async () => {
    if (!user) return;
    setStep("importing");
    const supabase = createClient();

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

    // Build active mappings (skip unmapped)
    const activeMappings = csvHeaders
      .filter((h) => mappings[h])
      .map((h) => ({ csv: h, field: mappings[h] }));

    // For contacts: resolve company_name → company_id
    const companyNameMapping = activeMappings.find((m) => m.field === "company_name");
    const companyCache: Record<string, string> = {}; // name → id

    if (targetTable === "crm_contacts" && companyNameMapping) {
      // Collect unique company names
      const uniqueNames = [...new Set(csvRows.map((r) => (r[companyNameMapping.csv] ?? "").trim()).filter(Boolean))];
      // Look up existing companies
      if (uniqueNames.length > 0) {
        const { data: existing } = await supabase
          .from("crm_companies")
          .select("id, name")
          .in("name", uniqueNames);
        if (existing) existing.forEach((c) => { companyCache[c.name] = c.id; });
        // Create missing companies
        const missing = uniqueNames.filter((n) => !companyCache[n]);
        for (const name of missing) {
          const { data: created } = await supabase
            .from("crm_companies")
            .insert({ user_id: user.id, name })
            .select("id")
            .single();
          if (created) companyCache[name] = created.id;
        }
      }
    }

    let imported = 0;
    let errorCount = 0;
    const errors: { row: number; message: string }[] = [];
    const BATCH = 50;

    setProgress({ done: 0, total: csvRows.length, errors: 0 });

    for (let i = 0; i < csvRows.length; i += BATCH) {
      const batch = csvRows.slice(i, i + BATCH);
      const insertRows = batch.map((row) => {
        const mapped: Record<string, unknown> = { user_id: user.id };
        for (const m of activeMappings) {
          const val = row[m.csv] ?? "";
          // Handle company_name → company_id for contacts
          if (m.field === "company_name" && targetTable === "crm_contacts") {
            const companyId = companyCache[val.trim()];
            if (companyId) mapped.company_id = companyId;
            continue; // Don't insert company_name directly
          }
          // Coerce numeric fields
          if (["value", "probability", "unit_price", "annual_revenue", "employees"].includes(m.field)) {
            const num = parseFloat(val);
            mapped[m.field] = isNaN(num) ? 0 : num;
          } else {
            mapped[m.field] = val;
          }
        }
        // Auto-set source for contacts
        if (targetTable === "crm_contacts") {
          mapped.source = "import";
        }
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
    if (fileRef.current) fileRef.current.value = "";
  };

  /* ── Computed values ── */
  const mappedCount = Object.values(mappings).filter(Boolean).length;
  const requiredFields = (TARGET_FIELDS[targetTable] || []).filter((f) => f.required);
  const unmappedRequired = requiredFields.filter(
    (rf) => !Object.values(mappings).includes(rf.field)
  );

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
              <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Supports .csv files</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
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
              <div className="data-mapping-header">
                <span>
                  {mappedCount} of {csvHeaders.length} columns mapped
                  {unmappedRequired.length > 0 && (
                    <span style={{ color: "#dc2626", marginLeft: 8 }}>
                      ⚠ Missing required: {unmappedRequired.map((f) => f.label).join(", ")}
                    </span>
                  )}
                </span>
              </div>
              <div className="data-mapping-grid">
                <div className="data-mapping-row data-mapping-row-header">
                  <div className="data-mapping-source">CSV Column</div>
                  <div className="data-mapping-arrow" />
                  <div className="data-mapping-target">Target Field</div>
                </div>
                {csvHeaders.map((h) => (
                  <div key={h} className="data-mapping-row">
                    <div className="data-mapping-source">{h}</div>
                    <div className="data-mapping-arrow">→</div>
                    <div className="data-mapping-target">
                      <select
                        className="crm-input"
                        value={mappings[h] || ""}
                        onChange={(e) =>
                          setMappings((prev) => ({ ...prev, [h]: e.target.value }))
                        }
                      >
                        <option value="">— Skip —</option>
                        {(TARGET_FIELDS[targetTable] || []).map((f) => (
                          <option key={f.field} value={f.field}>
                            {f.label} {f.required ? "*" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
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
                    const tabMap: Record<string, string> = {
                      crm_contacts: "contacts",
                      crm_companies: "companies",
                      crm_deals: "deals",
                      crm_products: "products",
                    };
                    window.location.href = targetTable === "crm_products"
                      ? "/organization/products"
                      : `/crm?tab=${tabMap[targetTable] || "contacts"}`;
                  }}
                >
                  View in CRM →
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
