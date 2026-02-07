"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ProjectsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/brainstorm");
  }, [router]);
  return (
    <div className="canvas-content">
      <div className="empty-state">
        <p>Redirecting to Projects…</p>
      </div>
    </div>
  );
}
