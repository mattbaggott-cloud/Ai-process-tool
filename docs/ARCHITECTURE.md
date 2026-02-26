# SocialVerve: AI-First Enterprise Platform — Master Architecture Plan

## Vision

An AI-first platform where natural language is the primary interface for Sales, Marketing, Service, and Partners. The AI chat is the application — structured UI is secondary, rendered inline when needed via slash commands. The knowledge graph is the backbone connecting all entities, relationships, and context.

**User experience**: Talk to the AI → it reads/writes the graph → renders interactive views in the conversation → takes action on connected platforms.

---

## Part 1: Knowledge Graph — The Foundation

### 1A. Workspace Type (B2B vs B2C)

When an org is created, they select their workspace type. This shapes:
- Default entity types visible (B2B shows Companies/Pipeline, B2C shows Orders/Products)
- Default edge types (B2B: works_at, B2C: purchased)
- Default slash commands (B2B: /pipeline /accounts, B2C: /orders /segments)
- AI personality and tool routing

**Schema change**: Add `workspace_type` column to `orgs` table:
```sql
ALTER TABLE orgs ADD COLUMN workspace_type TEXT NOT NULL DEFAULT 'b2c'
  CHECK (workspace_type IN ('b2b', 'b2c', 'hybrid'));
```

Both B2B and B2C use the same graph — workspace_type just controls defaults and AI behavior. Hybrid orgs see everything.

### 1B. Unified Entity Model

**Core principle**: A Person is a Person. Their relationship to the business (lead, customer, partner contact, subscriber, churned) lives on the EDGES, not the node.

**Node types** (what exists as an entity):

| Node Type | What It Represents | Current Table(s) | Status |
|-----------|-------------------|-------------------|--------|
| `person` | Any human being | `ecom_customers`, `crm_contacts`, `klaviyo_profiles` | NEW — replaces 3 separate types |
| `company` | Any organization | `crm_companies` | RENAME from `crm_companies` |
| `pipeline_item` | Sales opportunity (was "deal") | `crm_deals` | RENAME from `crm_deals` |
| `order` | A purchase transaction | `ecom_orders` | RENAME from `ecom_orders` |
| `product` | Something you sell | `ecom_products`, `crm_products` | MERGE |
| `activity` | A logged interaction | `crm_activities` | RENAME from `crm_activities` |
| `campaign` | Marketing campaign | `email_campaigns` | NEW graph node type |
| `segment` | Customer grouping | `segments` | NEW graph node type |
| `document` | Uploaded file/article | `library_files`, `library_items` | NEW graph node type |
| `case` | Service ticket/issue | (new table needed) | FUTURE |
| `quote` | Pricing proposal | (new table needed) | FUTURE |
| `email` | Email message | (new table needed) | FUTURE |
| `note` | Freeform context | (stored on edge properties or as activity) | PATTERN |

**Database tables stay as-is** — we don't rename `crm_deals` to `pipeline_items` in Postgres. The entity_type in graph_nodes is the abstraction layer. The graph translates between table-level naming and concept-level naming.

### 1C. Unified Edge Model

Edges carry the relationship AND the lifecycle state. This is the key insight.

**Core edge types:**

| Edge Type | From → To | Metadata on Edge | Example |
|-----------|-----------|-----------------|---------|
| `works_at` | Person → Company | role, title, department, status | "VP Sales at Acme" |
| `manages` | Person → Person | — | "Sarah manages Tom" |
| `involved_in` | Person → Pipeline Item | role (champion, decision_maker, influencer) | "Chris is champion on Acme deal" |
| `opportunity_for` | Pipeline Item → Company | — | "Enterprise deal for Acme" |
| `purchased` | Person → Order | — | "Chris placed order #1042" |
| `contains` | Order → Product | quantity, price | "Order has 3x Enterprise licenses" |
| `received` | Person → Campaign | status (sent, opened, clicked, bounced) | "Chris opened the VIP email" |
| `belongs_to` | Person → Segment | — | "Chris is in VIP segment" |
| `parent_of` | Company → Company | — | "Acme Corp parent of Acme EU" |
| `partner_of` | Company → Company | tier, since | "Acme is Gold partner" |
| `assigned_to` | Pipeline Item → Person | — | "Deal assigned to Sarah (rep)" |
| `account_owner` | Company → Person | — | "Sarah owns the Acme account" |
| `documented_in` | Product → Document | — | "Enterprise Plan documented in pricing.pdf" |
| `resolves` | Document → (Case type) | — | "Troubleshooting guide resolves API errors" |
| `same_person` | Person → Person | confidence, source | Identity resolution (ALREADY EXISTS) |
| `has_note` | (Any) → Activity | — | "Deal has a call note" |
| `quoted_in` | Product → Quote | quantity, price, discount | FUTURE |
| `raised` | Person → Case | priority, status | FUTURE |
| `replied_to` | Person → Email | — | FUTURE |

**Lifecycle on edges** (via `properties` JSONB):

```jsonc
// Person → Company edge
{
  "status": "active_customer",  // lead, prospect, active_customer, churned, partner
  "since": "2025-06-15",
  "ltv": 15000,
  "source": "shopify"
}

// Person → Pipeline Item edge
{
  "role": "decision_maker",
  "stage": "proposal",           // lead, qualified, proposal, negotiation, won, lost
  "entered_stage": "2026-02-20"
}
```

### 1D. What We Build (Graph Enrichment Steps)

**Step 1: Migration `032_graph_enrichment.sql`**

```sql
-- 1. Workspace type on orgs
ALTER TABLE orgs ADD COLUMN workspace_type TEXT NOT NULL DEFAULT 'b2c'
  CHECK (workspace_type IN ('b2b', 'b2c', 'hybrid'));

-- 2. Entity type registry (replaces hardcoded TABLE_MAPPINGS)
CREATE TABLE entity_type_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  display_name_plural TEXT NOT NULL,
  icon TEXT,                          -- icon identifier for UI
  source_table TEXT,                  -- which DB table backs this
  label_template TEXT,                -- how to build display label
  workspace_types TEXT[] NOT NULL DEFAULT '{b2b,b2c,hybrid}',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, entity_type)
);

-- 3. Relation type registry (replaces hardcoded edge types)
CREATE TABLE relation_type_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  from_entity_type TEXT NOT NULL,
  to_entity_type TEXT NOT NULL,
  cardinality TEXT DEFAULT 'many_to_many'
    CHECK (cardinality IN ('one_to_one', 'one_to_many', 'many_to_many')),
  is_directed BOOLEAN DEFAULT true,
  workspace_types TEXT[] NOT NULL DEFAULT '{b2b,b2c,hybrid}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, relation_type, from_entity_type, to_entity_type)
);

-- 4. Seed default registries (system-level, org_id = NULL for defaults)
-- B2B defaults: person, company, pipeline_item, activity, document, product
-- B2C defaults: person, order, product, segment, campaign, activity, document
-- Both: person, company, pipeline_item, order, product, activity, segment, campaign, document
```

**Step 2: Refactor `graph-sync.ts`**
- Replace hardcoded TABLE_MAPPINGS with runtime registry lookup
- `syncRecordToGraph()` reads entity_type_registry to determine how to build labels
- `syncEdges()` reads relation_type_registry to determine valid edges
- Fallback to current TABLE_MAPPINGS if registry is empty (backwards compatible)

**Step 3: Refactor `graph-query.ts`**
- Replace hardcoded ENTITY_LABELS and RELATION_LABELS with registry lookup
- `getGraphContext()` pulls display names from registry
- Entity resolution works the same — label matching against graph_nodes

**Step 4: Update data connectors to write enriched edges**
- Shopify sync: creates `person` nodes (not `ecom_customers`), creates `purchased` edges to orders
- HubSpot sync: creates `person` nodes (not `crm_contacts`), creates `works_at` edges to companies, `involved_in` edges to pipeline items
- CSV import: maps to unified entity types based on target table
- Identity resolution: `same_person` edges (already works)

**Step 5: Update AI tools**
- `query_ecommerce` and `search_crm` continue working (backwards compatible, query same tables)
- `analyze_data` queries across all tables via SQL (already does this)
- New tool: `update_graph` — AI can create/update nodes and edges directly
- New tool: `add_note` — creates an activity node linked to any entity via edge

---

## Part 2: AI Write Capabilities (Actions)

### Current state: AI can READ everything but WRITE is limited

**Write gaps to fill (priority order):**

| Action | Tool Name | What It Does | Priority |
|--------|-----------|-------------|----------|
| Add note to any entity | `add_note` | Creates activity + edge to person/company/deal | P0 |
| Update pipeline stage | (exists: `update_deal_stage`) | Move deal through stages | DONE |
| Update person/contact | `update_person` | Change fields on any person record | P0 |
| Update company | `update_company` | Change fields on any company record | P1 |
| Log a call/meeting | (exists: `log_activity`) | Record interaction | DONE |
| Create quote | `create_quote` | Generate pricing proposal for deal | P2 |
| Update graph edge | `update_relationship` | Change edge metadata (status, role, etc.) | P1 |
| Bulk update | `bulk_update` | Update multiple records at once | P2 |

### Actions need to write to BOTH the source table AND the graph

Every write tool must:
1. Update the source table (e.g., `crm_deals`)
2. Sync to graph (already handled by `syncRecordToGraphInBackground`)
3. Log to events table (already handled by action executor)
4. Extract memories if relevant (already handled)

---

## Part 3: Persistent Document Management

### What changes:

**Step 1: Formal `library_files` migration** (currently missing from schema)
- Add: org_id, category, tags, team_id, source_type
- Categories: knowledge_article, sales_collateral, brand_asset, product_doc, training, legal, other

**Step 2: Documents become graph nodes**
- When a file is uploaded and embedded, also create a `document` node in graph
- Edges link documents to relevant entities:
  - `documented_in`: Product → Document
  - `resolves`: Document → Case type
  - `used_by`: Document → Department/Team
  - `created_by`: Person → Document

**Step 3: AI can search and cite documents**
- `hybridSearch()` already includes library_files
- Add source attribution: "Based on [Sales Playbook Q4], here's the approach..."
- AI can recommend relevant documents during conversations

**Step 4: Knowledge article management**
- AI can create new articles: `create_knowledge_article` tool
- AI can update articles: `update_knowledge_article` tool
- Service team asks "how do I resolve X" → AI searches KB → cites article → drafts response

---

## Part 4: Slash Command Architecture

Slash commands render rich interactive views inside the chat conversation. They are NOT separate pages.

### Architecture:

1. User types `/pipeline` in chat
2. Frontend detects slash command, sends to `/api/chat` with `slashCommand: "pipeline"` flag
3. Backend routes to a specialized handler (not the general Claude conversation)
4. Handler queries relevant data, returns a structured response with inline components
5. Frontend renders the interactive view inside the chat message area

### Initial slash commands:

| Command | Renders | Who uses it | Workspace |
|---------|---------|-------------|-----------|
| `/pipeline` | Kanban board of deals by stage | Sales | B2B |
| `/accounts` | Table of companies with health indicators | Sales | B2B |
| `/people` | Filterable list of all people | Everyone | Both |
| `/orders` | Recent orders with status | Commerce | B2C |
| `/segments` | Segment list with member counts | Marketing | Both |
| `/campaigns` | Campaign list with performance metrics | Marketing | Both |
| `/inbox` | Unified notifications/emails | Everyone | Both |
| `/service` | Service case queue | Service | Both |
| `/knowledge` | Knowledge article browser | Service | Both |
| `/calendar` | Meeting/activity calendar | Everyone | Both |

### What we build now vs later:

**Now (Phase 1)**: The slash command infrastructure — detection, routing, handler pattern. Implement 2-3 commands to prove the pattern.

**Later**: Each new slash command is just a new handler + inline component. The pattern scales infinitely.

---

## Part 5: Proactive AI (Future)

Not building now, but the architecture supports it:

- **Notification nodes**: Events create graph nodes → AI monitors for patterns → pushes alerts
- **Background agents**: Scheduled jobs that scan the graph for "accounts not touched in 30 days"
- **Email integration**: Inbound emails become `email` nodes in the graph → AI can surface and draft replies

---

## Implementation Order

### Phase 4: Graph Enrichment (DO FIRST — before ingesting data)

| Step | What | Files | Est. Lines |
|------|------|-------|-----------|
| 4.1 | Migration: workspace_type + registries | `supabase/migrations/032_graph_enrichment.sql` | ~150 |
| 4.2 | Seed default entity/relation registries | Same migration | ~100 |
| 4.3 | Refactor graph-sync.ts — registry-driven | `src/lib/agentic/graph-sync.ts` | ~200 modified |
| 4.4 | Refactor graph-query.ts — registry-driven | `src/lib/agentic/graph-query.ts` | ~80 modified |
| 4.5 | Update Shopify sync — unified entity types | `src/lib/shopify/sync-service.ts` | ~50 modified |
| 4.6 | Update HubSpot sync — unified entity types | `src/lib/hubspot/sync-service.ts` | ~50 modified |
| 4.7 | Update CSV import — unified entity types | `src/app/api/chat/tool-executor.ts` | ~30 modified |
| 4.8 | TypeScript verification + tests | — | — |

### Phase 5: AI Write Capabilities

| Step | What | Files | Est. Lines |
|------|------|-------|-----------|
| 5.1 | `add_note` tool — attach note to any entity | `tools.ts` + `tool-executor.ts` | ~80 |
| 5.2 | `update_person` tool — update any person field | `tools.ts` + `tool-executor.ts` | ~60 |
| 5.3 | `update_company` tool — update company fields | `tools.ts` + `tool-executor.ts` | ~50 |
| 5.4 | `update_relationship` tool — change edge metadata | `tools.ts` + `tool-executor.ts` | ~70 |
| 5.5 | System prompt update — teach AI about write capabilities | `route.ts` | ~30 |

### Phase 6: Document Management

| Step | What | Files |
|------|------|-------|
| 6.1 | Migration: formalize library_files table | `supabase/migrations/033_document_storage.sql` |
| 6.2 | Document → graph node on upload | `src/lib/embeddings/index.ts` + `graph-sync.ts` |
| 6.3 | `create_knowledge_article` tool | `tools.ts` + `tool-executor.ts` |
| 6.4 | `update_knowledge_article` tool | `tools.ts` + `tool-executor.ts` |
| 6.5 | Document citation in AI responses | `route.ts` system prompt |

### Phase 7: Slash Command Infrastructure

| Step | What | Files |
|------|------|-------|
| 7.1 | Slash command detection + routing | `HomeChat.tsx` + `route.ts` |
| 7.2 | `/pipeline` — inline Kanban view | New inline component |
| 7.3 | `/people` — inline people browser | New inline component |
| 7.4 | `/accounts` — inline accounts table | New inline component |

### Phase 8: Proactive AI + Email Integration (Future)

### Phase 9: Role-Based Views + Team Routing (Future)

---

## What Does NOT Change

- Database table names (ecom_customers, crm_contacts, etc.) — the graph abstracts over them
- Existing tools (query_ecommerce, search_crm, analyze_data) — backwards compatible
- The Data Agent (DRGCP pipeline) — it queries tables directly via SQL
- Segments, Campaigns, Email generation — all continue working
- Side panel chat (AIChat.tsx) — continues working alongside home chat
- Authentication, org management, RLS — untouched

## Why This Scales

1. **New entity types** = new rows in `entity_type_registry` + new rows in `graph_nodes`. No code change.
2. **New relationship types** = new rows in `relation_type_registry` + new rows in `graph_edges`. No code change.
3. **New data sources** = new connector that calls `syncRecordToGraph()` with the right entity_type. Same pattern as Shopify/HubSpot.
4. **New slash commands** = new handler function + new inline component. Same routing pattern.
5. **New AI actions** = new tool definition + handler. Same pattern as existing 48 tools.
6. **B2B customer wants pipeline + accounts** = workspace_type='b2b', default entity types include pipeline_item + company.
7. **B2C customer wants orders + segments** = workspace_type='b2c', default entity types include order + segment.
8. **Hybrid customer** = workspace_type='hybrid', sees everything.

Nothing breaks when you add more. Every extension follows the same pattern.

---

## Verification Checklist

After Phase 4 (Graph Enrichment):
- [ ] `npx tsc --noEmit` passes
- [ ] Existing tests pass (131)
- [ ] New org creation asks for workspace_type
- [ ] Entity type registry seeded with defaults
- [ ] Relation type registry seeded with defaults
- [ ] Shopify sync creates `person` nodes (not `ecom_customers`)
- [ ] HubSpot sync creates `person` nodes (not `crm_contacts`)
- [ ] `getGraphContext()` uses registry for display names
- [ ] Existing tools (query_ecommerce, search_crm) still work
- [ ] AI copilot still resolves entity mentions in chat
