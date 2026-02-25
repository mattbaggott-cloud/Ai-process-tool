# Project Context — AI Workspace MVP (SocialVerve)

## CRITICAL: Read This First in Every New Session

This file exists so that new Claude sessions can pick up exactly where the previous session left off. READ THIS BEFORE DOING ANYTHING.

---

## What This Project Is

An AI-first enterprise platform for marketing teams. Think Salesforce + HubSpot + Klaviyo, but the AI copilot IS the product. The frontend visualizes data; the backend intelligence is the core value.

- **Stack**: Next.js 15 + Supabase (Postgres + pgvector) + Anthropic Claude API
- **Working directory**: `/Users/mattbaggott/Desktop/ai-workspace-mvp/.claude/worktrees/sweet-curie/`
- **Branch**: `claude/sweet-curie` (merge into main at `/Users/mattbaggott/Desktop/ai-workspace-mvp` when deploying)
- **TypeScript check**: `npx tsc --noEmit` must pass before any commit

## Rules

- NEVER push to GitHub without explicit user approval
- NEVER use `git add -A` or `git add .` — stage specific files
- `npx tsc --noEmit` must pass before any commit
- Keep `query_ecommerce` and `search_crm` tools working (backwards compatible)

---

## Current State of the Backend Infrastructure

### BUILT AND WORKING:

| Component | Location | What It Does |
|-----------|----------|--------------|
| **Vector Store** | `document_chunks` table + `hybrid_search()` RPC (migration 002) | Stores text as embeddings (1536-dim), searches by meaning + keywords |
| **Embedding Pipeline** | `src/lib/embeddings/client.ts`, `index.ts`, `chunker.ts`, `search.ts` | `embedDocument()` chunks + embeds text, `hybridSearch()` searches it |
| **Knowledge Graph** | `graph_nodes` + `graph_edges` tables + `graph_traverse()` RPC (migration 014) | Stores entity relationships, traverses N-hop paths |
| **Graph Sync** | `src/lib/agentic/graph-sync.ts` | `ensureGraphNode()`, `syncRecordToGraph()` — auto-syncs CRUD to graph |
| **Graph Query** | `src/lib/agentic/graph-query.ts` | `getGraphContext()` — extracts entity mentions, resolves to graph, injects into system prompt |
| **Memory System** | `memories` table + `retrieve_memories()` RPC (migration 015) | Stores org facts, retrieves by vector similarity + importance |
| **Memory Extractor** | `src/lib/agentic/memory-extractor.ts` | `extractMemories()` — Claude analyzes conversations, stores learnings |
| **Memory Retriever** | `src/lib/agentic/memory-retriever.ts` | `retrieveMemories()`, `formatMemoriesForPrompt()` — injects memories into system prompt |
| **Smart Context (Phase 1)** | `route.ts` lines 1118-1195 | Large tool results stored in `document_chunks`, summarized by Haiku, searchable via `search_tool_results` |
| **48 Domain Tools** | `src/app/api/chat/tools.ts` (1855 lines) + `tool-executor.ts` (~3600 lines) | Full CRUD for teams, goals, CRM, ecom, campaigns, segments, email, etc. |
| **Dynamic Segment Engine** | Migration 029 | `analytics_assign_segment_members()` — introspects `information_schema` at runtime, no hardcoded fields |

### NOT YET BUILT (This is the current sprint):

| Component | Status | Location |
|-----------|--------|----------|
| **Data Agent** | NOT STARTED | `src/lib/data-agent/` — directory does not exist yet |
| **Schema indexed in graph/vectors** | NOT DONE | graph_nodes has NO `entity_type = 'data_table'` rows, document_chunks has NO `source_table = 'schema'` rows |
| **`analyze_data` tool** | NOT DONE | Not in tools.ts or tool-executor.ts |
| **Session state for multi-turn** | NOT DONE | No DataAgentSession implementation |
| **Query history / self-learning** | NOT DONE | No `query_history` table |

### THE CORE PROBLEM:
The infrastructure (vector store, knowledge graph, hybrid search, memories) is built and working but EMPTY of schema data. The AI copilot bypasses all of it and uses hardcoded tool descriptions. This makes it fragile, limited to pre-described fields, and unable to handle follow-up questions.

---

## The Active Plan: Phase 2 — Data Agent

**Full plan file**: `/Users/mattbaggott/.claude/plans/snug-mixing-bee.md` (805 lines)
READ THE FULL PLAN before writing any code. It has exact file paths, function signatures, type definitions, and implementation details for every step.

### Summary: 16 Steps Across 3 Days

**DAY 1 — Fuel the Engine (Steps 1-7):**
Index the database schema into the knowledge graph and vector store.
1. Migration `030_data_agent.sql` — RPCs (`get_platform_schema`, `get_table_relationships`, `exec_safe_sql`) + `query_history` table
2. `src/lib/data-agent/types.ts` — SchemaMap, DataAgentSession, QueryPlan, QueryResult
3. `src/lib/data-agent/schema-introspect.ts` — `getSchemaMap()` reads all tables/columns/FKs/JSONB keys
4. `src/lib/data-agent/schema-indexer.ts` — `indexSchemaToInfrastructure()` fills graph_nodes + graph_edges + document_chunks with schema data
5. `src/lib/data-agent/semantic-layer.yaml` + `semantic-layer.ts` — business terms mapped to SQL ("VIP" = total_spent > 500)
6. `src/lib/data-agent/formatter.ts` — dynamic result formatting from schema metadata
7. Test: `npx tsc --noEmit` + verify schema indexed

**DAY 2 — Build the Driver (Steps 8-13):**
Build the 4-stage DRGC agent pipeline.
8. `src/lib/data-agent/session.ts` — in-memory session state (tracks entity IDs, domain, filters across turns)
9. `src/lib/data-agent/planner.ts` — Haiku classifies: new / follow_up / pivot / refinement
10. `src/lib/data-agent/retriever.ts` — assembles context via hybridSearch + graph_traverse + semantic layer + query_history
11. `src/lib/data-agent/generator.ts` — SQL generation (new) or CoE-SQL editing (follow-ups)
12. `src/lib/data-agent/corrector.ts` — execute, validate, self-correct up to 3 retries
13. `src/lib/data-agent/agent.ts` — orchestrator: Planner -> Retriever -> Generator -> Corrector

**DAY 3 — Wire It Up (Steps 14-16):**
Connect the Data Agent to the copilot.
14. `src/app/api/chat/tools.ts` — add `analyze_data` tool definition
15. `src/app/api/chat/tool-executor.ts` — add `handleAnalyzeData()` handler
16. `src/app/api/chat/route.ts` — update system prompt to steer Claude to `analyze_data`

### Key Existing Functions the Data Agent Wires Into:
- `hybridSearch()` from `src/lib/embeddings/search.ts`
- `embedDocument()` from `src/lib/embeddings/index.ts`
- `ensureGraphNode()` from `src/lib/agentic/graph-sync.ts`
- `graph_traverse()` RPC from migration 014
- `getEmbedding()` from `src/lib/embeddings/client.ts`
- `retrieveMemories()` from `src/lib/agentic/memory-retriever.ts`
- `chunkText()` from `src/lib/embeddings/chunker.ts`

---

## Database Tables (Complete List)

| Domain | Tables |
|--------|--------|
| Ecommerce | `ecom_customers`, `ecom_orders`, `ecom_products` |
| CRM | `crm_contacts`, `crm_companies`, `crm_deals`, `crm_activities`, `crm_deal_line_items`, `crm_company_assets` |
| Campaigns | `email_campaigns`, `email_customer_variants`, `campaign_strategy_groups` |
| Behavioral | `customer_behavioral_profiles`, `segments`, `segment_members` |
| Identity | `customer_identity_links` |
| Org/Teams | `orgs`, `org_members`, `org_profiles`, `teams`, `team_roles`, `team_kpis`, `team_tools`, `goals`, `sub_goals`, `pain_points` |
| Projects | `projects`, `library_items` |
| Tools | `tool_catalog`, `user_stack_tools` |
| Infrastructure | `graph_nodes`, `graph_edges`, `events`, `document_chunks`, `memories`, `llm_logs` |

### Key JSONB Columns:
- `ecom_customers.default_address` — keys: address1, address2, city, province, zip, country, phone, company. Access: `default_address->>'zip'`
- `ecom_orders.shipping_address` — same keys as above
- `ecom_orders.line_items` — JSONB array, each item: {title, quantity, price, sku}. Unnest: `jsonb_array_elements(line_items)`
- `ecom_customers.tags` — text array

---

## Progress Tracker

Update this section at the end of each session:

**Last updated**: 2026-02-23
**Current step**: Phase 3 COMPLETE — All 10 steps built, TypeScript-verified, 131 tests passing
**Next action**: End-to-end testing with live data, then move to actions (updating records, emails, campaigns, etc.)
**Blockers**: None

### Phase 2 Files (Data Agent Core):
**Files created**:
- `supabase/migrations/030_data_agent.sql` (RPCs + query_history table)
- `src/lib/data-agent/types.ts` (type definitions)
- `src/lib/data-agent/schema-introspect.ts` (live schema discovery)
- `src/lib/data-agent/schema-indexer.ts` (fills graph + vector store)
- `src/lib/data-agent/semantic-layer.yaml` (documentation)
- `src/lib/data-agent/semantic-layer.ts` (business term mappings)
- `src/lib/data-agent/formatter.ts` (dynamic result formatting)
- `src/lib/data-agent/session.ts` (multi-turn state)
- `src/lib/data-agent/planner.ts` (intent classification + ambiguity)
- `src/lib/data-agent/retriever.ts` (context assembly)
- `src/lib/data-agent/generator.ts` (SQL generation + CoE-SQL)
- `src/lib/data-agent/corrector.ts` (execute + self-correct)
- `src/lib/data-agent/agent.ts` (orchestrator)
**Files modified**:
- `src/app/api/chat/tools.ts` — added analyze_data tool definition
- `src/app/api/chat/tool-executor.ts` — added handleAnalyzeData handler + import
- `src/app/api/chat/route.ts` — added Data Agent section to system prompt

### Phase 3 Files (Multi-Query Intelligence):
**Files created**:
- `src/lib/data-agent/decomposer.ts` (schema-driven LLM question decomposition)
- `src/lib/data-agent/stitcher.ts` (multi-query result merging: merge_columns, nested, append_rows)
- `src/lib/data-agent/__tests__/decomposer.test.ts` (4 code-guard tests)
- `src/lib/data-agent/__tests__/stitcher.test.ts` (9 stitching strategy tests)
- `src/lib/data-agent/__tests__/presenter.test.ts` (19 template/confidence tests)
**Files modified**:
- `src/lib/data-agent/types.ts` — added SubQuery, DecomposedPlan, StructuredClarification, OutputTemplate, FieldConfidence, FallbackPath, TableConfidenceConfig, ProfileSection, MetricCard; extended QueryPlan, QueryResult, VisualizationSpec, StageTimings
- `src/lib/data-agent/planner.ts` — added buildStructuredClarification() for domain/multi-part clarification
- `src/lib/data-agent/semantic-layer.ts` — added findFallbackPath() for address COALESCE, getFieldConfidence() for verified/ai_inferred/computed metadata, fallback_paths and confidence_registry data
- `src/lib/data-agent/generator.ts` — added semanticLayer param, address fallback COALESCE injection, generateSubQuerySQL()
- `src/lib/data-agent/agent.ts` — added multi-query pipeline: tryDecompose → topological sort → per-sub-query execution → stitch → present; both single-query and multi-query paths
- `src/lib/data-agent/presenter.ts` — added selectTemplate(), buildTemplateOutput() (customer_profile, ranked_list, comparison_table, metric_summary, detail_card), annotateConfidence()
- `src/app/api/chat/tool-executor.ts` — added CLARIFICATION, CONFIDENCE, INLINE_PROFILE, INLINE_METRIC markers
- `src/app/api/chat/route.ts` — expanded vizMarkerRegex and messageForClaude replacements for new markers
- `src/components/layout/AIChat.tsx` — added InlineProfile, InlineMetric, InlineClarification, InlineConfidence components; updated parser and renderer
