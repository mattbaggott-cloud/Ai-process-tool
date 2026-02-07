/* ------------------------------------------------------------------ */
/*  Shared TypeScript types — matches Supabase table schemas          */
/*  This file grows as we add tables in later phases                  */
/* ------------------------------------------------------------------ */

// Phase 1: Profile (auth)
export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}
