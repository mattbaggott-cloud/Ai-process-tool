export default function BrainstormPage() {
  const examples = [
    '"Compare 3 approaches to scaling our SDR team"',
    '"Show cost breakdown of AI tools"',
    '"Map out implementation timeline"',
  ];

  return (
    <>
      <div className="canvas-header">
        <h1 className="canvas-title">Brainstorm</h1>
        <p className="canvas-subtitle">
          Ask the AI to generate visualizations, comparisons, and analysis
        </p>
      </div>

      {/* Empty canvas centred */}
      <div className="canvas-content" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="#d1d5db" strokeWidth="1.5" style={{ margin: "0 auto 16px" }}>
            <rect x="8" y="8" width="40" height="40" rx="4" />
            <path d="M20 28h16M28 20v16" />
          </svg>
          <h3 style={{ fontSize: 16, fontWeight: 500, color: "#374151", marginBottom: 8 }}>
            Blank canvas
          </h3>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20, lineHeight: 1.6 }}>
            Ask the AI to create something. Try:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {examples.map((ex) => (
              <div key={ex} className="prompt-chip">{ex}</div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
