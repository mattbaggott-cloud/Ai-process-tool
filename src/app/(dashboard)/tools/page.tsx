export default function ToolsPage() {
  const tools = [
    { name: "11x",       category: "AI SDR",             cost: "$5,000+/mo",  bestFor: "High-volume outbound",    setup: "2-4 weeks", rating: "4.2" },
    { name: "AiSDR",     category: "AI SDR",             cost: "$900/mo",     bestFor: "Automated outbound",      setup: "1-2 weeks", rating: "4.0" },
    { name: "Artisan",   category: "AI SDR",             cost: "$2,000+/mo",  bestFor: "Full-cycle AI SDR",       setup: "2-3 weeks", rating: "4.1" },
    { name: "Clay",      category: "Lead Enrichment",    cost: "$149-800/mo", bestFor: "Data enrichment & outreach", setup: "1 week", rating: "4.6" },
    { name: "Apollo",    category: "Lead Enrichment",    cost: "$49-119/mo",  bestFor: "Prospecting & data",      setup: "1-3 days",  rating: "4.3" },
    { name: "Instantly",  category: "Email Automation",  cost: "$30-300/mo",  bestFor: "Cold email at scale",     setup: "1-3 days",  rating: "4.4" },
    { name: "Gong",      category: "Meeting Intel",      cost: "$1,200+/mo",  bestFor: "Sales call analysis",     setup: "1-2 weeks", rating: "4.7" },
  ];

  return (
    <>
      <div className="canvas-header">
        <h1 className="canvas-title">Tools</h1>
        <p className="canvas-subtitle">
          Compare AI and automation tools for your business
        </p>
      </div>

      <div className="canvas-content">
        {/* Filters */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          <select className="select">
            <option>All Categories</option>
            <option>AI SDR</option>
            <option>Lead Enrichment</option>
            <option>Email Automation</option>
            <option>Meeting Intelligence</option>
            <option>CRM</option>
          </select>
          <select className="select">
            <option>Any Budget</option>
            <option>Under $100/mo</option>
            <option>$100-500/mo</option>
            <option>$500-2000/mo</option>
            <option>$2000+/mo</option>
          </select>
          <input type="text" className="input" placeholder="Search tools..." style={{ flex: 1 }} />
        </div>

        {/* Table */}
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Category</th>
                <th>Cost</th>
                <th>Best For</th>
                <th>Setup Time</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.name}>
                  <td className="cell-name">{t.name}</td>
                  <td><span className="tag">{t.category}</span></td>
                  <td>{t.cost}</td>
                  <td>{t.bestFor}</td>
                  <td>{t.setup}</td>
                  <td>{t.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
