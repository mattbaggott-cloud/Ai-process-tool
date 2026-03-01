"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "./AuthContext";
import type { Org, OrgMember, OrgDepartment, OrgDepartmentMember, OrgRole } from "@/lib/types/database";

/* ── types ──────────────────────────────────────────────── */

interface OrgContextValue {
  org: Org | null;                          // Current active org
  orgId: string | null;                     // Shortcut for org?.id
  orgMembership: OrgMember | null;          // Current user's membership in the org
  role: OrgRole | null;                     // Shortcut for membership role
  departments: OrgDepartment[];             // Departments in current org
  myDepartments: OrgDepartmentMember[];     // User's department memberships
  userOrgs: Org[];                          // All orgs user belongs to
  loading: boolean;
  switchOrg: (orgId: string) => void;
}

/* ── context ────────────────────────────────────────────── */

const OrgContext = createContext<OrgContextValue>({
  org: null,
  orgId: null,
  orgMembership: null,
  role: null,
  departments: [],
  myDepartments: [],
  userOrgs: [],
  loading: true,
  switchOrg: () => {},
});

export function useOrg() {
  return useContext(OrgContext);
}

/* ── helpers ────────────────────────────────────────────── */

const STORAGE_KEY = "ai-workspace-active-org";

function getSavedOrgId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveOrgId(orgId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, orgId);
  } catch {
    // ignore
  }
}

/* ── provider ───────────────────────────────────────────── */

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const supabase = createClient();

  const [userOrgs, setUserOrgs] = useState<Org[]>([]);
  const [memberships, setMemberships] = useState<OrgMember[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<OrgDepartment[]>([]);
  const [myDepartments, setMyDepartments] = useState<OrgDepartmentMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Load user's orgs and memberships
  const loadOrgs = useCallback(async () => {
    if (!user) {
      setUserOrgs([]);
      setMemberships([]);
      setActiveOrgId(null);
      setLoading(false);
      return;
    }

    // Fetch org memberships with joined org data
    const { data: memberRows } = await supabase
      .from("org_members")
      .select("*, orgs(*)")
      .eq("user_id", user.id);

    if (!memberRows || memberRows.length === 0) {
      setUserOrgs([]);
      setMemberships([]);
      setActiveOrgId(null);
      setLoading(false);
      return;
    }

    const orgs: Org[] = memberRows.map((row) => row.orgs as unknown as Org);
    const mems: OrgMember[] = memberRows.map((row) => ({
      id: row.id,
      org_id: row.org_id,
      user_id: row.user_id,
      role: row.role as OrgRole,
      onboarding_completed: (row.onboarding_completed as boolean) ?? false,
      created_at: row.created_at,
    }));

    setUserOrgs(orgs);
    setMemberships(mems);

    // Determine active org: saved preference → first org
    const savedId = getSavedOrgId();
    const validSaved = orgs.find((o) => o.id === savedId);
    const selected = validSaved || orgs[0];
    setActiveOrgId(selected.id);
    saveOrgId(selected.id);

    setLoading(false);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load departments for active org
  const loadDepartments = useCallback(async () => {
    if (!activeOrgId || !user) {
      setDepartments([]);
      setMyDepartments([]);
      return;
    }

    const [deptRes, myDeptRes] = await Promise.all([
      supabase.from("org_departments").select("*").eq("org_id", activeOrgId).order("name"),
      supabase.from("org_department_members").select("*").eq("user_id", user.id),
    ]);

    setDepartments((deptRes.data as OrgDepartment[]) || []);

    // Filter to departments in this org
    const deptIds = new Set((deptRes.data || []).map((d) => d.id));
    const myDepts = (myDeptRes.data || []).filter((dm) => deptIds.has(dm.department_id));
    setMyDepartments(myDepts as OrgDepartmentMember[]);
  }, [activeOrgId, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authLoading) loadOrgs();
  }, [authLoading, loadOrgs]);

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  // Auto-detect and persist user timezone from browser
  useEffect(() => {
    if (!user) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    supabase
      .from("user_profiles")
      .update({ timezone: tz })
      .eq("user_id", user.id)
      .then(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchOrg = useCallback(
    (orgId: string) => {
      const exists = userOrgs.find((o) => o.id === orgId);
      if (exists) {
        setActiveOrgId(orgId);
        saveOrgId(orgId);
      }
    },
    [userOrgs]
  );

  // Derived values
  const org = userOrgs.find((o) => o.id === activeOrgId) ?? null;
  const orgMembership = memberships.find((m) => m.org_id === activeOrgId) ?? null;
  const role = orgMembership?.role ?? null;

  return (
    <OrgContext.Provider
      value={{
        org,
        orgId: activeOrgId,
        orgMembership,
        role,
        departments,
        myDepartments,
        userOrgs,
        loading: loading || authLoading,
        switchOrg,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}
