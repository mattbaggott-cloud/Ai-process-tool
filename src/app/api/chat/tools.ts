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
                  enum: ["text", "heading", "image", "divider"],
                  description: "Block type",
                },
                content: {
                  type: "string",
                  description: "Text content (for text and heading blocks)",
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
  ];
}
