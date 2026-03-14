export const PLUGIN_ID = "paperclip-plugin-github-issues";
export const PLUGIN_VERSION = "0.1.0";

export const TOOL_NAMES = {
  search: "search",
  link: "link",
  unlink: "unlink",
} as const;

export const WEBHOOK_KEYS = {
  github: "github-events",
} as const;

export const JOB_KEYS = {
  periodicSync: "periodic-sync",
} as const;

export const SLOT_IDS = {
  issueTab: "github-issue-tab",
  settingsPage: "github-settings",
} as const;

export const EXPORT_NAMES = {
  issueTab: "GitHubIssueTab",
  settingsPage: "GitHubSettingsPage",
} as const;

export const STATE_KEYS = {
  linkPrefix: "link:",
  ghPrefix: "gh:",
  lastSyncPrefix: "last-sync:",
} as const;

export const DEFAULT_CONFIG = {
  githubTokenRef: "",
  defaultRepo: "",
  syncComments: false,
  syncDirection: "bidirectional" as const,
};
