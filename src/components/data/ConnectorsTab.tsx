"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DataConnector } from "@/lib/types/database";
import HubSpotConnectorCard from "./HubSpotConnectorCard";
import HubSpotFieldMappingModal from "./HubSpotFieldMappingModal";
import ShopifyConnectorCard from "./ShopifyConnectorCard";

/* ── Static connector registry ──────────────────────────── */

interface ConnectorDef {
  type: string;
  name: string;
  description: string;
  status: "available" | "coming_soon";
  category: "import" | "ecommerce" | "crm" | "email" | "spreadsheets" | "storage" | "analytics" | "marketing" | "productivity";
  icon: React.ReactNode;
}

const CONNECTORS: ConnectorDef[] = [
  // ── Import ──
  {
    type: "csv",
    name: "CSV Import",
    description: "Upload CSV files and map fields to your CRM tables",
    status: "available",
    category: "import",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h8M8 9h2" />
      </svg>
    ),
  },

  // ── E-Commerce ──
  {
    type: "shopify",
    name: "Shopify",
    description: "Sync customers, orders, and products from your Shopify store",
    status: "available",
    category: "ecommerce",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15.5 3.5L14.5 2.5C14.3 2.3 14 2.2 13.7 2.3L12 3L10 2L7.5 3.5V15L12 22L16.5 15V3.5H15.5Z" />
        <path d="M12 3V22" />
      </svg>
    ),
  },

  // ── CRM ──
  {
    type: "salesforce",
    name: "Salesforce",
    description: "Sync contacts, accounts, and opportunities from Salesforce CRM",
    status: "coming_soon",
    category: "crm",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z" />
        <path d="M8 12c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4" />
      </svg>
    ),
  },
  {
    type: "dynamics",
    name: "Microsoft Dynamics",
    description: "Sync accounts, contacts, and opportunities from Dynamics 365",
    status: "coming_soon",
    category: "crm",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="8" height="8" rx="1" />
        <rect x="13" y="3" width="8" height="8" rx="1" />
        <rect x="3" y="13" width="8" height="8" rx="1" />
        <rect x="13" y="13" width="8" height="8" rx="1" />
      </svg>
    ),
  },
  {
    type: "pipedrive",
    name: "Pipedrive",
    description: "Sync deals, contacts, and organizations from Pipedrive",
    status: "coming_soon",
    category: "crm",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    type: "zoho",
    name: "Zoho CRM",
    description: "Import leads, contacts, accounts, and deals from Zoho CRM",
    status: "coming_soon",
    category: "crm",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7l8-4 8 4-8 4-8-4Z" />
        <path d="M4 12l8 4 8-4" />
        <path d="M4 17l8 4 8-4" />
      </svg>
    ),
  },

  // ── Email & Calendar ──
  {
    type: "gmail",
    name: "Gmail",
    description: "Sync email conversations and auto-log communications to contacts",
    status: "coming_soon",
    category: "email",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M22 4L12 13 2 4" />
      </svg>
    ),
  },
  {
    type: "outlook",
    name: "Outlook / Office 365",
    description: "Sync email, calendar events, and contacts from Microsoft 365",
    status: "coming_soon",
    category: "email",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M2 8l10 5 10-5" />
        <line x1="2" y1="20" x2="8" y2="14" />
        <line x1="22" y1="20" x2="16" y2="14" />
      </svg>
    ),
  },
  {
    type: "google_calendar",
    name: "Google Calendar",
    description: "Sync meetings and events, auto-log activities to CRM records",
    status: "coming_soon",
    category: "email",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <rect x="8" y="14" width="3" height="3" rx="0.5" />
      </svg>
    ),
  },

  // ── Spreadsheets ──
  {
    type: "google_sheets",
    name: "Google Sheets",
    description: "Import and sync data from Google Sheets spreadsheets",
    status: "coming_soon",
    category: "spreadsheets",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="16" y2="17" />
        <line x1="12" y1="9" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    type: "excel",
    name: "Microsoft Excel",
    description: "Import data from Excel files and OneDrive spreadsheets",
    status: "coming_soon",
    category: "spreadsheets",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M8 12l3 4M8 16l3-4" />
        <line x1="14" y1="12" x2="16" y2="12" />
        <line x1="14" y1="16" x2="16" y2="16" />
      </svg>
    ),
  },
  {
    type: "airtable",
    name: "Airtable",
    description: "Sync bases and tables from Airtable into your workspace",
    status: "coming_soon",
    category: "spreadsheets",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="3" y1="15" x2="21" y2="15" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </svg>
    ),
  },

  // ── Cloud Storage ──
  {
    type: "google_drive",
    name: "Google Drive",
    description: "Import documents, PDFs, and files from Google Drive",
    status: "coming_soon",
    category: "storage",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 19.5h20L12 2Z" />
        <path d="M7.5 12.5h9" />
        <path d="M2 19.5l5-9" />
        <path d="M22 19.5l-5-9" />
      </svg>
    ),
  },
  {
    type: "sharepoint",
    name: "SharePoint",
    description: "Import documents and lists from Microsoft SharePoint",
    status: "coming_soon",
    category: "storage",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16v16H4z" />
        <path d="M4 9h16M9 4v16" />
      </svg>
    ),
  },
  {
    type: "dropbox",
    name: "Dropbox",
    description: "Import files and documents from your Dropbox account",
    status: "coming_soon",
    category: "storage",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l-7 4.5L12 11l7-4.5L12 2Z" />
        <path d="M5 6.5L12 11l7-4.5" />
        <path d="M5 11.5L12 16l7-4.5" />
        <path d="M5 16.5L12 21l7-4.5" />
      </svg>
    ),
  },

  // ── Analytics ──
  {
    type: "google_analytics",
    name: "Google Analytics",
    description: "Import website traffic and conversion data for reporting",
    status: "coming_soon",
    category: "analytics",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    type: "mixpanel",
    name: "Mixpanel",
    description: "Import product analytics and user behavior data",
    status: "coming_soon",
    category: "analytics",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },

  // ── Marketing ──
  {
    type: "mailchimp",
    name: "Mailchimp",
    description: "Sync email lists, campaigns, and subscriber data",
    status: "coming_soon",
    category: "marketing",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <path d="M22 6l-10 7L2 6" />
      </svg>
    ),
  },
  {
    type: "linkedin",
    name: "LinkedIn",
    description: "Import leads and company data from LinkedIn Sales Navigator",
    status: "coming_soon",
    category: "marketing",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
        <rect x="2" y="9" width="4" height="12" />
        <circle cx="4" cy="4" r="2" />
      </svg>
    ),
  },

  {
    type: "klaviyo",
    name: "Klaviyo",
    description: "Sync customer segments, email flows, and campaign performance data",
    status: "coming_soon",
    category: "marketing",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12l10 8 10-8" />
        <path d="M2 12l10-8 10 8" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    ),
  },
  {
    type: "attentive",
    name: "Attentive",
    description: "Sync SMS subscriber lists, campaigns, and engagement metrics",
    status: "coming_soon",
    category: "marketing",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <line x1="12" y1="18" x2="12" y2="18.01" />
        <path d="M9 7h6M9 11h6" />
      </svg>
    ),
  },

  // ── Productivity ──
  {
    type: "slack",
    name: "Slack",
    description: "Get CRM notifications in Slack and log conversations",
    status: "coming_soon",
    category: "productivity",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z" />
        <path d="M20.5 10H19v-1.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
        <path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z" />
        <path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z" />
        <path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z" />
        <path d="M14 20.5c0-.83.67-1.5 1.5-1.5h0c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h0c-.83 0-1.5-.67-1.5-1.5z" />
        <path d="M10 9.5C10 10.33 9.33 11 8.5 11h-5C2.67 11 2 10.33 2 9.5S2.67 8 3.5 8h5c.83 0 1.5.67 1.5 1.5z" />
        <path d="M8.5 5c.83 0 1.5-.67 1.5-1.5S9.33 2 8.5 2 7 2.67 7 3.5 7.67 5 8.5 5z" />
      </svg>
    ),
  },
  {
    type: "notion",
    name: "Notion",
    description: "Import databases and pages from your Notion workspace",
    status: "coming_soon",
    category: "productivity",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
        <path d="M7 8h4M7 12h10M7 16h7" />
      </svg>
    ),
  },
  {
    type: "zapier",
    name: "Zapier",
    description: "Connect to 5,000+ apps through Zapier automations",
    status: "coming_soon",
    category: "productivity",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  import: "Import",
  ecommerce: "E-Commerce",
  crm: "CRM Platforms",
  email: "Email & Calendar",
  spreadsheets: "Spreadsheets & Databases",
  storage: "Cloud Storage",
  analytics: "Analytics",
  marketing: "Marketing",
  productivity: "Productivity & Automation",
};

const CATEGORY_ORDER = ["import", "ecommerce", "crm", "email", "spreadsheets", "storage", "analytics", "marketing", "productivity"];

const statusBadge = (status: string) => {
  if (status === "available") {
    return (
      <span className="data-status-badge" style={{ backgroundColor: "rgba(5,150,105,0.1)", color: "#059669", borderColor: "rgba(5,150,105,0.2)" }}>
        Available
      </span>
    );
  }
  return (
    <span className="data-status-badge" style={{ backgroundColor: "rgba(107,114,128,0.1)", color: "#6b7280", borderColor: "rgba(107,114,128,0.2)" }}>
      Coming Soon
    </span>
  );
};

/* ── Component ─────────────────────────────────────────── */

interface Props {
  onNavigate: (tab: "connectors" | "imports" | "sync-log") => void;
}

export default function ConnectorsTab({ onNavigate }: Props) {
  const supabase = createClient();
  const [hubspotConnector, setHubspotConnector] = useState<DataConnector | null>(null);
  const [shopifyConnector, setShopifyConnector] = useState<DataConnector | null>(null);
  const [showFieldMapping, setShowFieldMapping] = useState(false);

  const loadConnectors = useCallback(async () => {
    const { data } = await supabase
      .from("data_connectors")
      .select("*")
      .in("connector_type", ["hubspot", "shopify"]);

    const connectors = (data || []) as DataConnector[];
    setHubspotConnector(connectors.find((c) => c.connector_type === "hubspot") || null);
    setShopifyConnector(connectors.find((c) => c.connector_type === "shopify") || null);
  }, [supabase]);

  useEffect(() => {
    loadConnectors();
  }, [loadConnectors]);

  // Group connectors by category
  const connectorsByCategory: Record<string, ConnectorDef[]> = {};
  for (const c of CONNECTORS) {
    if (!connectorsByCategory[c.category]) connectorsByCategory[c.category] = [];
    connectorsByCategory[c.category].push(c);
  }

  return (
    <div className="data-tab-content">
      {CATEGORY_ORDER.map((cat) => {
        const connectors = connectorsByCategory[cat];
        if (!connectors || connectors.length === 0) return null;

        return (
          <div key={cat} className="connector-category-section">
            <h3 className="connector-category-title">{CATEGORY_LABELS[cat]}</h3>
            <div className="data-connector-grid">
              {/* Render CSV card */}
              {cat === "import" && connectors.filter((c) => c.type === "csv").map((c) => (
                <div key={c.type} className="data-connector-card">
                  <div className="data-connector-icon">{c.icon}</div>
                  <div className="data-connector-body">
                    <div className="data-connector-name">{c.name}</div>
                    <div className="data-connector-desc">{c.description}</div>
                  </div>
                  <div className="data-connector-footer">
                    {statusBadge(c.status)}
                    <button className="btn btn-primary btn-sm" onClick={() => onNavigate("imports")}>
                      Import CSV
                    </button>
                  </div>
                </div>
              ))}

              {/* Render Shopify in the E-Commerce section */}
              {cat === "ecommerce" && (
                <ShopifyConnectorCard
                  connector={shopifyConnector}
                  onRefresh={loadConnectors}
                />
              )}

              {/* Render HubSpot in the CRM section */}
              {cat === "crm" && (
                <HubSpotConnectorCard
                  connector={hubspotConnector}
                  onRefresh={loadConnectors}
                  onConfigure={() => setShowFieldMapping(true)}
                />
              )}

              {/* Render all other connectors as coming soon cards */}
              {connectors
                .filter((c) => c.type !== "csv") // csv already rendered
                .map((c) => (
                  <div
                    key={c.type}
                    className="data-connector-card data-connector-card-disabled"
                  >
                    <div className="data-connector-icon">{c.icon}</div>
                    <div className="data-connector-body">
                      <div className="data-connector-name">{c.name}</div>
                      <div className="data-connector-desc">{c.description}</div>
                    </div>
                    <div className="data-connector-footer">
                      {statusBadge("coming_soon")}
                      <button className="btn btn-sm" disabled>Connect</button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        );
      })}

      {/* Field mapping modal */}
      {showFieldMapping && hubspotConnector && (
        <HubSpotFieldMappingModal
          connector={hubspotConnector}
          onClose={() => setShowFieldMapping(false)}
          onSave={loadConnectors}
        />
      )}
    </div>
  );
}
