import Link from "next/link";

export default function ProjectsPage() {
  const projects = [
    { name: "SDR → AE Pipeline",      desc: "Outbound sales development to account executive handoff",       href: "/projects/sdr-pipeline" },
    { name: "Outbound Prospecting",    desc: "Lead identification and initial outreach workflow",            href: "/projects/outbound" },
    { name: "Lead Qualification",      desc: "Scoring and qualifying inbound and outbound leads",           href: "/projects/lead-qualification" },
  ];

  return (
    <>
      <div className="canvas-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="canvas-title">Projects</h1>
          <p className="canvas-subtitle">Process flows and workflow diagrams</p>
        </div>
        <button className="btn btn-primary">+ New Flow</button>
      </div>

      <div className="canvas-content">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {projects.map((p) => (
            <Link key={p.name} href={p.href} prefetch={false} className="card-link">
              <div className="card card-clickable" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 500, color: "#1a1a1a" }}>{p.name}</h3>
                  <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{p.desc}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, color: "#6b7280" }}>0 nodes</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Not started</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
