"use client";

import React, { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DataConnector, HubSpotConfig } from "@/lib/types/database";

/* ── Default mappings ───────────────────────────────────── */

const DEFAULT_CONTACT_MAP: Record<string, string> = {
  firstname: "first_name",
  lastname: "last_name",
  email: "email",
  phone: "phone",
  jobtitle: "title",
};

const DEFAULT_COMPANY_MAP: Record<string, string> = {
  name: "name",
  domain: "domain",
  industry: "industry",
  numberofemployees: "employees",
  annualrevenue: "annual_revenue",
  description: "description",
  phone: "phone",
};

const DEFAULT_DEAL_MAP: Record<string, string> = {
  dealname: "title",
  amount: "value",
  closedate: "expected_close_date",
};

/* ── Available target fields ────────────────────────────── */

const CONTACT_FIELDS = [
  "first_name", "last_name", "email", "phone", "title", "status", "notes", "tags",
];

const COMPANY_FIELDS = [
  "name", "domain", "industry", "size", "description", "website", "phone",
  "address", "annual_revenue", "employees", "sector", "sic_code",
];

const DEAL_FIELDS = [
  "title", "value", "currency", "stage", "probability", "expected_close_date",
  "notes", "next_steps",
];

/* ── Component ─────────────────────────────────────────── */

interface Props {
  connector: DataConnector;
  onClose: () => void;
  onSave: () => void;
}

export default function HubSpotFieldMappingModal({ connector, onClose, onSave }: Props) {
  const supabase = createClient();
  const config = connector.config as unknown as HubSpotConfig;

  const [contactMap, setContactMap] = useState<Record<string, string>>(
    config.field_mappings?.contacts || { ...DEFAULT_CONTACT_MAP }
  );
  const [companyMap, setCompanyMap] = useState<Record<string, string>>(
    config.field_mappings?.companies || { ...DEFAULT_COMPANY_MAP }
  );
  const [dealMap, setDealMap] = useState<Record<string, string>>(
    config.field_mappings?.deals || { ...DEFAULT_DEAL_MAP }
  );
  const [saving, setSaving] = useState(false);
  const [newHsProp, setNewHsProp] = useState({ contacts: "", companies: "", deals: "" });

  const handleSave = async () => {
    setSaving(true);
    try {
      const updatedConfig = {
        ...config,
        field_mappings: {
          contacts: contactMap,
          companies: companyMap,
          deals: dealMap,
        },
      };

      await supabase
        .from("data_connectors")
        .update({ config: updatedConfig, updated_at: new Date().toISOString() })
        .eq("id", connector.id);

      onSave();
      onClose();
    } catch (err) {
      console.error("Error saving field mappings:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setContactMap({ ...DEFAULT_CONTACT_MAP });
    setCompanyMap({ ...DEFAULT_COMPANY_MAP });
    setDealMap({ ...DEFAULT_DEAL_MAP });
  };

  const renderMappingSection = (
    title: string,
    sectionKey: "contacts" | "companies" | "deals",
    mapping: Record<string, string>,
    setMapping: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    targetFields: string[]
  ) => (
    <div className="hubspot-mapping-section">
      <h4 className="hubspot-mapping-section-title">{title}</h4>
      <div className="hubspot-mapping-grid">
        <div className="hubspot-mapping-header">
          <span>HubSpot Property</span>
          <span></span>
          <span>Local Field</span>
          <span></span>
        </div>
        {Object.entries(mapping).map(([hsProp, localField]) => (
          <div key={hsProp} className="hubspot-mapping-row">
            <span className="hubspot-mapping-hs-prop">{hsProp}</span>
            <span className="hubspot-mapping-arrow">&rarr;</span>
            <select
              className="hubspot-mapping-select"
              value={localField}
              onChange={(e) => {
                setMapping((prev) => ({ ...prev, [hsProp]: e.target.value }));
              }}
            >
              <option value="">-- Skip --</option>
              {targetFields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <button
              className="hubspot-mapping-remove"
              title="Remove mapping"
              onClick={() => {
                setMapping((prev) => {
                  const next = { ...prev };
                  delete next[hsProp];
                  return next;
                });
              }}
            >
              &times;
            </button>
          </div>
        ))}
        {/* Add new mapping */}
        <div className="hubspot-mapping-row hubspot-mapping-add">
          <input
            type="text"
            className="hubspot-mapping-input"
            placeholder="HubSpot property..."
            value={newHsProp[sectionKey]}
            onChange={(e) => setNewHsProp((prev) => ({ ...prev, [sectionKey]: e.target.value }))}
          />
          <span className="hubspot-mapping-arrow">&rarr;</span>
          <select
            className="hubspot-mapping-select"
            defaultValue=""
            onChange={(e) => {
              const hs = newHsProp[sectionKey].trim();
              if (hs && e.target.value) {
                setMapping((prev) => ({ ...prev, [hs]: e.target.value }));
                setNewHsProp((prev) => ({ ...prev, [sectionKey]: "" }));
                e.target.value = "";
              }
            }}
          >
            <option value="" disabled>Add mapping...</option>
            {targetFields.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <span />
        </div>
      </div>
    </div>
  );

  return (
    <div className="hubspot-modal-overlay" onClick={onClose}>
      <div className="hubspot-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hubspot-modal-header">
          <h3>HubSpot Field Mapping</h3>
          <button className="hubspot-modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="hubspot-modal-body">
          <p className="hubspot-modal-desc">
            Configure how HubSpot properties map to your local CRM fields. Changes apply to future syncs.
          </p>

          {renderMappingSection("Contacts", "contacts", contactMap, setContactMap, CONTACT_FIELDS)}
          {renderMappingSection("Companies", "companies", companyMap, setCompanyMap, COMPANY_FIELDS)}
          {renderMappingSection("Deals", "deals", dealMap, setDealMap, DEAL_FIELDS)}
        </div>

        <div className="hubspot-modal-footer">
          <button className="btn btn-sm" onClick={handleReset}>Reset Defaults</button>
          <div className="hubspot-modal-footer-right">
            <button className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Mappings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
