import { createClient } from "@/lib/supabase/server";

/* ── PDF text extraction endpoint ────────────────────── */

export async function POST(req: Request) {
  /* Auth */
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  /* Parse multipart form data */
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  /* Check file size (10MB max) */
  if (file.size > 10 * 1024 * 1024) {
    return Response.json({ error: "File too large (10MB max)" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  try {
    let text = "";

    if (ext === "pdf") {
      /* PDF extraction using pdf-parse — dynamic require to avoid bundling issues */
      const buffer = Buffer.from(await file.arrayBuffer());
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
      const result = await pdfParse(buffer);
      text = result.text || "";
    } else {
      /* Plain text files */
      text = await file.text();
    }

    /* Truncate very long documents */
    const maxChars = 50000;
    if (text.length > maxChars) {
      text = text.slice(0, maxChars) + "\n\n...(truncated — document exceeds 50,000 characters)";
    }

    return Response.json({
      text,
      pages: ext === "pdf" ? Math.ceil(text.split("\n\n").length / 3) : null,
      chars: text.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
