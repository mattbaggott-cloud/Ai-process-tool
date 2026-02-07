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

// Phase 4: Library
export type Category = "Note" | "Document" | "Template" | "Reference";

export interface LibraryItem {
  id: string;
  user_id: string;
  title: string;
  content: string;
  category: Category;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface LibraryFile {
  id: string;
  user_id: string;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  text_content: string | null;
  added_at: string;
}
