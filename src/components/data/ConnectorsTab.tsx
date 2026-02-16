"use client";

import React from "react";

/* ── Static connector registry ──────────────────────────── */

interface ConnectorDef {
  type: string;
  name: string;
  description: string;
  status: "available" | "coming_soon";
  icon: React.ReactNode;
}

const CONNECTORS: ConnectorDef[] = [
  {
    type: "csv",
    name: "CSV Import",
    description: "Upload CSV files and map fields to your CRM tables",
    status: "available",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h8M8 9h2" />
      </svg>
    ),
  },
  {
    type: "salesforce",
    name: "Salesforce",
    description: "Sync contacts, accounts, and opportunities from Salesforce CRM",
    status: "coming_soon",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z" />
        <path d="M8 12c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4" />
      </svg>
    ),
  },
  {
    type: "hubspot",
    name: "HubSpot",
    description: "Sync contacts, companies, and deals from HubSpot CRM",
    status: "coming_soon",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v7M12 15v7M2 12h7M15 12h7" />
      </svg>
    ),
  },
  {
    type: "dynamics",
    name: "Microsoft Dynamics",
    description: "Sync accounts, contacts, and opportunities from Dynamics 365",
    status: "coming_soon",
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
    type: "sharepoint",
    name: "SharePoint",
    description: "Import documents and lists from Microsoft SharePoint",
    status: "coming_soon",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16v16H4z" />
        <path d="M4 9h16M9 4v16" />
      </svg>
    ),
  },
  {
    type: "google_workspace",
    name: "Google Workspace",
    description: "Import contacts and documents from Google Workspace",
    status: "coming_soon",
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.5 10H4l8-7 8.5 7Z" />
        <path d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9" />
        <path d="M12 20v-7" />
      </svg>
    ),
  },
];

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
  return (
    <div className="data-tab-content">
      <div className="data-connector-grid">
        {CONNECTORS.map((c) => (
          <div
            key={c.type}
            className={`data-connector-card ${c.status === "coming_soon" ? "data-connector-card-disabled" : ""}`}
          >
            <div className="data-connector-icon">{c.icon}</div>
            <div className="data-connector-body">
              <div className="data-connector-name">{c.name}</div>
              <div className="data-connector-desc">{c.description}</div>
            </div>
            <div className="data-connector-footer">
              {statusBadge(c.status)}
              {c.status === "available" ? (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => onNavigate("imports")}
                >
                  Import CSV
                </button>
              ) : (
                <button className="btn btn-sm" disabled>
                  Connect
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
