import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { TOOL_NAMES, WEBHOOK_KEYS, JOB_KEYS } from "./constants.js";
import * as github from "./github.js";
import * as sync from "./sync.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("GitHub Issues Sync plugin starting");

    // ---------------------------------------------------------------
    // Helper: resolve the GitHub token from config
    // ---------------------------------------------------------------
    async function resolveToken(): Promise<string> {
      const config = await ctx.config.get();
      const ref = config.githubTokenRef as string | undefined;
      if (!ref) throw new Error("githubTokenRef not configured");
      return ctx.secrets.resolve(ref);
    }

    function getDefaultRepo(): string {
      // Will be populated after config.get() in each handler
      return "";
    }

    // ---------------------------------------------------------------
    // Agent tool: search GitHub issues
    // ---------------------------------------------------------------
    ctx.tools.register(TOOL_NAMES.search, async (input) => {
      const token = await resolveToken();
      const config = await ctx.config.get();
      const repo =
        (input.parameters.repo as string) ||
        (config.defaultRepo as string) ||
        "";
      if (!repo) {
        return {
          error:
            "No repository specified. Pass repo parameter or configure a default repository.",
        };
      }
      const query = input.parameters.query as string;
      const results = await github.searchIssues(
        ctx.http.fetch.bind(ctx.http),
        token,
        repo,
        query,
      );
      return {
        total_count: results.total_count,
        issues: results.items.map((issue) => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          url: issue.html_url,
          labels: issue.labels.map((l) => l.name),
          assignees: issue.assignees.map((a) => a.login),
          updated_at: issue.updated_at,
        })),
      };
    });

    // ---------------------------------------------------------------
    // Agent tool: link a GitHub issue to the current Paperclip issue
    // ---------------------------------------------------------------
    ctx.tools.register(TOOL_NAMES.link, async (input) => {
      const token = await resolveToken();
      const config = await ctx.config.get();
      const defaultRepo = config.defaultRepo as string | undefined;
      const ref = github.parseGitHubIssueRef(
        input.parameters.ghIssueUrl as string,
        defaultRepo,
      );
      if (!ref) {
        return { error: "Could not parse GitHub issue reference." };
      }

      const issueId = input.context?.issueId;
      const companyId = input.context?.companyId;
      if (!issueId || !companyId) {
        return {
          error: "This tool must be called in the context of a Paperclip issue.",
        };
      }

      // Check if already linked
      const existing = await sync.getLink(ctx, issueId);
      if (existing) {
        return {
          error: `This issue is already linked to ${existing.ghOwner}/${existing.ghRepo}#${existing.ghNumber}. Unlink first.`,
        };
      }

      const ghIssue = await github.getIssue(
        ctx.http.fetch.bind(ctx.http),
        token,
        ref.owner,
        ref.repo,
        ref.number,
      );

      const syncDirection =
        (config.syncDirection as sync.IssueLink["syncDirection"]) ||
        "bidirectional";

      const link = await sync.createLink(ctx, {
        paperclipIssueId: issueId,
        paperclipCompanyId: companyId,
        ghOwner: ref.owner,
        ghRepo: ref.repo,
        ghNumber: ref.number,
        ghHtmlUrl: ghIssue.html_url,
        ghState: ghIssue.state,
        syncDirection,
      });

      return {
        linked: true,
        github_issue: {
          number: ghIssue.number,
          title: ghIssue.title,
          state: ghIssue.state,
          url: ghIssue.html_url,
        },
        sync_direction: link.syncDirection,
      };
    });

    // ---------------------------------------------------------------
    // Agent tool: unlink
    // ---------------------------------------------------------------
    ctx.tools.register(TOOL_NAMES.unlink, async (input) => {
      const issueId = input.context?.issueId;
      if (!issueId) {
        return {
          error: "This tool must be called in the context of a Paperclip issue.",
        };
      }

      const removed = await sync.removeLink(ctx, issueId);
      return { unlinked: removed };
    });

    // ---------------------------------------------------------------
    // Paperclip event: issue status changed -> sync to GitHub
    // ---------------------------------------------------------------
    ctx.events.on("issue.updated", async (event) => {
      const issueId = event.payload?.id as string | undefined;
      if (!issueId) return;

      const status = event.payload?.status as string | undefined;
      if (!status) return;

      const link = await sync.getLink(ctx, issueId);
      if (!link) return;

      try {
        const token = await resolveToken();
        await sync.syncToGitHub(ctx, link, status, token);
      } catch (err) {
        ctx.logger.error("Failed to sync status to GitHub", { error: err });
      }
    });

    // ---------------------------------------------------------------
    // Paperclip event: comment added -> bridge to GitHub
    // ---------------------------------------------------------------
    ctx.events.on("issue.comment_added", async (event) => {
      const config = await ctx.config.get();
      if (!config.syncComments) return;

      const issueId = event.payload?.issueId as string | undefined;
      const body = event.payload?.body as string | undefined;
      const authorName =
        (event.payload?.authorName as string) || "Paperclip user";
      if (!issueId || !body) return;

      const link = await sync.getLink(ctx, issueId);
      if (!link) return;

      try {
        const token = await resolveToken();
        await sync.bridgeCommentToGitHub(ctx, link, token, body, authorName);
      } catch (err) {
        ctx.logger.error("Failed to bridge comment to GitHub", { error: err });
      }
    });

    // ---------------------------------------------------------------
    // Webhook: GitHub events
    // ---------------------------------------------------------------
    ctx.webhooks?.register(WEBHOOK_KEYS.github, async (delivery) => {
      const event = delivery.headers["x-github-event"] as string | undefined;
      const payload = delivery.parsedBody as Record<string, unknown>;
      if (!event || !payload) return;

      const action = payload.action as string | undefined;
      const issue = payload.issue as Record<string, unknown> | undefined;
      if (!issue) return;

      const number = issue.number as number;
      const repoObj = payload.repository as Record<string, unknown>;
      const fullName = repoObj?.full_name as string;
      if (!fullName) return;

      const [owner, repo] = fullName.split("/");
      if (!owner || !repo) return;

      const link = await sync.getLinkByGitHub(ctx, owner, repo, number);
      if (!link) return;

      // Issue state change
      if (event === "issues" && (action === "closed" || action === "reopened")) {
        const ghState = (action === "closed" ? "closed" : "open") as
          | "open"
          | "closed";
        const ghIssue = {
          state: ghState,
        } as github.GitHubIssue;
        await sync.syncFromGitHub(ctx, link, ghIssue);
      }

      // Comment created
      if (event === "issue_comment" && action === "created") {
        const config = await ctx.config.get();
        if (!config.syncComments) return;

        const comment = payload.comment as Record<string, unknown>;
        const commentBody = comment?.body as string;
        const commentUser = (comment?.user as Record<string, unknown>)
          ?.login as string;

        // Skip comments bridged from Paperclip (prevent echo loop)
        if (commentBody?.includes("[synced from Paperclip]")) return;

        const commentUrl = comment?.html_url as string;
        await ctx.issues.addComment(link.paperclipIssueId, {
          body: `**@${commentUser}** ([GitHub](${commentUrl})):\n\n${commentBody}`,
        });
      }
    });

    // ---------------------------------------------------------------
    // Periodic sync job: catch missed webhooks
    // ---------------------------------------------------------------
    ctx.jobs.register(JOB_KEYS.periodicSync, async () => {
      ctx.logger.info("Running periodic GitHub sync");

      // This is a simplified version - in production you'd iterate all
      // links stored in plugin state. The current SDK doesn't provide
      // a list/scan operation on state, so this job would need to maintain
      // its own index of linked issue IDs.
      //
      // For now, this job serves as the registration point. Full iteration
      // will be implemented once the plugin state API supports listing keys
      // or the plugin uses its own SQLite database.
      ctx.logger.info("Periodic sync complete (index-based iteration pending)");
    });

    // ---------------------------------------------------------------
    // UI data: provide link info for the issue detail tab
    // ---------------------------------------------------------------
    ctx.data.register("issue-link", async ({ issueId }) => {
      if (!issueId) return { linked: false };
      const link = await sync.getLink(ctx, String(issueId));
      if (!link) return { linked: false };

      try {
        const token = await resolveToken();
        const ghIssue = await github.getIssue(
          ctx.http.fetch.bind(ctx.http),
          token,
          link.ghOwner,
          link.ghRepo,
          link.ghNumber,
        );
        return {
          linked: true,
          github: {
            number: ghIssue.number,
            title: ghIssue.title,
            state: ghIssue.state,
            url: ghIssue.html_url,
            labels: ghIssue.labels.map((l) => l.name),
            assignees: ghIssue.assignees.map((a) => a.login),
            updated_at: ghIssue.updated_at,
          },
          syncDirection: link.syncDirection,
          lastSyncAt: link.lastSyncAt,
        };
      } catch {
        return {
          linked: true,
          github: {
            number: link.ghNumber,
            url: link.ghHtmlUrl,
            state: link.lastGhState,
          },
          syncDirection: link.syncDirection,
          lastSyncAt: link.lastSyncAt,
          fetchError: true,
        };
      }
    });

    ctx.logger.info("GitHub Issues Sync plugin ready");
  },

  async onHealth() {
    return { status: "ok", message: "GitHub Issues Sync operational" };
  },

  async onValidateConfig(config) {
    const errors: string[] = [];
    if (!config.githubTokenRef) {
      errors.push("githubTokenRef is required");
    }
    if (
      config.defaultRepo &&
      typeof config.defaultRepo === "string" &&
      !config.defaultRepo.includes("/")
    ) {
      errors.push("defaultRepo must be in owner/repo format");
    }
    return { ok: errors.length === 0, errors };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
