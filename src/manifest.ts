import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  EXPORT_NAMES,
  JOB_KEYS,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
  TOOL_NAMES,
  WEBHOOK_KEYS,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "GitHub Issues Sync",
  description:
    "Bidirectional sync between GitHub Issues and Paperclip issues. Link individual GitHub issues, sync status changes, and optionally bridge comments.",
  author: "Matt Van Horn",
  categories: ["connector"],
  capabilities: [
    "issues.read",
    "issues.update",
    "issue.comments.read",
    "issue.comments.create",
    "plugin.state.read",
    "plugin.state.write",
    "events.subscribe",
    "http.outbound",
    "secrets.read-ref",
    "webhooks.receive",
    "agent.tools.register",
    "instance.settings.register",
    "ui.detailTab.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      githubTokenRef: {
        type: "string",
        title: "GitHub Token (secret reference)",
        description:
          "Secret ref for a GitHub personal access token with repo scope",
      },
      defaultRepo: {
        type: "string",
        title: "Default Repository",
        description: "Default repo in owner/repo format for agent searches",
        default: DEFAULT_CONFIG.defaultRepo,
      },
      syncComments: {
        type: "boolean",
        title: "Sync Comments",
        description: "Mirror comments between linked issues",
        default: DEFAULT_CONFIG.syncComments,
      },
      syncDirection: {
        type: "string",
        title: "Sync Direction",
        enum: ["bidirectional", "github-to-paperclip", "paperclip-to-github"],
        default: DEFAULT_CONFIG.syncDirection,
      },
    },
    required: ["githubTokenRef"],
  },
  jobs: [
    {
      jobKey: JOB_KEYS.periodicSync,
      displayName: "Periodic Sync",
      description:
        "Polls linked GitHub issues to catch changes missed by webhooks.",
      schedule: "*/15 * * * *",
    },
  ],
  webhooks: [
    {
      endpointKey: WEBHOOK_KEYS.github,
      displayName: "GitHub Events",
      description:
        "Receives issue and comment events from GitHub. Configure a webhook on your repo pointing to this endpoint.",
    },
  ],
  tools: [
    {
      name: TOOL_NAMES.search,
      displayName: "Search GitHub Issues",
      description:
        "Search GitHub issues in a configured repository. Returns matching issues with status, labels, and assignees.",
      parametersSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (GitHub issue search syntax)",
          },
          repo: {
            type: "string",
            description:
              "Repository in owner/repo format. Omit to use the configured default.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: TOOL_NAMES.link,
      displayName: "Link GitHub Issue",
      description:
        "Link a GitHub issue to the current Paperclip issue for bidirectional sync.",
      parametersSchema: {
        type: "object",
        properties: {
          ghIssueUrl: {
            type: "string",
            description: "GitHub issue URL or owner/repo#number",
          },
        },
        required: ["ghIssueUrl"],
      },
    },
    {
      name: TOOL_NAMES.unlink,
      displayName: "Unlink GitHub Issue",
      description: "Remove the sync link between a GitHub issue and the current Paperclip issue.",
      parametersSchema: {
        type: "object",
        properties: {
          ghIssueUrl: {
            type: "string",
            description: "GitHub issue URL or owner/repo#number",
          },
        },
        required: ["ghIssueUrl"],
      },
    },
  ],
  ui: {
    slots: [
      {
        type: "detailTab",
        id: SLOT_IDS.issueTab,
        displayName: "GitHub",
        exportName: EXPORT_NAMES.issueTab,
        entityTypes: ["issue"],
      },
      {
        type: "settingsPage",
        id: SLOT_IDS.settingsPage,
        displayName: "GitHub Issues Sync",
        exportName: EXPORT_NAMES.settingsPage,
      },
    ],
  },
};

export default manifest;
