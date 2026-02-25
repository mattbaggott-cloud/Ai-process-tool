import type Anthropic from "@anthropic-ai/sdk";

type Tool = Anthropic.Messages.Tool;

export function getToolDefinitions(): Tool[] {
  return [
    /* ── Team tools ─────────────────────────────────────── */
    {
      name: "create_team",
      description:
        "Create a new team in the user's workspace. Use this when the user asks to create, add, or set up a new team.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "The display name for the team (e.g. 'Sales', 'Customer Success')",
          },
          description: {
            type: "string",
            description: "Optional description of how this team works",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "add_team_roles",
      description:
        "Add one or more roles/positions to an existing team. Use when the user wants to add people, roles, or positions to a team.",
      input_schema: {
        type: "object" as const,
        properties: {
          team_name: {
            type: "string",
            description: "The name of the team to add roles to (must match an existing team)",
          },
          roles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Role title (e.g. 'SDR', 'Account Executive')" },
                description: { type: "string", description: "What this role does" },
                headcount: { type: "number", description: "Number of people in this role. Defaults to 1." },
              },
              required: ["name"],
            },
            description: "Array of roles to add",
          },
        },
        required: ["team_name", "roles"],
      },
    },
    {
      name: "add_team_kpis",
      description:
        "Add one or more KPIs (key performance indicators) to an existing team. Use when the user wants to track metrics for a team.",
      input_schema: {
        type: "object" as const,
        properties: {
          team_name: {
            type: "string",
            description: "The name of the team to add KPIs to",
          },
          kpis: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "KPI name (e.g. 'Qualified Leads', 'Revenue')" },
                current_value: { type: "number", description: "Current metric value" },
                target_value: { type: "number", description: "Target metric value" },
                period: {
                  type: "string",
                  enum: ["Day", "Week", "Month", "Quarter", "Year"],
                  description: "Measurement period. Defaults to 'Month'.",
                },
              },
              required: ["name"],
            },
            description: "Array of KPIs to add",
          },
        },
        required: ["team_name", "kpis"],
      },
    },
    {
      name: "add_team_tools",
      description:
        "Add one or more software tools/systems to an existing team. Use when the user mentions tools or software their team uses.",
      input_schema: {
        type: "object" as const,
        properties: {
          team_name: {
            type: "string",
            description: "The name of the team",
          },
          tools: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Tool name (e.g. 'Salesforce', 'HubSpot')" },
                purpose: { type: "string", description: "What the tool is used for (e.g. 'CRM', 'Email outreach')" },
              },
              required: ["name"],
            },
            description: "Array of tools to add",
          },
        },
        required: ["team_name", "tools"],
      },
    },
    {
      name: "update_team_description",
      description:
        "Update a team's description or process documentation. Use when the user wants to describe how a team operates or update their workflow.",
      input_schema: {
        type: "object" as const,
        properties: {
          team_name: {
            type: "string",
            description: "The name of the team",
          },
          description: {
            type: "string",
            description: "The new description text for the team",
          },
        },
        required: ["team_name", "description"],
      },
    },

    /* ── Goal tools ─────────────────────────────────────── */
    {
      name: "create_goal",
      description:
        "Create a new goal or objective in the user's workspace. Use when the user wants to set a goal, target, or objective.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Goal name (e.g. 'Increase pipeline by 40%')" },
          description: { type: "string", description: "What success looks like" },
          status: {
            type: "string",
            enum: ["Backlog", "To Do", "In Progress", "In Review", "Done"],
            description: "Goal status. Defaults to 'Backlog'.",
          },
          owner: { type: "string", description: "Person responsible (e.g. 'Sarah K.')" },
          teams: {
            type: "array",
            items: { type: "string" },
            description: "Team names associated with this goal",
          },
          start_date: { type: "string", description: "Start date in YYYY-MM-DD format" },
          end_date: { type: "string", description: "End date in YYYY-MM-DD format" },
          metric: { type: "string", description: "What metric to track (e.g. 'Pipeline revenue')" },
          metric_target: { type: "string", description: "Target value for the metric (e.g. '$2M')" },
        },
        required: ["name"],
      },
    },
    {
      name: "add_sub_goals",
      description:
        "Add one or more sub-goals to an existing goal. Use when the user wants to break down a goal into smaller tasks or milestones.",
      input_schema: {
        type: "object" as const,
        properties: {
          goal_name: {
            type: "string",
            description: "The name of the parent goal (must match an existing goal)",
          },
          sub_goals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Sub-goal name" },
                description: { type: "string", description: "Sub-goal description" },
                status: {
                  type: "string",
                  enum: ["Backlog", "To Do", "In Progress", "In Review", "Done"],
                  description: "Status. Defaults to 'Backlog'.",
                },
                owner: { type: "string", description: "Person responsible" },
                end_date: { type: "string", description: "Due date in YYYY-MM-DD format" },
              },
              required: ["name"],
            },
            description: "Array of sub-goals to add",
          },
        },
        required: ["goal_name", "sub_goals"],
      },
    },
    {
      name: "update_goal_status",
      description:
        "Update the status of a goal or sub-goal. Use when the user says a goal is complete, in progress, etc.",
      input_schema: {
        type: "object" as const,
        properties: {
          goal_name: {
            type: "string",
            description: "The name of the goal to update",
          },
          sub_goal_name: {
            type: "string",
            description: "If updating a sub-goal, its name. Leave empty to update the parent goal.",
          },
          status: {
            type: "string",
            enum: ["Backlog", "To Do", "In Progress", "In Review", "Done"],
            description: "The new status",
          },
        },
        required: ["goal_name", "status"],
      },
    },

    /* ── Library tools ──────────────────────────────────── */
    {
      name: "create_library_item",
      description:
        "Create a new item in the user's library (a note, document, template, or reference). Use when the user wants to save content, create a note, or document something.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Title of the library item" },
          content: { type: "string", description: "The text content" },
          category: {
            type: "string",
            enum: ["Note", "Document", "Template", "Reference"],
            description: "Item category. Defaults to 'Note'.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for organization (e.g. ['sales', 'pipeline'])",
          },
        },
        required: ["title", "content"],
      },
    },

    /* ── Delete tools ──────────────────────────────────── */
    {
      name: "delete_team_roles",
      description:
        "Delete one or more roles from an existing team. Use when the user wants to remove a role or position from a team.",
      input_schema: {
        type: "object" as const,
        properties: {
          team_name: {
            type: "string",
            description: "The name of the team to remove roles from",
          },
          role_names: {
            type: "array",
            items: { type: "string" },
            description: "Names of the roles to delete",
          },
        },
        required: ["team_name", "role_names"],
      },
    },
    {
      name: "delete_team_kpis",
      description:
        "Delete one or more KPIs from an existing team. Use when the user wants to remove a KPI or metric from a team.",
      input_schema: {
        type: "object" as const,
        properties: {
          team_name: {
            type: "string",
            description: "The name of the team to remove KPIs from",
          },
          kpi_names: {
            type: "array",
            items: { type: "string" },
            description: "Names of the KPIs to delete",
          },
        },
        required: ["team_name", "kpi_names"],
      },
    },
    {
      name: "delete_team_tools",
      description:
        "Delete one or more tools from an existing team. Use when the user wants to remove a software tool from a team.",
      input_schema: {
        type: "object" as const,
        properties: {
          team_name: {
            type: "string",
            description: "The name of the team to remove tools from",
          },
          tool_names: {
            type: "array",
            items: { type: "string" },
            description: "Names of the tools to delete",
          },
        },
        required: ["team_name", "tool_names"],
      },
    },
    {
      name: "delete_goal",
      description:
        "Delete a goal and all its sub-goals. Use when the user wants to remove a goal entirely.",
      input_schema: {
        type: "object" as const,
        properties: {
          goal_name: {
            type: "string",
            description: "The name of the goal to delete",
          },
        },
        required: ["goal_name"],
      },
    },

    /* ── Pain Point tools ─────────────────────────────────── */
    {
      name: "create_pain_point",
      description:
        "Create a new pain point, bottleneck, or challenge in the user's workspace. Use when the user mentions a problem, blocker, friction, challenge, or pain point they're facing.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Pain point name (e.g. 'High customer churn in first 90 days')" },
          description: { type: "string", description: "Detailed description of the pain point" },
          severity: {
            type: "string",
            enum: ["Low", "Medium", "High", "Critical"],
            description: "How severe this pain point is. Defaults to 'Medium'.",
          },
          status: {
            type: "string",
            enum: ["Backlog", "To Do", "In Progress", "In Review", "Done"],
            description: "Tracking status. Defaults to 'Backlog'.",
          },
          owner: { type: "string", description: "Person responsible for addressing this" },
          teams: {
            type: "array",
            items: { type: "string" },
            description: "Affected team names",
          },
          impact_metric: { type: "string", description: "Quantified impact (e.g. 'Customer churn: 15%', '$50K/month lost revenue')" },
          linked_goal_name: { type: "string", description: "Name of an existing goal to link this pain point to (optional)" },
        },
        required: ["name"],
      },
    },
    {
      name: "update_pain_point_status",
      description:
        "Update the status or severity of a pain point. Use when the user says a pain point is resolved, in progress, etc.",
      input_schema: {
        type: "object" as const,
        properties: {
          pain_point_name: { type: "string", description: "The name of the pain point to update" },
          status: {
            type: "string",
            enum: ["Backlog", "To Do", "In Progress", "In Review", "Done"],
            description: "The new status",
          },
          severity: {
            type: "string",
            enum: ["Low", "Medium", "High", "Critical"],
            description: "Updated severity level",
          },
        },
        required: ["pain_point_name"],
      },
    },
    {
      name: "delete_pain_point",
      description:
        "Delete a pain point. Use when the user wants to remove a pain point entirely.",
      input_schema: {
        type: "object" as const,
        properties: {
          pain_point_name: { type: "string", description: "The name of the pain point to delete" },
        },
        required: ["pain_point_name"],
      },
    },

    /* ── Organization tools ──────────────────────────────── */
    {
      name: "update_organization",
      description:
        "Update the user's organization profile. Use when the user mentions their company name, what they sell, their industry, stage, target market, differentiators, or other company info. This is a partial update — only specified fields are changed.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Company name (e.g. 'Acme Corp')" },
          industry: { type: "string", description: "Industry (e.g. 'B2B SaaS', 'FinTech')" },
          description: { type: "string", description: "What the company does / sells" },
          website: { type: "string", description: "Company website URL" },
          stage: {
            type: "string",
            enum: ["Idea", "Pre-Seed", "Seed", "Series A", "Series B", "Series C+", "Growth", "Public"],
            description: "Company stage",
          },
          target_market: { type: "string", description: "Target market or ideal customer profile (ICP)" },
          differentiators: { type: "string", description: "Key differentiators / competitive advantages" },
          notes: { type: "string", description: "Additional business context or notes" },
        },
        required: [],
      },
    },

    /* ── Stack & Catalog tools ────────────────────────────── */
    {
      name: "search_tool_catalog",
      description:
        "Search the user's tool catalog (knowledge base) by name, category, or keyword. Use this to look up tool details, compare options, or answer questions about specific tools. Returns matching tools with full details (description, features, pricing, pros/cons, integrations).",
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query — a tool name, category, subcategory, or keyword (e.g. 'CRM', 'HubSpot', 'sales engagement', 'LLM')",
          },
          category: {
            type: "string",
            description: "Optional category filter (e.g. 'GTM', 'AI/ML', 'Product Management')",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "add_stack_tool",
      description:
        "Add a tool to the user's tech stack. Use when the user says they use a tool, want to add a tool to their stack, or want to start evaluating a tool.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Tool name (e.g. 'HubSpot', 'Salesforce')" },
          description: { type: "string", description: "What this tool does" },
          category: {
            type: "string",
            description: "Category (e.g. 'GTM', 'Product Management', 'AI/ML')",
          },
          teams: {
            type: "array",
            items: { type: "string" },
            description: "Team names that use this tool (e.g. ['Sales', 'Marketing'])",
          },
          team_usage: {
            type: "object",
            description: "How each team uses this tool. Keys are team names, values are usage descriptions. E.g. {\"Sales\": \"Pipeline tracking\", \"Marketing\": \"Lead scoring\"}",
          },
          status: {
            type: "string",
            enum: ["Active", "Evaluating", "Deprecated"],
            description: "Tool status. Defaults to 'Active'.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "remove_stack_tool",
      description:
        "Remove a tool from the user's tech stack. Use when the user wants to remove or deprecate a tool.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "The name of the tool to remove from the stack",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "compare_tools",
      description:
        "Compare 2 or 3 tools from the catalog side by side. Use when the user asks to compare tools, evaluate options, or wants a recommendation between specific tools. Returns full details for each tool.",
      input_schema: {
        type: "object" as const,
        properties: {
          tool_names: {
            type: "array",
            items: { type: "string" },
            description: "Names of the tools to compare (2-3 tool names)",
          },
        },
        required: ["tool_names"],
      },
    },

    /* ── Project tools ──────────────────────────────────── */
    {
      name: "create_project",
      description:
        "Create a new project in the user's workspace. Use when the user wants to create a project, start a new initiative, or set up a workspace for something.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Project name (e.g. 'Q2 Planning', 'Product Launch')",
          },
          description: {
            type: "string",
            description: "Brief description of the project",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "update_canvas",
      description:
        "Add or replace content blocks on a project's canvas. Use when the user asks to write a brief, add content, create an outline, or populate a project's canvas with text, headings, images, or dividers.",
      input_schema: {
        type: "object" as const,
        properties: {
          project_name: {
            type: "string",
            description: "The name of the project (must match an existing project)",
          },
          blocks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["text", "heading", "image", "divider", "bullet_list", "numbered_list", "checklist", "table", "code", "chart", "column_group"],
                  description: "Block type",
                },
                content: {
                  type: "string",
                  description: "Text content (for text, heading, and code blocks)",
                },
                level: {
                  type: "number",
                  enum: [1, 2, 3],
                  description: "Heading level (1=H1, 2=H2, 3=H3). Only for heading blocks.",
                },
                url: {
                  type: "string",
                  description: "Image URL (only for image blocks)",
                },
                alt: {
                  type: "string",
                  description: "Image alt text (only for image blocks)",
                },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string", description: "Item text" },
                      checked: { type: "boolean", description: "Checked state (checklist only)" },
                    },
                    required: ["text"],
                  },
                  description: "List items (for bullet_list, numbered_list, checklist blocks)",
                },
                rows: {
                  type: "array",
                  items: { type: "array", items: { type: "string" } },
                  description: "Table rows as 2D string array. First row = column headers. Example: [[\"Name\",\"Value\"],[\"Alpha\",\"10\"]]",
                },
                language: {
                  type: "string",
                  description: "Programming language label (for code blocks, e.g. 'javascript', 'python')",
                },
                chartType: {
                  type: "string",
                  enum: ["bar", "line", "pie", "area"],
                  description: "Chart type (for chart blocks). Defaults to 'bar'.",
                },
                chartData: {
                  type: "array",
                  items: { type: "object" },
                  description: "Chart data points array. Each object should have keys matching xKey and yKeys. Example: [{\"month\":\"Jan\",\"visitors\":400},{\"month\":\"Feb\",\"visitors\":600}]",
                },
                chartConfig: {
                  type: "object",
                  properties: {
                    title: { type: "string", description: "Chart title" },
                    xKey: { type: "string", description: "Key for X axis (e.g. 'month')" },
                    yKeys: { type: "array", items: { type: "string" }, description: "Keys for Y axis data series (e.g. ['visitors', 'conversions'])" },
                    colors: { type: "array", items: { type: "string" }, description: "Optional hex colors for each series (e.g. ['#2563eb', '#16a34a'])" },
                  },
                  description: "Chart configuration (for chart blocks)",
                },
                columns: {
                  type: "array",
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", description: "Block type" },
                        content: { type: "string" },
                        level: { type: "number" },
                        items: { type: "array", items: { type: "object", properties: { text: { type: "string" }, checked: { type: "boolean" } }, required: ["text"] } },
                        rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                        language: { type: "string" },
                      },
                      required: ["type"],
                    },
                  },
                  description: "For column_group blocks: array of columns, each column is an array of blocks. Example: [[{\"type\":\"text\",\"content\":\"Left\"}],[{\"type\":\"text\",\"content\":\"Right\"}]]",
                },
              },
              required: ["type"],
            },
            description: "Array of content blocks to add to the canvas",
          },
          action: {
            type: "string",
            enum: ["append", "replace"],
            description: "Whether to append blocks to existing content or replace all content. Defaults to 'append'.",
          },
        },
        required: ["project_name", "blocks"],
      },
    },

    /* ── Generate Workflow ─────────────────────────────────── */
    {
      name: "generate_workflow",
      description:
        `Generate a visual workflow/flow diagram in a project's workflow builder. Use when the user asks to create a workflow, process flow, automation diagram, or pipeline.

You provide simplified node and edge data — the system auto-generates IDs, ports, and sizes.

Node types and their purposes:
- "start": Green oval entry point (1 per flow)
- "end": Red oval terminal state (1+ per flow)
- "process": Blue rectangle for manual/automated steps. Set properties.tool_name if a tool is used (e.g. "Salesforce"). Set properties.duration (minutes) and properties.cost (dollars) for simulation.
- "decision": Orange diamond for branching logic. Use edges with labels "Yes"/"No".
- "ai_agent": Purple rectangle for AI-powered steps. Set properties.model (e.g. "claude-sonnet-4") and properties.prompt for instructions.
- "note": Yellow sticky note for annotations (no connections).

Layout tips: Place nodes vertically with ~160px Y spacing. Start at y:0, each row y+160. Branch decisions horizontally with ~280px X offset. Center the main path at x:400.

Edge conventions: Connect "bottom" port of source to "top" port of target for vertical flows. Use "right"/"left" ports for decision branches.`,
      input_schema: {
        type: "object" as const,
        properties: {
          project_name: {
            type: "string",
            description: "The name of the project to add the workflow to (must match an existing project)",
          },
          nodes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                temp_id: {
                  type: "string",
                  description: "Temporary ID for referencing in edges (e.g. 'n1', 'n2'). Will be replaced with a real ID.",
                },
                type: {
                  type: "string",
                  enum: ["start", "end", "process", "decision", "ai_agent", "note"],
                  description: "The node type",
                },
                title: {
                  type: "string",
                  description: "Display title for the node",
                },
                description: {
                  type: "string",
                  description: "Optional description text shown on the node",
                },
                x: {
                  type: "number",
                  description: "X position on canvas (center main path at ~400)",
                },
                y: {
                  type: "number",
                  description: "Y position on canvas (start at 0, increment by ~160 per row)",
                },
                properties: {
                  type: "object",
                  description: "Key-value properties. For process: tool_name, duration, cost, assignee. For ai_agent: model, prompt, duration, cost. For decision: condition.",
                },
              },
              required: ["temp_id", "type", "title", "x", "y"],
            },
            description: "Array of workflow nodes to create",
          },
          edges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source_id: {
                  type: "string",
                  description: "temp_id of the source node",
                },
                target_id: {
                  type: "string",
                  description: "temp_id of the target node",
                },
                source_side: {
                  type: "string",
                  enum: ["top", "right", "bottom", "left"],
                  description: "Which port side on the source node (default: 'bottom')",
                },
                target_side: {
                  type: "string",
                  enum: ["top", "right", "bottom", "left"],
                  description: "Which port side on the target node (default: 'top')",
                },
                label: {
                  type: "string",
                  description: "Optional label (e.g. 'Yes', 'No' for decision branches)",
                },
              },
              required: ["source_id", "target_id"],
            },
            description: "Array of edges connecting nodes",
          },
        },
        required: ["project_name", "nodes", "edges"],
      },
    },
    /* ── Generate Workflow from Document ───────────────────── */
    {
      name: "generate_workflow_from_document",
      description:
        `Generate a workflow from uploaded document content (SOPs, process docs, playbooks, etc.). Use this when the user uploads a document and asks to turn it into a workflow, or when they say "generate a flow from this document".

You will receive the document text. Analyze it to extract:
1. Process steps (→ process nodes)
2. Decision points (→ decision nodes)
3. AI/automation steps (→ ai_agent nodes)
4. The logical sequence and branching

Then generate proper workflow nodes and edges. Follow the same layout conventions as generate_workflow.

Always include a start and end node. Map document sections/steps to process nodes. Look for conditional logic ("if", "when", "depending on") to create decision nodes. Look for automation or AI mentions to create ai_agent nodes.`,
      input_schema: {
        type: "object" as const,
        properties: {
          project_name: {
            type: "string",
            description: "The name of the project to add the workflow to",
          },
          document_text: {
            type: "string",
            description: "The full text content of the document to parse into a workflow",
          },
          document_name: {
            type: "string",
            description: "The name of the source document (for labeling)",
          },
          nodes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                temp_id: {
                  type: "string",
                  description: "Temporary ID for referencing in edges (e.g. 'n1', 'n2')",
                },
                type: {
                  type: "string",
                  enum: ["start", "end", "process", "decision", "ai_agent", "note"],
                  description: "The node type",
                },
                title: {
                  type: "string",
                  description: "Display title for the node",
                },
                description: {
                  type: "string",
                  description: "Optional description text shown on the node",
                },
                x: {
                  type: "number",
                  description: "X position on canvas",
                },
                y: {
                  type: "number",
                  description: "Y position on canvas",
                },
                properties: {
                  type: "object",
                  description: "Key-value properties. For process: tool_name, duration, cost. For ai_agent: model, prompt. For decision: condition.",
                },
              },
              required: ["temp_id", "type", "title", "x", "y"],
            },
            description: "Array of workflow nodes extracted from the document",
          },
          edges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source_id: { type: "string", description: "temp_id of the source node" },
                target_id: { type: "string", description: "temp_id of the target node" },
                source_side: { type: "string", enum: ["top", "right", "bottom", "left"] },
                target_side: { type: "string", enum: ["top", "right", "bottom", "left"] },
                label: { type: "string", description: "Optional label" },
              },
              required: ["source_id", "target_id"],
            },
            description: "Array of edges connecting nodes",
          },
        },
        required: ["project_name", "document_text", "nodes", "edges"],
      },
    },
    /* ── CRM tools ──────────────────────────────────────── */
    {
      name: "create_contact",
      description:
        "Create a new CRM contact. Use when the user asks to add a contact, lead, or person to the CRM.",
      input_schema: {
        type: "object" as const,
        properties: {
          first_name: { type: "string", description: "Contact's first name" },
          last_name: { type: "string", description: "Contact's last name" },
          email: { type: "string", description: "Email address" },
          phone: { type: "string", description: "Phone number" },
          title: { type: "string", description: "Job title" },
          company_name: { type: "string", description: "Company name to link to (will auto-create if not found)" },
          status: { type: "string", enum: ["lead", "active", "inactive", "churned"], description: "Contact status. Defaults to 'lead'." },
          source: { type: "string", enum: ["manual", "import", "ai", "referral"], description: "How this contact was added. Defaults to 'ai'." },
          notes: { type: "string", description: "Optional notes about the contact" },
          tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
        },
        required: ["first_name"],
      },
    },
    {
      name: "update_contact",
      description:
        "Update an existing CRM contact's details. Use when the user asks to update, change, or edit a contact.",
      input_schema: {
        type: "object" as const,
        properties: {
          contact_name: { type: "string", description: "Full name or email of the contact to update" },
          first_name: { type: "string" },
          last_name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: ["lead", "active", "inactive", "churned"] },
          notes: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["contact_name"],
      },
    },
    {
      name: "create_company",
      description:
        "Create a new CRM company. Use when the user asks to add a company or organization to the CRM.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Company name" },
          domain: { type: "string", description: "Company domain (e.g. acme.com)" },
          industry: { type: "string", description: "Industry sector" },
          size: { type: "string", enum: ["startup", "small", "medium", "large", "enterprise"], description: "Company size" },
          description: { type: "string", description: "What the company does" },
          website: { type: "string", description: "Company website URL" },
          phone: { type: "string", description: "Company phone number" },
          annual_revenue: { type: "number", description: "Annual revenue in dollars" },
          employees: { type: "number", description: "Number of employees" },
          sector: { type: "string", description: "Business sector (e.g. Software, Healthcare, Manufacturing)" },
          account_owner: { type: "string", description: "Account owner name" },
        },
        required: ["name"],
      },
    },
    {
      name: "create_deal",
      description:
        "Create a new CRM deal/opportunity. Use when the user asks to add a deal, opportunity, or sale to track.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Deal title" },
          value: { type: "number", description: "Deal value in dollars" },
          stage: { type: "string", enum: ["lead", "qualified", "proposal", "negotiation", "won", "lost"], description: "Pipeline stage. Defaults to 'lead'." },
          contact_name: { type: "string", description: "Contact name to link this deal to" },
          company_name: { type: "string", description: "Company name to link this deal to" },
          expected_close_date: { type: "string", description: "Expected close date (YYYY-MM-DD)" },
          notes: { type: "string", description: "Deal notes" },
          close_reason: { type: "string", description: "Why the deal was won/lost (optional, for retroactively adding closed deals)" },
        },
        required: ["title"],
      },
    },
    {
      name: "update_deal_stage",
      description:
        "Update a deal's pipeline stage. Use when the user asks to move, advance, or update a deal's stage. When moving to 'won' or 'lost', provide a close_reason explaining why.",
      input_schema: {
        type: "object" as const,
        properties: {
          deal_title: { type: "string", description: "Title of the deal to update" },
          new_stage: { type: "string", enum: ["lead", "qualified", "proposal", "negotiation", "won", "lost"], description: "New pipeline stage" },
          notes: { type: "string", description: "Optional notes about the stage change" },
          close_reason: { type: "string", description: "Why the deal was won or lost (used when new_stage is 'won' or 'lost')" },
          lost_to: { type: "string", description: "Competitor name if the deal was lost (used when new_stage is 'lost')" },
        },
        required: ["deal_title", "new_stage"],
      },
    },
    {
      name: "log_activity",
      description:
        "Log a CRM activity (call, email, meeting, note, or task). Use when the user asks to log, record, or add an activity.",
      input_schema: {
        type: "object" as const,
        properties: {
          type: { type: "string", enum: ["call", "email", "meeting", "note", "task"], description: "Activity type" },
          subject: { type: "string", description: "Activity subject/title" },
          description: { type: "string", description: "Details about the activity" },
          contact_name: { type: "string", description: "Contact name to link to" },
          company_name: { type: "string", description: "Company name to link to" },
          deal_title: { type: "string", description: "Deal title to link to" },
        },
        required: ["type", "subject"],
      },
    },
    {
      name: "search_crm",
      description:
        "Search across CRM contacts, companies, and deals. Use when the user asks to find, look up, or search for CRM records.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query" },
          entity_type: { type: "string", enum: ["contacts", "companies", "deals", "all"], description: "Filter by entity type. Defaults to 'all'." },
        },
        required: ["query"],
      },
    },
    {
      name: "get_crm_summary",
      description:
        "Get a summary of the user's CRM data including contact counts, pipeline value, and recent activity. Use when the user asks for a CRM overview or summary.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    /* ── CRM Product & Asset tools ──────────────────────── */
    {
      name: "create_product",
      description:
        "Create a new product/SKU in the CRM product catalog. Use when the user asks to add a product, SKU, or offering.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Product name" },
          sku: { type: "string", description: "Product SKU/code" },
          category: { type: "string", description: "Product category" },
          unit_price: { type: "number", description: "Unit price in dollars" },
          description: { type: "string", description: "Product description" },
        },
        required: ["name"],
      },
    },
    {
      name: "add_deal_line_item",
      description:
        "Add a product/line item to an existing deal. Use when the user wants to add a product to a deal, or specify what's being sold.",
      input_schema: {
        type: "object" as const,
        properties: {
          deal_title: { type: "string", description: "Title of the deal to add the line item to" },
          product_name: { type: "string", description: "Name of the product to add (must exist in product catalog)" },
          quantity: { type: "number", description: "Quantity. Defaults to 1." },
          unit_price: { type: "number", description: "Override unit price (uses product price if not specified)" },
          discount: { type: "number", description: "Discount percentage (0-100). Defaults to 0." },
        },
        required: ["deal_title", "product_name"],
      },
    },
    {
      name: "add_company_asset",
      description:
        "Add an asset/installed product to a company's installed base. Use when the user says a company owns, uses, or has purchased a product.",
      input_schema: {
        type: "object" as const,
        properties: {
          company_name: { type: "string", description: "Name of the company" },
          product_name: { type: "string", description: "Name of the product (must exist in product catalog)" },
          quantity: { type: "number", description: "Quantity. Defaults to 1." },
          purchase_date: { type: "string", description: "Purchase date (YYYY-MM-DD)" },
          renewal_date: { type: "string", description: "Renewal date (YYYY-MM-DD)" },
          annual_value: { type: "number", description: "Annual value in dollars" },
          status: { type: "string", enum: ["active", "expired", "cancelled"], description: "Asset status. Defaults to 'active'." },
        },
        required: ["company_name", "product_name"],
      },
    },

    /* ── Data Import tool ── */
    {
      name: "import_data",
      description:
        "Import CSV/TSV data into the workspace. ONE tool for all imports — CRM contacts, companies, deals, e-commerce customers, orders, or both. Analyze the data first and pick the right target_type. For e-commerce data: deduplicates customers by email, auto-links orders to customers, calculates aggregates. Handles Shopify-style exports where each row is a line item (multiple rows per order) — automatically groups line items by order_number into a single order with a line_items array. For CRM data: simple row-by-row insert.",
      input_schema: {
        type: "object" as const,
        properties: {
          csv_content: {
            type: "string",
            description: "The full CSV/TSV text content (header row + data rows). If raw text, parse it into CSV format first.",
          },
          target_type: {
            type: "string",
            enum: ["crm_contacts", "crm_companies", "crm_deals", "crm_products", "ecom_customers", "ecom_orders", "ecom_both"],
            description: "What to import into. Use 'ecom_both' when rows contain both customer AND order info (most common for order exports). Use 'ecom_customers' or 'ecom_orders' for standalone imports. Use crm_* for CRM data.",
          },
          field_mappings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                csv_column: { type: "string", description: "CSV column header name" },
                target_field: { type: "string", description: "Target field name. For CRM: use the table column name (e.g. first_name, last_name, email, phone, title, status, source, company_name, tags, domain, industry, value, stage, probability). For ecom customers: email, first_name, last_name, phone, tags, accepts_marketing. For ecom orders: order_number, total_price, subtotal_price, total_tax, total_discounts, total_shipping, currency, financial_status, fulfillment_status, tags, note, source_name, processed_at, discount_code, shipping_method. For line items (Shopify-style where each row is one line item): lineitem_name, lineitem_quantity, lineitem_price, lineitem_sku. Prefix with addr_ for customer/billing address (addr_address1, addr_address2, addr_city, addr_province, addr_zip, addr_country, addr_phone, addr_company). Prefix with ship_ for order shipping address (ship_address1, ship_address2, ship_city, ship_province, ship_zip, ship_country, ship_phone, ship_company)." },
              },
              required: ["csv_column", "target_field"],
            },
            description: "Mapping from CSV columns to target fields. For ecom imports, at minimum map an 'email' field for customer deduplication. For Shopify exports, map lineitem_name/lineitem_quantity/lineitem_price — rows sharing the same order_number are automatically grouped.",
          },
        },
        required: ["csv_content", "target_type", "field_mappings"],
      },
    },

    /* ── E-Commerce tools ──────────────────────────────────── */
    {
      name: "query_ecommerce",
      description:
        "Query e-commerce and unified customer data. Use when the user asks about store data, customer insights, order history, product catalog, revenue, AOV, LTV, top customers, recent orders, who is a customer vs lead, etc. The 'unified' entity type combines CRM contacts and Shopify customers into a single view with classifications: 'customer' (has orders), 'lead' (CRM only), 'prospect' (CRM + ecom but no orders), 'ecom_only' (Shopify only, not in CRM). Customers have a 'default_address' JSONB field (address1, city, province, zip, country). Orders have 'shipping_address' and 'billing_address' JSONB fields with the same structure. You can filter on nested address fields using dot notation (e.g. 'default_address->zip', 'shipping_address->city').",
      input_schema: {
        type: "object" as const,
        properties: {
          entity_type: {
            type: "string",
            enum: ["customers", "orders", "products", "unified"],
            description: "Which entity to query. 'customers' = ecom_customers, 'orders' = ecom_orders, 'products' = ecom_products, 'unified' = cross-silo view combining CRM contacts + ecom customers with classification (customer/lead/prospect/ecom_only)",
          },
          query_type: {
            type: "string",
            enum: ["list", "count", "aggregate", "search"],
            description: "Type of query. 'list' returns records, 'count' returns a count, 'aggregate' returns sum/avg/min/max, 'search' searches by keyword. Defaults to 'list'.",
          },
          filters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string", description: "Field to filter on (e.g. 'email', 'financial_status', 'total_spent', 'product_type', 'tags', 'default_address->zip', 'shipping_address->city', 'shipping_address->province')" },
                operator: { type: "string", enum: ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "contains", "is_null", "is_not_null"], description: "Filter operator" },
                value: { type: "string", description: "Filter value" },
              },
              required: ["field", "operator"],
            },
            description: "Filter conditions for the query",
          },
          aggregate_field: {
            type: "string",
            description: "Field to aggregate (for 'aggregate' query_type). E.g. 'total_price', 'total_spent', 'orders_count'.",
          },
          aggregate_function: {
            type: "string",
            enum: ["sum", "avg", "min", "max", "count"],
            description: "Aggregation function. Defaults to 'sum'.",
          },
          search_query: {
            type: "string",
            description: "Search keyword (for 'search' query_type). Searches across email, name, title, order_number.",
          },
          sort_field: {
            type: "string",
            description: "Field to sort by. Defaults to 'created_at'.",
          },
          sort_direction: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort direction. Defaults to 'desc'.",
          },
          limit: {
            type: "number",
            description: "Maximum records to return (for 'list' query_type). Defaults to 20, max 100.",
          },
        },
        required: ["entity_type"],
      },
    },

    /* ── Order Line Item Search ───────────────────────────────── */
    {
      name: "search_order_line_items",
      description:
        "Search inside order line items by product name/title. Use this when the user asks about customers who bought specific products (e.g. 'steak', 'ribeye', 'coffee', 'premium blend'), top customers by spend on certain products, or product-level purchase history. This searches the JSONB line_items inside ecom_orders and can aggregate by customer. The search is fuzzy — you should expand the user's terms to include related product names (e.g. 'steak' → also search 'ribeye', 'filet mignon', 'new york strip', 'sirloin', 't-bone').",
      input_schema: {
        type: "object" as const,
        properties: {
          search_terms: {
            type: "array",
            items: { type: "string" },
            description: "Product name keywords to search for (case-insensitive, OR logic). Expand the user's query — e.g. if they say 'steak', include ['steak', 'ribeye', 'filet', 'new york strip', 'sirloin', 't-bone', 'strip steak', 'tenderloin']. Each term is matched with ILIKE.",
          },
          result_type: {
            type: "string",
            enum: ["top_customers", "product_summary", "order_list"],
            description: "What to return. 'top_customers' = customers ranked by spend on matching products (default). 'product_summary' = products matching the search with total revenue/quantity. 'order_list' = individual orders containing matching products.",
          },
          sort_by: {
            type: "string",
            enum: ["spend", "quantity", "orders"],
            description: "Sort field for top_customers. 'spend' = total $ spent on matching products (default). 'quantity' = total units purchased. 'orders' = number of orders.",
          },
          limit: {
            type: "number",
            description: "Maximum results to return. Defaults to 10.",
          },
        },
        required: ["search_terms"],
      },
    },

    {
      name: "search_tool_results",
      description:
        "Search through previously retrieved tool results from this conversation using semantic + keyword hybrid search. Use when you received a summarized tool result and need specific details — e.g. a particular customer's data, a specific product's revenue, or exact numbers from a large dataset. The full data was stored in the vector index when the result was summarized.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "What to search for in stored results (e.g., 'customer with highest spend', 'ribeye orders', 'Jane Smith lifetime value')",
          },
          limit: {
            type: "number",
            description: "Max chunks to return. Default 5.",
          },
        },
        required: ["query"],
      },
    },

    /* ── E-Commerce Analytics tools ─────────────────────────── */
    {
      name: "query_ecommerce_analytics",
      description:
        "Run advanced e-commerce analytics queries. Use when the user asks about revenue trends, average order value (AOV), customer lifetime value (LTV), repeat purchase rates, top products, cohort analysis, or RFM segmentation. Returns computed metrics with data suitable for inline charts and tables.",
      input_schema: {
        type: "object" as const,
        properties: {
          metric: {
            type: "string",
            enum: ["revenue", "aov", "ltv", "repeat_rate", "top_products", "cohort", "rfm"],
            description:
              "Which metric to compute. 'revenue' = revenue over time (monthly). 'aov' = average order value over time. 'ltv' = customer lifetime value distribution. 'repeat_rate' = percentage of customers who ordered more than once. 'top_products' = best-selling products by revenue or quantity. 'cohort' = customer cohort analysis by first-order month. 'rfm' = RFM (Recency, Frequency, Monetary) customer segmentation.",
          },
          time_range: {
            type: "string",
            enum: ["30d", "90d", "6m", "12m", "all"],
            description: "Time range for the analysis. Defaults to '12m'.",
          },
          group_by: {
            type: "string",
            enum: ["day", "week", "month"],
            description: "Time grouping for trend metrics (revenue, aov). Defaults to 'month'.",
          },
          limit: {
            type: "number",
            description: "Max results for ranked lists (top_products, ltv, rfm). Defaults to 10.",
          },
          sort_by: {
            type: "string",
            enum: ["revenue", "quantity", "orders"],
            description: "Sort field for top_products. Defaults to 'revenue'.",
          },
          compare_previous: {
            type: "boolean",
            description: "Include comparison to previous period (e.g. this month vs last month). Defaults to false.",
          },
        },
        required: ["metric"],
      },
    },

    /* ── Inline Rendering tools ────────────────────────────── */
    {
      name: "create_inline_table",
      description:
        "Render a data table inline in the chat response. Use this when presenting structured data like customer lists, product rankings, comparisons, or any tabular data. The table will be rendered as a rich interactive element in the chat message. Return the table data and the AI will continue its response after the table.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: {
            type: "string",
            description: "Table title displayed above the table",
          },
          headers: {
            type: "array",
            items: { type: "string" },
            description: "Column headers (e.g. ['Customer', 'Orders', 'LTV', 'AOV'])",
          },
          rows: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" },
            },
            description: "2D array of row data. Each inner array is one row matching the headers.",
          },
          footer: {
            type: "string",
            description: "Optional footer text (e.g. 'Showing top 10 of 150 customers')",
          },
        },
        required: ["headers", "rows"],
      },
    },
    {
      name: "create_inline_chart",
      description:
        "Render a chart inline in the chat response. Use this when visualizing trends, comparisons, or distributions. The chart will be rendered as a rich interactive element in the chat. Supports bar, line, pie, and area charts.",
      input_schema: {
        type: "object" as const,
        properties: {
          chart_type: {
            type: "string",
            enum: ["bar", "line", "pie", "area"],
            description: "Chart type. Use 'bar' for comparisons, 'line' for trends over time, 'pie' for proportions, 'area' for cumulative trends.",
          },
          title: {
            type: "string",
            description: "Chart title displayed above the chart",
          },
          data: {
            type: "array",
            items: { type: "object" },
            description: "Chart data points. Each object should have keys matching x_key and y_keys. Example: [{\"month\":\"Jan\",\"revenue\":5000},{\"month\":\"Feb\",\"revenue\":7500}]",
          },
          x_key: {
            type: "string",
            description: "Key for X axis labels (e.g. 'month', 'product', 'segment')",
          },
          y_keys: {
            type: "array",
            items: { type: "string" },
            description: "Keys for Y axis data series (e.g. ['revenue'], or ['this_period', 'last_period'] for comparison)",
          },
          colors: {
            type: "array",
            items: { type: "string" },
            description: "Optional hex colors for each series (e.g. ['#2563eb', '#16a34a'])",
          },
        },
        required: ["chart_type", "data", "x_key", "y_keys"],
      },
    },

    /* ── Org Management tools ─────────────────────────────── */
    {
      name: "invite_member",
      description:
        "Invite a new member to the organization by email. Creates an invite link. Permission hierarchy: Owner can invite anyone, Admin can invite manager/user/viewer, Manager can invite user/viewer, User/Viewer cannot invite. IMPORTANT: Always call with confirmed=false first to show the user what will happen, then call again with confirmed=true only after they explicitly confirm.",
      input_schema: {
        type: "object" as const,
        properties: {
          email: { type: "string", description: "Email address of the person to invite" },
          role: {
            type: "string",
            enum: ["admin", "manager", "user", "viewer"],
            description: "Role to assign. Defaults to 'user'. Cannot assign 'owner'.",
          },
          department_names: {
            type: "array",
            items: { type: "string" },
            description: "Optional department names to pre-assign (e.g. ['Sales', 'Marketing'])",
          },
          confirmed: {
            type: "boolean",
            description: "Set to true only after the user explicitly confirms. Always call with false or omit first.",
          },
        },
        required: ["email"],
      },
    },
    {
      name: "list_members",
      description:
        "List all current members of the organization with their roles, emails, and join dates. Also shows pending invites. Any org member can use this.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "update_member_role",
      description:
        "Change a member's role. Requires admin or owner. Cannot change the owner's role or assign owner. IMPORTANT: Always call with confirmed=false first, then confirmed=true only after user explicitly confirms.",
      input_schema: {
        type: "object" as const,
        properties: {
          member_identifier: {
            type: "string",
            description: "Email address or display name of the member",
          },
          new_role: {
            type: "string",
            enum: ["admin", "manager", "user", "viewer"],
            description: "The new role to assign",
          },
          confirmed: {
            type: "boolean",
            description: "Set to true only after the user explicitly confirms.",
          },
        },
        required: ["member_identifier", "new_role"],
      },
    },
    {
      name: "remove_member",
      description:
        "Remove a member from the organization. Requires admin or owner. Cannot remove the owner or yourself. IMPORTANT: Always call with confirmed=false first, then confirmed=true only after user explicitly confirms.",
      input_schema: {
        type: "object" as const,
        properties: {
          member_identifier: {
            type: "string",
            description: "Email address or display name of the member to remove",
          },
          confirmed: {
            type: "boolean",
            description: "Set to true only after the user explicitly confirms.",
          },
        },
        required: ["member_identifier"],
      },
    },
    {
      name: "create_department",
      description:
        "Create a new department in the organization. Requires admin or owner. Departments organize team members into functional groups.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Department name (e.g. 'Sales', 'Engineering', 'Marketing')",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "list_org_info",
      description:
        "Get a summary of the organization: name, member count by role, departments, and pending invites. Any org member can use this.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },

    /* ── Segmentation tools ────────────────────────────────── */
    {
      name: "discover_segments",
      description:
        "Analyze customer behavioral data to discover natural segments. First computes behavioral profiles (purchase intervals, product affinities, lifecycle stage, RFM scores) for all customers, then finds clusters. Use when the user asks to find patterns, discover segments, or analyze customer behavior.",
      input_schema: {
        type: "object" as const,
        properties: {
          min_size: {
            type: "number",
            description: "Minimum number of customers for a segment to be reported. Defaults to 5.",
          },
          focus: {
            type: "string",
            enum: ["behavioral", "product", "lifecycle"],
            description: "Optional focus area for discovery. 'behavioral' emphasizes purchase patterns, 'product' emphasizes product affinities, 'lifecycle' emphasizes customer lifecycle stages.",
          },
        },
        required: [],
      },
    },
    {
      name: "create_segment",
      description:
        `Create a new customer segment. Two modes:

**Mode 1 — Direct customer IDs (PREFERRED for product-based segments):**
When you already have customer IDs (e.g. from search_order_line_items), pass them via customer_ids. This directly populates the segment with those exact customers. Use a simple placeholder rule like { "type": "rule", "field": "id", "operator": "in", "value": "direct" }.

**Mode 2 — Rules-based (for behavioral/RFM/lifecycle segments):**
Rules define which customers belong. The engine resolves fields from customer_behavioral_profiles and ecom_customers.

Common fields from customer_behavioral_profiles:
- lifecycle_stage (text): new, active, loyal, at_risk, lapsed, win_back, champion
- interval_trend (text): accelerating, stable, decelerating, erratic, insufficient_data
- avg_interval_days (numeric): average days between purchases
- engagement_score (numeric 0-1): composite engagement score
- top_product_type (text): most-purchased product type
- days_until_predicted (integer): days until predicted next purchase
- inferred_comm_style (text): casual, data_driven, aspirational, urgency_responsive, social_proof
- consistency_score (numeric 0-1): purchase regularity
- recency_score, frequency_score, monetary_score (integer 1-5): RFM scores
- velocity_score (integer 1-5): purchase acceleration

Common fields from ecom_customers:
- total_spent (numeric): lifetime spend in USD
- orders_count (integer): total number of orders
- avg_order_value (numeric): average order value
- first_order_at (timestamp): date of first order
- last_order_at (timestamp): date of most recent order
- tags (text[]): customer tags
- accepts_marketing (boolean): marketing consent

Supported operators (work with any field):
- eq, neq: exact match / not equal
- gt, gte, lt, lte: numeric/date comparisons
- in: match any value in comma-separated list
- contains: case-insensitive substring match
- between: range (comma-separated min,max)
- top: returns top N customers ranked by field descending (e.g. top 5 spenders)

Rule format: { "type": "rule", "field": "...", "operator": "...", "value": "..." }
AND rules: { "type": "and", "children": [ ...rules ] }
OR rules: { "type": "or", "children": [ ...rules ] }`,
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Segment name (e.g. 'Loyal Coffee Buyers - Accelerating')",
          },
          description: {
            type: "string",
            description: "Description of what this segment represents",
          },
          segment_type: {
            type: "string",
            enum: ["behavioral", "rfm", "product_affinity", "lifecycle", "custom"],
            description: "Type of segment. Defaults to 'behavioral'.",
          },
          rules: {
            type: "object",
            description: "Rule tree defining segment membership. See tool description for format.",
          },
          parent_segment_id: {
            type: "string",
            description: "UUID of parent segment to create a sub-branch under (optional)",
          },
          branch_dimension: {
            type: "string",
            description: "What dimension this branch represents (e.g. 'product_preference', 'communication_style')",
          },
          branch_value: {
            type: "string",
            description: "The value of this branch (e.g. 'Coffee lovers', 'casual_tone')",
          },
          customer_ids: {
            type: "array",
            items: { type: "string" },
            description: "Direct list of customer UUIDs to populate the segment with. When provided, these customers are inserted directly as segment members — no rules evaluation needed. Use this after search_order_line_items or any other tool that returns customer IDs.",
          },
        },
        required: ["name", "rules"],
      },
    },
    {
      name: "list_segments",
      description:
        "List all active customer segments with their tree structure and member counts. Use when the user asks about existing segments, wants to see segments, or asks 'what segments do we have'.",
      input_schema: {
        type: "object" as const,
        properties: {
          segment_type: {
            type: "string",
            enum: ["behavioral", "rfm", "product_affinity", "lifecycle", "custom"],
            description: "Optional filter by segment type",
          },
        },
        required: [],
      },
    },
    {
      name: "get_segment_details",
      description:
        "Get detailed information about a specific segment including its rules, behavioral insights, and top members. Use when the user asks about a specific segment or wants to drill into segment data.",
      input_schema: {
        type: "object" as const,
        properties: {
          segment_id_or_name: {
            type: "string",
            description: "Segment UUID or name to look up",
          },
          limit: {
            type: "number",
            description: "Max number of member records to return. Defaults to 10.",
          },
        },
        required: ["segment_id_or_name"],
      },
    },
    {
      name: "get_customer_behavioral_profile",
      description:
        "Get the full behavioral analysis for a specific customer — purchase intervals, product affinities, RFM scores, lifecycle stage, predicted next purchase, and communication style. Use when the user asks about a specific customer's behavior or profile.",
      input_schema: {
        type: "object" as const,
        properties: {
          email_or_name: {
            type: "string",
            description: "Customer email or name to look up",
          },
        },
        required: ["email_or_name"],
      },
    },

    {
      name: "delete_segment",
      description:
        "Delete a customer segment and all its members. Use when the user asks to remove, delete, or clean up a segment. Requires the segment ID or name.",
      input_schema: {
        type: "object" as const,
        properties: {
          segment_id_or_name: {
            type: "string",
            description: "Segment UUID or name to delete",
          },
        },
        required: ["segment_id_or_name"],
      },
    },

    /* ── Email Content Engine tools ────────────────────── */

    {
      name: "save_brand_asset",
      description:
        "Save a brand asset (email template, example email, style guide, or HTML template) that the AI will use as a reference when generating emails. Users can paste email content, upload templates from Klaviyo/Mailchimp, or describe their brand voice. The AI will match the tone, style, and formatting of these assets when creating new emails.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for this brand asset (e.g. 'Welcome Email Template', 'Black Friday Style')",
          },
          asset_type: {
            type: "string",
            enum: ["template", "example", "style_guide", "html_template"],
            description: "Type of asset: template (reusable structure), example (sample email to learn from), style_guide (brand voice/tone rules), html_template (raw HTML from Klaviyo/Mailchimp)",
          },
          content_text: {
            type: "string",
            description: "The text content of the asset — email body, style notes, or template text. For HTML templates, put the raw HTML in content_html instead.",
          },
          content_html: {
            type: "string",
            description: "Raw HTML content (for HTML templates from Klaviyo, Mailchimp, etc.)",
          },
          metadata: {
            type: "object",
            description: "Optional metadata — tone (e.g. 'casual', 'professional'), source_tool (e.g. 'klaviyo', 'mailchimp'), tags (array of strings), notes",
          },
        },
        required: ["name", "asset_type"],
      },
    },
    {
      name: "list_brand_assets",
      description:
        "List all saved brand assets (email templates, examples, style guides). Shows what reference material is available for email generation.",
      input_schema: {
        type: "object" as const,
        properties: {
          asset_type: {
            type: "string",
            enum: ["template", "example", "style_guide", "html_template"],
            description: "Filter by asset type (optional — omit to see all)",
          },
        },
        required: [],
      },
    },
    {
      name: "generate_email",
      description:
        "Generate personalized email content using AI, informed by the brand's style assets and the target segment's behavioral profile. The generated email matches the brand's tone and is tailored to the segment's purchase patterns, product preferences, and communication style. Can generate one-off emails or emails for automated cadences/flows.",
      input_schema: {
        type: "object" as const,
        properties: {
          prompt: {
            type: "string",
            description: "What kind of email to generate — describe the goal, offer, message, or context. E.g. 'Write a win-back email offering 15% off for customers who haven't purchased in 30+ days' or 'Create a product launch announcement for our new summer collection'",
          },
          email_type: {
            type: "string",
            enum: ["promotional", "win_back", "nurture", "announcement", "educational", "milestone", "custom"],
            description: "Type of email: promotional (sale/offer), win_back (re-engage lapsed), nurture (build relationship), announcement (news/launch), educational (tips/content), milestone (birthday/anniversary), custom",
          },
          segment_id: {
            type: "string",
            description: "Target segment ID — the email will be tailored to this segment's behavioral profile, communication style, and product preferences. Use list_segments first if needed.",
          },
          name: {
            type: "string",
            description: "Name for this email (optional — auto-generated from type + segment if omitted)",
          },
          brand_asset_ids: {
            type: "array",
            items: { type: "string" },
            description: "Specific brand asset IDs to reference (optional — all assets are included by default)",
          },
        },
        required: ["prompt", "email_type"],
      },
    },
    {
      name: "list_generated_emails",
      description:
        "List previously generated email content. Can filter by segment, status (draft/approved/sent/archived), or view all.",
      input_schema: {
        type: "object" as const,
        properties: {
          segment_id: {
            type: "string",
            description: "Filter to emails for a specific segment",
          },
          status: {
            type: "string",
            enum: ["draft", "approved", "sent", "archived"],
            description: "Filter by status",
          },
        },
        required: [],
      },
    },
    {
      name: "get_generated_email",
      description:
        "Get the full content of a generated email — subject line, preview text, HTML body, plain text, and personalization fields. Use to review or present email content to the user.",
      input_schema: {
        type: "object" as const,
        properties: {
          email_id: {
            type: "string",
            description: "The email content ID",
          },
        },
        required: ["email_id"],
      },
    },

    /* ── Klaviyo Push ─────────────────────────────────────── */
    {
      name: "push_segment_to_klaviyo",
      description:
        "Push a segment's members to a Klaviyo list. Creates or finds a list in Klaviyo, looks up segment member emails, and subscribes them in batches. Requires Klaviyo to be connected. Use when the user wants to send a segment to Klaviyo for email campaigns or flows.",
      input_schema: {
        type: "object" as const,
        properties: {
          segment_id_or_name: {
            type: "string",
            description: "The segment ID (UUID) or name to push. If a name is provided, it will be looked up.",
          },
          list_name: {
            type: "string",
            description: "Optional: name for the Klaviyo list. Defaults to the segment name if not provided.",
          },
        },
        required: ["segment_id_or_name"],
      },
    },

    /* ── Campaign Engine ───────────────────────────────────── */
    {
      name: "create_campaign",
      description:
        "Create an AI-powered email campaign. Handles ALL campaign types: single email, multi-email sequences, broadcast, and AI-segmented sub-groups. For quick single emails (num_emails=1, default), creates the campaign and generates emails immediately. For multi-email sequences (num_emails=2+) or AI sub-grouping (strategy='ai_grouping'), creates strategy groups — the user reviews in the Campaigns UI, then triggers generation. This is the ONLY campaign creation tool — use it for every campaign request.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Campaign name (e.g. 'Holiday Win-Back 2025', 'VIP 3-Email Nurture Sequence')",
          },
          prompt: {
            type: "string",
            description: "Campaign goal, tone, and direction. For multi-email sequences, include timing guidance (e.g. '3 emails over 2 weeks: intro, product recs, urgency'). For AI grouping, describe the strategy (e.g. 'different approaches for high-value vs lapsed').",
          },
          segment_id: {
            type: "string",
            description: "Optional: Segment ID to target. If omitted and customer_ids not provided, targets all customers.",
          },
          customer_ids: {
            type: "array",
            items: { type: "string" },
            description: "Optional: Specific customer UUIDs from a previous data query. Creates an auto-segment. Takes precedence over segment_id.",
          },
          num_emails: {
            type: "number",
            description: "Number of emails per customer. 1 (default) = single email, 2+ = multi-step sequence over time. Set to the exact count the user requested.",
          },
          strategy: {
            type: "string",
            enum: ["auto", "single_group", "ai_grouping"],
            description: "How to group customers. 'auto' (default) = AI decides based on audience size. 'single_group' = everyone gets the same sequence. 'ai_grouping' = Claude analyzes customers and creates 2-6 distinct sub-groups with tailored approaches.",
          },
          campaign_type: {
            type: "string",
            enum: ["per_customer", "broadcast"],
            description: "per_customer (default) = unique AI email per person, broadcast = same email to all",
          },
          email_type: {
            type: "string",
            enum: ["promotional", "win_back", "nurture", "announcement", "welcome", "follow_up", "custom"],
            description: "Type of email campaign (default: custom)",
          },
          template_id: {
            type: "string",
            description: "Optional: brand asset ID of an HTML template to wrap email content in",
          },
          delivery_channel: {
            type: "string",
            enum: ["klaviyo", "mailchimp", "sendgrid", "salesloft"],
            description: "Email delivery provider (default: klaviyo)",
          },
        },
        required: ["name", "prompt"],
      },
    },
    {
      name: "send_campaign",
      description:
        "Send an email campaign through the connected delivery provider. First call with confirmed=false to get a summary of what will be sent. Then call with confirmed=true to actually send. Only approved or edited variants will be sent — rejected or draft variants are skipped. Each email is sent individually through the provider (Klaviyo, etc.).",
      input_schema: {
        type: "object" as const,
        properties: {
          campaign_id: {
            type: "string",
            description: "The campaign ID to send",
          },
          confirmed: {
            type: "boolean",
            description: "false = show summary, true = actually send. Always call with false first for safety.",
          },
        },
        required: ["campaign_id", "confirmed"],
      },
    },
    {
      name: "get_campaign_status",
      description:
        "Get the current status of a campaign including variant counts (draft, approved, rejected, sent, failed), delivery metrics (delivered, opened, clicked, bounced), and campaign metadata.",
      input_schema: {
        type: "object" as const,
        properties: {
          campaign_id: {
            type: "string",
            description: "The campaign ID to check",
          },
        },
        required: ["campaign_id"],
      },
    },
    /* ── Data Agent ─────────────────────────────────────── */
    {
      name: "analyze_data",
      description:
        "Analyze data across ALL domains — ecommerce customers/orders/products, CRM contacts/companies/deals, campaigns, segments, behavioral profiles, and cross-domain queries. This is the PRIMARY tool for ANY data question, analytics query, or business intelligence request. Supports multi-turn follow-up questions (e.g. 'top 5 customers' then 'what are their zip codes' then 'what campaigns did we send them'). Handles JSONB fields, cross-table joins, business term resolution (VIP, at-risk, churned, AOV, etc.), and self-corrects SQL errors automatically. Use this instead of query_ecommerce or search_crm for all new data questions.",
      input_schema: {
        type: "object" as const,
        properties: {
          question: {
            type: "string",
            description: "The user's data question in natural language. Pass the question exactly as the user asked it — the Data Agent handles intent classification, schema discovery, SQL generation, and formatting internally.",
          },
        },
        required: ["question"],
      },
    },
  ];
}
