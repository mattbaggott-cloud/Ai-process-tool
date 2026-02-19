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

    /* ── Data Import tools ── */
    {
      name: "import_csv_data",
      description:
        "Import CSV data into a CRM table. Use when the user provides CSV content and wants to import it into contacts, companies, deals, or products.",
      input_schema: {
        type: "object" as const,
        properties: {
          csv_content: {
            type: "string",
            description: "The full CSV text content (header row + data rows)",
          },
          target_table: {
            type: "string",
            enum: ["crm_contacts", "crm_companies", "crm_deals", "crm_products"],
            description: "Which CRM table to import into",
          },
          field_mappings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                csv_column: { type: "string", description: "CSV column header name" },
                target_field: { type: "string", description: "Target table field name" },
              },
              required: ["csv_column", "target_field"],
            },
            description: "Mapping from CSV columns to target table fields",
          },
        },
        required: ["csv_content", "target_table", "field_mappings"],
      },
    },

    /* ── CRM Reports ─────────────────────────────────────── */
    {
      name: "create_report",
      description:
        "Create a saved CRM report with configurable columns and filters. Use when the user asks to build, create, or generate a report, or wants to see a filtered list of CRM data. The report is saved and viewable in CRM → Reports tab. Available column keys per entity type: contacts: first_name, last_name, email, phone, title, status, source, company_name, tags, created_at, updated_at. companies: name, domain, industry, size, website, phone, address, annual_revenue, employees, sector, account_owner, contact_count, deal_count, created_at. deals: title, value, stage, probability, expected_close_date, contact_name, company_name, close_reason, lost_to, closed_at, created_at. activities: type, subject, description, contact_name, company_name, scheduled_at, completed_at, created_at. Custom fields use 'cf:field_key' prefix. Filter operators: text fields support 'contains', 'equals', 'not_equals', 'starts_with'. Number/currency fields support 'equals', 'gt', 'gte', 'lt', 'lte'. Date fields support 'before', 'after', 'equals'. Select fields (status, stage, size, source, type) support 'is', 'is_not'.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the report (e.g., 'Active Leads Q1', 'Enterprise Companies by Revenue')",
          },
          entity_type: {
            type: "string",
            enum: ["contacts", "companies", "deals", "activities"],
            description: "Which CRM entity to report on",
          },
          description: {
            type: "string",
            description: "Optional description of what this report shows",
          },
          columns: {
            type: "array",
            items: { type: "string" },
            description: "Array of column keys to display. If omitted, defaults to the entity's default visible columns.",
          },
          filters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string", description: "Field key to filter on" },
                operator: {
                  type: "string",
                  enum: ["equals", "not_equals", "contains", "starts_with", "gt", "gte", "lt", "lte", "before", "after", "is", "is_not", "is_empty", "is_not_empty", "is_true", "is_false"],
                  description: "Filter operator",
                },
                value: { type: "string", description: "Filter value" },
              },
              required: ["field", "operator", "value"],
            },
            description: "Array of filter conditions. Each has field, operator, and value.",
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
        },
        required: ["name", "entity_type"],
      },
    },
    {
      name: "update_report",
      description:
        "Update an existing CRM report's columns, filters, name, or sort config. Use when the user asks to modify, update, add columns to, or change filters on a report they are currently viewing. The report_id is available from the active report context. Only specified fields are updated — omitted fields remain unchanged.",
      input_schema: {
        type: "object" as const,
        properties: {
          report_id: {
            type: "string",
            description: "The UUID of the report to update (from active report context)",
          },
          name: {
            type: "string",
            description: "New name for the report (optional)",
          },
          description: {
            type: "string",
            description: "New description (optional)",
          },
          columns: {
            type: "array",
            items: { type: "string" },
            description: "Full replacement list of column keys. Include ALL desired columns, not just new ones.",
          },
          filters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                operator: { type: "string" },
                value: { type: "string" },
              },
              required: ["field", "operator", "value"],
            },
            description: "Full replacement list of filters.",
          },
          sort_field: { type: "string", description: "Field to sort by" },
          sort_direction: { type: "string", enum: ["asc", "desc"], description: "Sort direction" },
        },
        required: ["report_id"],
      },
    },

    /* ── E-Commerce tools ──────────────────────────────────── */
    {
      name: "query_ecommerce",
      description:
        "Query e-commerce and unified customer data. Use when the user asks about store data, customer insights, order history, product catalog, revenue, AOV, LTV, top customers, recent orders, who is a customer vs lead, etc. The 'unified' entity type combines CRM contacts and Shopify customers into a single view with classifications: 'customer' (has orders), 'lead' (CRM only), 'prospect' (CRM + ecom but no orders), 'ecom_only' (Shopify only, not in CRM).",
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
                field: { type: "string", description: "Field to filter on (e.g. 'email', 'financial_status', 'total_spent', 'product_type', 'tags')" },
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
  ];
}
