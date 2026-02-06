export default function GoalsPage() {
  return (
    <>
      <div className="canvas-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="canvas-title">Goals</h1>
          <p className="canvas-subtitle">
            Set objectives, track progress, and link to teams &amp; KPIs
          </p>
        </div>
        <button className="btn btn-primary">+ New Goal</button>
      </div>

      <div className="canvas-content">
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#9ca3af" strokeWidth="1.5" style={{ margin: "0 auto 16px" }}>
            <circle cx="24" cy="24" r="18" />
            <circle cx="24" cy="24" r="10" />
            <circle cx="24" cy="24" r="3" />
          </svg>
          <h3>No goals yet</h3>
          <p>
            Create your first goal to start tracking business objectives. The AI
            will help you monitor progress and suggest actions.
          </p>
        </div>
      </div>
    </>
  );
}
