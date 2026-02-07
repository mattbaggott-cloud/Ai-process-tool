"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GoalsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/organization/goals");
  }, [router]);
  return (
    <div className="canvas-content">
      <div className="empty-state">
        <p>Redirecting to Goals…</p>
      </div>
    </div>
  );
}
