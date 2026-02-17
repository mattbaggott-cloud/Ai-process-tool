"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { OrgRole } from "@/lib/types/database";

/* ── Role labels ─────────────────────────────────────── */

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  user: "User",
  viewer: "Viewer",
};

/* ── Types ───────────────────────────────────────────── */

interface InviteData {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  department_ids: string[];
  expires_at: string;
  accepted_at: string | null;
  org_name: string;
}

/* ══════════════════════════════════════════════════════════
   INVITE ACCEPTANCE PAGE
   ══════════════════════════════════════════════════════════ */

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const token = params.token as string;

  const [invite, setInvite] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  /* ── Load invite data ── */
  const loadInvite = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Check auth status
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setIsLoggedIn(true);
      setUserEmail(user.email ?? null);
    }

    // Load invite by ID (token = invite id)
    const { data: inv, error: invErr } = await supabase
      .from("org_invites")
      .select("*")
      .eq("id", token)
      .single();

    if (invErr || !inv) {
      setError("Invite not found. It may have been cancelled or the link is invalid.");
      setLoading(false);
      return;
    }

    // Check if already accepted
    if (inv.accepted_at) {
      setError("This invite has already been accepted.");
      setLoading(false);
      return;
    }

    // Check if expired
    if (new Date(inv.expires_at) < new Date()) {
      setError("This invite has expired. Please ask the admin to send a new one.");
      setLoading(false);
      return;
    }

    // Load org name
    const { data: org } = await supabase
      .from("orgs")
      .select("name")
      .eq("id", inv.org_id)
      .single();

    setInvite({
      ...inv,
      role: inv.role as OrgRole,
      org_name: org?.name ?? "Unknown Organization",
    });

    setLoading(false);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadInvite();
  }, [loadInvite]);

  /* ── Accept invite ── */
  const handleAccept = async () => {
    if (!invite) return;
    setAccepting(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      // Redirect to login with return URL
      router.push(`/login?redirect=/invite/${token}`);
      return;
    }

    // Check email matches (optional - can be relaxed)
    if (invite.email && user.email?.toLowerCase() !== invite.email.toLowerCase()) {
      setError(
        `This invite was sent to ${invite.email}. You are logged in as ${user.email}. Please log in with the correct account.`
      );
      setAccepting(false);
      return;
    }

    // Check if already a member
    const { data: existing } = await supabase
      .from("org_members")
      .select("id")
      .eq("org_id", invite.org_id)
      .eq("user_id", user.id)
      .single();

    if (existing) {
      // Already a member — mark invite as accepted and redirect
      await supabase
        .from("org_invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);

      setSuccess(true);
      setAccepting(false);
      setTimeout(() => router.push("/"), 2000);
      return;
    }

    // Create org membership
    const { error: memberErr } = await supabase.from("org_members").insert({
      org_id: invite.org_id,
      user_id: user.id,
      role: invite.role,
    });

    if (memberErr) {
      setError("Failed to join organization. Please try again.");
      setAccepting(false);
      return;
    }

    // Add to departments if specified
    if (invite.department_ids && invite.department_ids.length > 0) {
      const deptInserts = invite.department_ids.map((deptId) => ({
        department_id: deptId,
        user_id: user.id,
        role: invite.role, // same role as org by default
      }));
      await supabase.from("org_department_members").insert(deptInserts);
    }

    // Mark invite as accepted
    await supabase
      .from("org_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    setSuccess(true);
    setAccepting(false);

    // Redirect to dashboard after short delay
    setTimeout(() => router.push("/"), 2000);
  };

  /* ── Render ── */
  return (
    <div className="invite-page">
      <div className="invite-card">
        {/* Header */}
        <div className="invite-header">
          <div className="invite-logo">AI Workspace</div>
          <h1 className="invite-title">Team Invitation</h1>
        </div>

        {/* Loading */}
        {loading && (
          <div className="invite-body">
            <p className="invite-text">Loading invitation...</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="invite-body">
            <div className="invite-error">{error}</div>
            <button className="btn btn-secondary" onClick={() => router.push("/login")}>
              Go to Login
            </button>
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="invite-body">
            <div className="invite-success">
              Welcome aboard! You&apos;ve joined {invite?.org_name}. Redirecting to your workspace...
            </div>
          </div>
        )}

        {/* Invite Details */}
        {invite && !loading && !error && !success && (
          <div className="invite-body">
            <p className="invite-text">
              You&apos;ve been invited to join
            </p>
            <div className="invite-org-name">{invite.org_name}</div>

            <div className="invite-details">
              <div className="invite-detail-row">
                <span className="invite-detail-label">Role</span>
                <span className="invite-detail-value invite-role-badge">
                  {ROLE_LABELS[invite.role]}
                </span>
              </div>
              <div className="invite-detail-row">
                <span className="invite-detail-label">Invited as</span>
                <span className="invite-detail-value">{invite.email}</span>
              </div>
              <div className="invite-detail-row">
                <span className="invite-detail-label">Expires</span>
                <span className="invite-detail-value">
                  {new Date(invite.expires_at).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>

            {isLoggedIn ? (
              <div className="invite-actions">
                <p className="invite-logged-in-text">
                  Logged in as <strong>{userEmail}</strong>
                </p>
                <button
                  className="btn btn-primary invite-accept-btn"
                  onClick={handleAccept}
                  disabled={accepting}
                >
                  {accepting ? "Joining..." : "Accept Invitation"}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => router.push("/")}
                >
                  Decline
                </button>
              </div>
            ) : (
              <div className="invite-actions">
                <p className="invite-text">
                  Please sign in to accept this invitation.
                </p>
                <button
                  className="btn btn-primary invite-accept-btn"
                  onClick={() => router.push(`/login?redirect=/invite/${token}`)}
                >
                  Sign In to Accept
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
