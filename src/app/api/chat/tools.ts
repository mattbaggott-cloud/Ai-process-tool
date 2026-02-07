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
  ];
}
