"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { createClient } from "@/lib/supabase/client";
import type { OrgRole } from "@/lib/types/database";

/* ── Role hierarchy (for display + permission checks) ─── */

const ROLE_LEVELS: Record<OrgRole, number> = {
  owner: 5,
  admin: 4,
  manager: 3,
  user: 2,
  viewer: 1,
};

const ROLE_OPTIONS: OrgRole[] = ["owner", "admin", "manager", "user", "viewer"];

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  user: "User",
  viewer: "Viewer",
};

const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: "Full control including billing & danger zone",
  admin: "Manage members, departments, and all data",
  manager: "Create workflows, manage team data, view reports",
  user: "Create and edit data, execute workflows",
  viewer: "Read-only access",
};

/* ── Member row type ─────────────────────────────────── */

interface MemberRow {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
  user_email?: string;
  user_name?: string;
}

interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  department_ids: string[];
  invited_by: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

/* ══════════════════════════════════════════════════════════
   SETTINGS PAGE
   ══════════════════════════════════════════════════════════ */

export default function SettingsPage() {
  const { user } = useAuth();
  const { org, orgId, role, departments, loading: orgLoading } = useOrg();
  const supabase = createClient();

  /* ── State ── */
  const [activeTab, setActiveTab] = useState<"general" | "members" | "departments">("general");

  // General settings
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Members
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<InviteRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);

  // Invite form
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("user");
  const [inviteDepts, setInviteDepts] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Departments
  const [deptName, setDeptName] = useState("");
  const [deptSlug, setDeptSlug] = useState("");
  const [deptLoading, setDeptLoading] = useState(false);

  // Onboarding
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("settings-onboarding-dismissed") === "true";
  });

  const isAdmin = role === "owner" || role === "admin";
  const canInvite = role === "owner" || role === "admin" || role === "manager";

  /* ── Sync form from org context ── */
  useEffect(() => {
    if (org) {
      setOrgName(org.name);
      setOrgSlug(org.slug);
    }
  }, [org]);

  /* ── Eagerly load member count for onboarding banner ── */
  useEffect(() => {
    if (!orgId) return;
    supabase
      .from("org_members")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .then(({ count }) => setMemberCount(count ?? 0));
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Load members + invites ── */
  const loadMembers = useCallback(async () => {
    if (!orgId) return;
    setMembersLoading(true);

    const [membersRes, invitesRes, profilesRes] = await Promise.all([
      supabase.from("org_members").select("*").eq("org_id", orgId).order("created_at"),
      supabase.from("org_invites").select("*").eq("org_id", orgId).is("accepted_at", null).order("created_at", { ascending: false }),
      supabase.from("user_profiles").select("user_id, display_name, email"),
    ]);

    // Build profile map with name + email
    const profileMap: Record<string, { name: string; email: string }> = {};
    if (profilesRes.data) {
      for (const p of profilesRes.data) {
        profileMap[p.user_id] = {
          name: p.display_name || "",
          email: p.email || "",
        };
      }
    }

    if (membersRes.data) {
      const enriched: MemberRow[] = membersRes.data.map((m) => ({
        ...m,
        role: m.role as OrgRole,
        user_name: profileMap[m.user_id]?.name || "",
        user_email: profileMap[m.user_id]?.email || "",
      }));
      setMembers(enriched);
      setMemberCount(enriched.length);
    }

    if (invitesRes.data) {
      setPendingInvites(invitesRes.data as InviteRow[]);
    }

    setMembersLoading(false);
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === "members" && orgId) loadMembers();
  }, [activeTab, orgId, loadMembers]);

  /* ── Save org settings ── */
  const handleSaveOrg = async () => {
    if (!orgId || !isAdmin) return;
    setSaving(true);

    const slug = orgSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    await supabase
      .from("orgs")
      .update({
        name: orgName.trim(),
        slug: slug || orgSlug,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orgId);

    setSaving(false);
    setLastSaved(new Date().toLocaleTimeString());
    window.dispatchEvent(new Event("workspace-updated"));
  };

  /* ── Invite member ── */
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !canInvite || !inviteEmail.trim()) return;
    setInviting(true);

    const { data: newInvite, error } = await supabase
      .from("org_invites")
      .insert({
        org_id: orgId,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        department_ids: inviteDepts,
        invited_by: user!.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();

    if (!error && newInvite) {
      const link = `${window.location.origin}/invite/${newInvite.id}`;
      setLastInviteLink(link);
      setLinkCopied(false);
      try {
        await navigator.clipboard.writeText(link);
        setLinkCopied(true);
      } catch { /* clipboard may not be available */ }

      setInviteEmail("");
      setInviteRole("user");
      setInviteDepts([]);
      setShowInviteForm(false);
      loadMembers();
    }
    setInviting(false);
  };

  /* ── Cancel invite ── */
  const handleCancelInvite = async (inviteId: string) => {
    if (!isAdmin) return;
    await supabase.from("org_invites").delete().eq("id", inviteId);
    loadMembers();
  };

  /* ── Change member role ── */
  const handleRoleChange = async (memberId: string, newRole: OrgRole) => {
    if (!isAdmin) return;
    await supabase.from("org_members").update({ role: newRole }).eq("id", memberId);
    loadMembers();
  };

  /* ── Remove member ── */
  const handleRemoveMember = async (memberId: string, memberUserId: string) => {
    if (!isAdmin) return;
    if (memberUserId === user?.id && role === "owner") return;
    await supabase.from("org_members").delete().eq("id", memberId);
    loadMembers();
  };

  /* ── Copy invite link ── */
  const copyInviteLink = async (inviteId: string) => {
    const link = `${window.location.origin}/invite/${inviteId}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch { /* clipboard may not be available */ }
  };

  /* ── Create department ── */
  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !isAdmin || !deptName.trim()) return;
    setDeptLoading(true);

    const slug = (deptSlug || deptName)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    await supabase.from("org_departments").insert({
      org_id: orgId,
      name: deptName.trim(),
      slug,
    });

    setDeptName("");
    setDeptSlug("");
    setDeptLoading(false);
    window.dispatchEvent(new Event("workspace-updated"));
  };

  /* ── Delete department ── */
  const handleDeleteDept = async (deptId: string) => {
    if (!isAdmin) return;
    await supabase.from("org_departments").delete().eq("id", deptId);
    window.dispatchEvent(new Event("workspace-updated"));
  };

  /* ── Loading ── */
  if (orgLoading) {
    return (
      <>
        <div className="canvas-header">
          <h1 className="canvas-title">Settings</h1>
          <p className="canvas-subtitle">Organization settings, members, and departments</p>
        </div>
        <div className="canvas-content">
          <div className="empty-state"><p>Loading settings...</p></div>
        </div>
      </>
    );
  }

  if (!org) {
    return (
      <>
        <div className="canvas-header">
          <h1 className="canvas-title">Settings</h1>
          <p className="canvas-subtitle">Organization settings, members, and departments</p>
        </div>
        <div className="canvas-content">
          <div className="empty-state">
            <p>No organization found. Please sign out and sign back in.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* ─── Header ─── */}
      <div className="canvas-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="canvas-title">Settings</h1>
          <p className="canvas-subtitle">
            Manage your organization, team members, and departments
          </p>
        </div>
        <div className="settings-role-badge">
          {ROLE_LABELS[role!]} role
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div className="canvas-content">
        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeTab === "general" ? "settings-tab-active" : ""}`}
            onClick={() => setActiveTab("general")}
          >
            General
          </button>
          <button
            className={`settings-tab ${activeTab === "members" ? "settings-tab-active" : ""}`}
            onClick={() => setActiveTab("members")}
          >
            Members
          </button>
          <button
            className={`settings-tab ${activeTab === "departments" ? "settings-tab-active" : ""}`}
            onClick={() => setActiveTab("departments")}
          >
            Departments
          </button>
        </div>

        {/* ─── Onboarding Banner ─── */}
        {!onboardingDismissed && isAdmin && memberCount !== null && memberCount <= 1 && departments.length === 0 && (
          <div className="settings-onboarding-banner">
            <div className="settings-onboarding-header">
              <h3 className="settings-onboarding-title">Welcome to your workspace!</h3>
              <button
                className="settings-onboarding-dismiss"
                onClick={() => {
                  setOnboardingDismissed(true);
                  localStorage.setItem("settings-onboarding-dismissed", "true");
                }}
                aria-label="Dismiss"
              >
                &times;
              </button>
            </div>
            <p className="settings-onboarding-subtitle">
              Set up your organization in a few steps to get started with your team.
            </p>
            <div className="settings-onboarding-steps">
              <button className="settings-onboarding-step" onClick={() => setActiveTab("general")}>
                <span className="settings-step-number">1</span>
                <div>
                  <div className="settings-step-title">Name your organization</div>
                  <div className="settings-step-desc">Set your company name and URL slug</div>
                </div>
                {orgName && !orgName.includes("Workspace") ? (
                  <span className="settings-step-check">&#x2713;</span>
                ) : null}
              </button>
              <button
                className="settings-onboarding-step"
                onClick={() => { setActiveTab("members"); setShowInviteForm(true); }}
              >
                <span className="settings-step-number">2</span>
                <div>
                  <div className="settings-step-title">Invite team members</div>
                  <div className="settings-step-desc">Share invite links with your colleagues</div>
                </div>
              </button>
              <button className="settings-onboarding-step" onClick={() => setActiveTab("departments")}>
                <span className="settings-step-number">3</span>
                <div>
                  <div className="settings-step-title">Create departments</div>
                  <div className="settings-step-desc">Organize your team into groups</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════ GENERAL TAB ═══════════════════ */}
        {activeTab === "general" && (
          <div className="settings-section">
            <h2 className="settings-section-title">Organization</h2>
            <p className="settings-section-desc">Basic info about your workspace.</p>

            <div className="settings-form-grid">
              <div>
                <label className="field-label">Organization Name</label>
                <input
                  className="input"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={!isAdmin}
                  placeholder="My Company"
                />
              </div>
              <div>
                <label className="field-label">URL Slug</label>
                <input
                  className="input"
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  disabled={!isAdmin}
                  placeholder="my-company"
                />
                <span className="settings-hint">Used in URLs. Lowercase letters, numbers, and hyphens only.</span>
              </div>
            </div>

            {isAdmin && (
              <div className="settings-actions">
                <button className="btn btn-primary btn-sm" onClick={handleSaveOrg} disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                {lastSaved && <span className="settings-saved-text">Saved at {lastSaved}</span>}
              </div>
            )}

            {!isAdmin && (
              <div className="settings-readonly-notice">
                You need Admin or Owner permissions to edit organization settings.
              </div>
            )}

            {/* Org Info */}
            <div className="settings-info-cards">
              <div className="settings-info-card">
                <div className="settings-info-label">Created</div>
                <div className="settings-info-value">
                  {new Date(org.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </div>
              </div>
              <div className="settings-info-card">
                <div className="settings-info-label">Owner</div>
                <div className="settings-info-value">{user?.email}</div>
              </div>
              <div className="settings-info-card">
                <div className="settings-info-label">Your Role</div>
                <div className="settings-info-value">{ROLE_LABELS[role!]}</div>
              </div>
            </div>

            {/* Quick Actions */}
            {canInvite && (
              <div className="settings-quick-actions">
                <h3 className="settings-subsection-title">Quick Actions</h3>
                <div className="settings-quick-actions-grid">
                  <button
                    className="settings-quick-action-btn"
                    onClick={() => { setActiveTab("members"); setShowInviteForm(true); }}
                  >
                    <span className="settings-quick-action-icon">+</span>
                    <div>
                      <div className="settings-quick-action-title">Invite a Team Member</div>
                      <div className="settings-quick-action-desc">Send an invite link to a colleague</div>
                    </div>
                  </button>
                  {isAdmin && (
                    <button
                      className="settings-quick-action-btn"
                      onClick={() => setActiveTab("departments")}
                    >
                      <span className="settings-quick-action-icon">&#x25A3;</span>
                      <div>
                        <div className="settings-quick-action-title">Create a Department</div>
                        <div className="settings-quick-action-desc">Organize your team into groups</div>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════ MEMBERS TAB ═══════════════════ */}
        {activeTab === "members" && (
          <div className="settings-section">
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Team Members</h2>
                <p className="settings-section-desc">
                  {members.length} member{members.length !== 1 ? "s" : ""} in this organization.
                </p>
              </div>
              {canInvite && (
                <button className="btn btn-primary btn-sm" onClick={() => setShowInviteForm(!showInviteForm)}>
                  {showInviteForm ? "Cancel" : "+ Invite Member"}
                </button>
              )}
            </div>

            {/* Role Guide -- collapsible */}
            <details className="settings-role-guide-collapsible">
              <summary className="settings-role-guide-summary">
                Role Permissions Guide
              </summary>
              <div className="settings-role-grid" style={{ padding: 16, borderTop: "1px solid #e5e7eb" }}>
                {ROLE_OPTIONS.map((r) => (
                  <div key={r} className="settings-role-card">
                    <div className="settings-role-card-title">{ROLE_LABELS[r]}</div>
                    <div className="settings-role-card-desc">{ROLE_DESCRIPTIONS[r]}</div>
                  </div>
                ))}
              </div>
            </details>

            {/* Invite Form */}
            {showInviteForm && canInvite && (
              <form className="settings-invite-form" onSubmit={handleInvite}>
                <div className="settings-form-grid">
                  <div>
                    <label className="field-label">Email Address</label>
                    <input
                      className="input"
                      type="email"
                      placeholder="colleague@company.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="field-label">Role</label>
                    <select
                      className="input"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                    >
                      {ROLE_OPTIONS.filter((r) => {
                        if (!role) return false;
                        // Hierarchical: can only assign roles below your level
                        return ROLE_LEVELS[r] < ROLE_LEVELS[role];
                      }).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {departments.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <label className="field-label">Assign to Departments (optional)</label>
                    <div className="settings-dept-checkboxes">
                      {departments.map((d) => (
                        <label key={d.id} className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={inviteDepts.includes(d.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setInviteDepts([...inviteDepts, d.id]);
                              } else {
                                setInviteDepts(inviteDepts.filter((id) => id !== d.id));
                              }
                            }}
                          />
                          {d.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 12 }} disabled={inviting}>
                  {inviting ? "Sending..." : "Send Invite"}
                </button>
              </form>
            )}

            {/* Invite Link Banner */}
            {lastInviteLink && (
              <div className="settings-invite-link-banner">
                <div className="settings-invite-link-content">
                  <span className="settings-invite-link-icon">&#x1F517;</span>
                  <div>
                    <div className="settings-invite-link-title">
                      {linkCopied ? "Invite link copied to clipboard!" : "Invite created!"}
                    </div>
                    <div className="settings-invite-link-subtitle">
                      Share this link with the invitee. They can accept by clicking it.
                    </div>
                    <code className="settings-invite-link-url">{lastInviteLink}</code>
                  </div>
                </div>
                <div className="settings-invite-link-actions">
                  <button
                    className="btn btn-secondary btn-xs"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(lastInviteLink);
                        setLinkCopied(true);
                      } catch { /* */ }
                    }}
                  >
                    {linkCopied ? "Copied!" : "Copy Link"}
                  </button>
                  <button className="btn btn-secondary btn-xs" onClick={() => setLastInviteLink(null)}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
              <div className="settings-pending-section">
                <h3 className="settings-subsection-title">Pending Invites</h3>
                <div className="settings-members-list">
                  {pendingInvites.map((inv) => (
                    <div key={inv.id} className="settings-member-row settings-member-pending">
                      <div className="settings-member-info">
                        <span className="settings-member-avatar settings-avatar-pending">?</span>
                        <div>
                          <div className="settings-member-name">{inv.email}</div>
                          <div className="settings-member-meta">
                            Invited {new Date(inv.created_at).toLocaleDateString()} · Expires{" "}
                            {new Date(inv.expires_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="settings-member-actions">
                        <span className="settings-role-tag">{ROLE_LABELS[inv.role]}</span>
                        <button
                          className="btn btn-secondary btn-xs"
                          onClick={() => copyInviteLink(inv.id)}
                          title="Copy invite link"
                        >
                          Copy Link
                        </button>
                        {isAdmin && (
                          <button
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleCancelInvite(inv.id)}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Members List */}
            {membersLoading ? (
              <div className="empty-state"><p>Loading members...</p></div>
            ) : (
              <div className="settings-members-list">
                {members.map((m) => {
                  const isSelf = m.user_id === user?.id;
                  const isOrgOwner = m.role === "owner";
                  const canEdit = isAdmin && !isOrgOwner && !isSelf;
                  const canRemove = isAdmin && !isOrgOwner && !isSelf;

                  return (
                    <div key={m.id} className="settings-member-row">
                      <div className="settings-member-info">
                        <span className="settings-member-avatar">
                          {(m.user_name || m.user_email || "U")[0].toUpperCase()}
                        </span>
                        <div>
                          <div className="settings-member-name">
                            {m.user_name || m.user_email || m.user_id.slice(0, 8)}
                            {isSelf && <span className="settings-you-badge">you</span>}
                          </div>
                          <div className="settings-member-meta">
                            {m.user_email && m.user_name && <>{m.user_email} &middot; </>}
                            Joined {new Date(m.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="settings-member-actions">
                        {canEdit ? (
                          <select
                            className="settings-role-select"
                            value={m.role}
                            onChange={(e) => handleRoleChange(m.id, e.target.value as OrgRole)}
                          >
                            {ROLE_OPTIONS.filter((r) => {
                              if (!role) return false;
                              return ROLE_LEVELS[r] < ROLE_LEVELS[role] || r === m.role;
                            }).map((r) => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="settings-role-tag">{ROLE_LABELS[m.role]}</span>
                        )}
                        {canRemove && (
                          <button
                            className="btn btn-secondary btn-xs settings-remove-btn"
                            onClick={() => handleRemoveMember(m.id, m.user_id)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════ DEPARTMENTS TAB ═══════════════════ */}
        {activeTab === "departments" && (
          <div className="settings-section">
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Departments</h2>
                <p className="settings-section-desc">
                  Organize team members into departments. Members can belong to multiple departments.
                </p>
              </div>
            </div>

            {/* Create Department Form */}
            {isAdmin && (
              <form className="settings-dept-form" onSubmit={handleCreateDept}>
                <div className="settings-form-row">
                  <input
                    className="input"
                    placeholder="Department name (e.g. Sales, Marketing)"
                    value={deptName}
                    onChange={(e) => {
                      setDeptName(e.target.value);
                      setDeptSlug(
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/g, "-")
                          .replace(/-+/g, "-")
                          .replace(/^-|-$/g, "")
                      );
                    }}
                  />
                  <input
                    className="input"
                    placeholder="Slug"
                    value={deptSlug}
                    onChange={(e) => setDeptSlug(e.target.value)}
                    style={{ maxWidth: 200 }}
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={deptLoading || !deptName.trim()}>
                    {deptLoading ? "Creating..." : "Add Department"}
                  </button>
                </div>
              </form>
            )}

            {/* Department List */}
            {departments.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                </div>
                <h3>No departments yet</h3>
                <p>
                  Departments help you organize team members into groups like Sales, Marketing, or Engineering.
                  {isAdmin ? " Use the form above to create your first department, or ask AI to help." : " Ask an admin to create departments."}
                </p>
              </div>
            ) : (
              <div className="settings-dept-list">
                {departments.map((d) => (
                  <div key={d.id} className="settings-dept-row">
                    <div className="settings-dept-info">
                      <div className="settings-dept-name">{d.name}</div>
                      <div className="settings-dept-slug">/{d.slug}</div>
                    </div>
                    <div className="settings-dept-actions">
                      <span className="settings-dept-date">
                        Created {new Date(d.created_at).toLocaleDateString()}
                      </span>
                      {isAdmin && (
                        <button
                          className="btn btn-secondary btn-xs settings-remove-btn"
                          onClick={() => handleDeleteDept(d.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!isAdmin && (
              <div className="settings-readonly-notice">
                You need Admin or Owner permissions to manage departments.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
