export default function HomePage() {
  return (
    <>
      {/* Header */}
      <div className="canvas-header">
        <h1 className="canvas-title">Welcome Back</h1>
        <p className="canvas-subtitle">
          What do you want to explore today?
        </p>
      </div>

      {/* Content */}
      <div className="canvas-content">
        {/* Quick Start */}
        <div style={{ maxWidth: 640, marginBottom: 40 }}>
          <textarea
            className="input input-lg textarea"
            placeholder="Describe a challenge or opportunity you want to explore... (e.g., 'How can we scale our SDR team 10x?')"
            rows={4}
          />
          <button className="btn btn-primary" style={{ marginTop: 12 }}>
            Start Exploring
          </button>
        </div>

        {/* Stats Grid */}
        <div className="stat-grid" style={{ marginBottom: 40 }}>
          {[
            { label: "Teams Mapped", value: "0" },
            { label: "Flows Created", value: "0" },
            { label: "Simulations", value: "0" },
            { label: "Saved Items", value: "0" },
          ].map((s) => (
            <div key={s.label} className="stat-box">
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Recent Activity */}
        <div className="section-header">
          <h2 className="section-title">Recent Activity</h2>
        </div>
        <div className="empty-state">
          <h3>No activity yet</h3>
          <p>
            Start by exploring a question above or building a team model from the
            sidebar.
          </p>
        </div>
      </div>
    </>
  );
}
