export default function LibraryPage() {
  const filters = ["All", "Notes", "Flows", "Simulations", "Comparisons", "Chats"];

  return (
    <>
      <div className="canvas-header">
        <h1 className="canvas-title">Library</h1>
        <p className="canvas-subtitle">Searchable archive of all saved work</p>
      </div>

      <div className="canvas-content">
        {/* Search */}
        <input
          type="text"
          className="input"
          placeholder="Search notes, flows, simulations, comparisons..."
          style={{ marginBottom: 16 }}
        />

        {/* Filter pills */}
        <div className="pill-group" style={{ marginBottom: 24 }}>
          {filters.map((f, i) => (
            <button key={f} className={`pill ${i === 0 ? "pill-active" : "pill-inactive"}`}>
              {f}
            </button>
          ))}
        </div>

        {/* Empty state */}
        <div className="empty-state">
          <h3>Library is empty</h3>
          <p>
            Items you save from conversations, flows, and simulations will appear
            here.
          </p>
        </div>
      </div>
    </>
  );
}
