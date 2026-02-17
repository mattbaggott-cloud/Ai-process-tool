/**
 * Server-side org context helper for API routes.
 *
 * Usage:
 *   const ctx = await getOrgContext(supabase);
 *   if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *   // ctx.user, ctx.orgId, ctx.role, ctx.org
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Org, OrgRole } from "@/lib/types/database";

export interface OrgContext {
  user: { id: string; email?: string };
  org: Org;
  orgId: string;
  role: OrgRole;
}

/**
 * Get the current user's org context from their Supabase session.
 *
 * For now, selects the user's first (and typically only) org.
 * When multi-org support is needed, pass an explicit org_id parameter.
 */
export async function getOrgContext(
  supabase: SupabaseClient,
  requestedOrgId?: string
): Promise<OrgContext | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Fetch user's org memberships
  const { data: memberships } = await supabase
    .from("org_members")
    .select("*, orgs(*)")
    .eq("user_id", user.id);

  if (!memberships || memberships.length === 0) return null;

  // Select the requested org, or the first one
  let membership = memberships[0];
  if (requestedOrgId) {
    const found = memberships.find((m) => m.org_id === requestedOrgId);
    if (found) membership = found;
    else return null; // User isn't a member of the requested org
  }

  return {
    user: { id: user.id, email: user.email },
    org: membership.orgs as unknown as Org,
    orgId: membership.org_id as string,
    role: membership.role as OrgRole,
  };
}

/**
 * Check if a role meets a minimum role threshold.
 * Role hierarchy: owner(5) > admin(4) > manager(3) > user(2) > viewer(1)
 */
export function hasMinRole(userRole: OrgRole, minRole: OrgRole): boolean {
  const levels: Record<OrgRole, number> = {
    owner: 5,
    admin: 4,
    manager: 3,
    user: 2,
    viewer: 1,
  };
  return (levels[userRole] ?? 0) >= (levels[minRole] ?? 0);
}
