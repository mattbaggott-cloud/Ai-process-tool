"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import type { CrmCustomField } from "@/lib/types/database";

interface Props {
  tableName: string;
  metadata: Record<string, unknown>;
  entityId: string;
  onUpdate?: () => void;
}

export default function CustomFieldsSection({ tableName, metadata, entityId, onUpdate }: Props) {
  const { user } = useAuth();
  const [fields, setFields] = useState<CrmCustomField[]>([]);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});

  const loadFields = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("crm_custom_fields")
      .select("*")
      .eq("table_name", tableName)
      .order("sort_order", { ascending: true });
    if (data) setFields(data as CrmCustomField[]);
  }, [user, tableName]);

  useEffect(() => {
    loadFields();
  }, [loadFields]);

  // Don't render if no custom fields are defined for this table
  if (fields.length === 0) return null;

  const handleEdit = () => {
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      values[f.field_key] = metadata?.[f.field_key] ?? "";
    }
    setEditValues(values);
    setEditing(true);
  };

  const handleSave = async () => {
    const supabase = createClient();
    // Merge with existing metadata
    const updatedMetadata = { ...(metadata || {}), ...editValues };
    const { error } = await supabase
      .from(tableName)
      .update({ metadata: updatedMetadata, updated_at: new Date().toISOString() })
      .eq("id", entityId);
    if (!error) {
      setEditing(false);
      onUpdate?.();
      window.dispatchEvent(new Event("workspace-updated"));
    }
  };

  const formatValue = (field: CrmCustomField, value: unknown): string => {
    if (value === null || value === undefined || value === "") return "—";
    switch (field.field_type) {
      case "boolean":
        return value ? "Yes" : "No";
      case "number":
        return typeof value === "number" ? value.toLocaleString() : String(value);
      case "date":
        try {
          return new Date(String(value)).toLocaleDateString("en-US", {
            month: "short", day: "numeric", year: "numeric",
          });
        } catch {
          return String(value);
        }
      default:
        return String(value);
    }
  };

  const renderInput = (field: CrmCustomField) => {
    const val = editValues[field.field_key];
    switch (field.field_type) {
      case "boolean":
        return (
          <select
            className="crm-input"
            value={val ? "true" : "false"}
            onChange={(e) =>
              setEditValues((prev) => ({ ...prev, [field.field_key]: e.target.value === "true" }))
            }
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        );
      case "number":
        return (
          <input
            className="crm-input"
            type="number"
            value={val === null || val === undefined ? "" : String(val)}
            onChange={(e) =>
              setEditValues((prev) => ({
                ...prev,
                [field.field_key]: e.target.value ? parseFloat(e.target.value) : null,
              }))
            }
          />
        );
      case "date":
        return (
          <input
            className="crm-input"
            type="date"
            value={String(val || "")}
            onChange={(e) =>
              setEditValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))
            }
          />
        );
      case "select":
        return (
          <select
            className="crm-input"
            value={String(val || "")}
            onChange={(e) =>
              setEditValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))
            }
          >
            <option value="">— Select —</option>
            {(field.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      default:
        return (
          <input
            className="crm-input"
            type="text"
            value={String(val || "")}
            onChange={(e) =>
              setEditValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))
            }
          />
        );
    }
  };

  return (
    <div className="crm-detail-section crm-custom-fields-section">
      <div className="crm-custom-fields-header">
        <h3 className="crm-detail-section-title" style={{ marginBottom: 0 }}>Custom Fields</h3>
        {!editing ? (
          <button className="btn btn-sm" onClick={handleEdit}>Edit</button>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
            <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="crm-custom-fields-edit">
          {fields.map((f) => (
            <div key={f.field_key} className="crm-custom-field-edit-row">
              <label className="crm-field-label">{f.field_label}</label>
              {renderInput(f)}
            </div>
          ))}
        </div>
      ) : (
        <div className="crm-detail-fields">
          {fields.map((f) => {
            const value = metadata?.[f.field_key];
            return (
              <div key={f.field_key} className="crm-detail-field">
                <span className="crm-field-label">{f.field_label}</span>
                <span>{formatValue(f, value)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
