/**
 * Sync logic between GitHub Issues and Paperclip issues.
 * Manages link state in plugin state storage and handles
 * bidirectional status + comment syncing.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { STATE_KEYS } from "./constants.js";
import * as github from "./github.js";

export interface IssueLink {
  paperclipIssueId: string;
  paperclipCompanyId: string;
  ghOwner: string;
  ghRepo: string;
  ghNumber: number;
  ghHtmlUrl: string;
  syncDirection: "bidirectional" | "github-to-paperclip" | "paperclip-to-github";
  lastSyncAt: string;
  lastGhState: "open" | "closed";
  lastCommentSyncAt: string | null;
}

function linkStateKey(paperclipIssueId: string): string {
  return `${STATE_KEYS.linkPrefix}${paperclipIssueId}`;
}

function ghStateKey(owner: string, repo: string, number: number): string {
  return `${STATE_KEYS.ghPrefix}${owner}/${repo}#${number}`;
}

export async function getLink(
  ctx: PluginContext,
  paperclipIssueId: string,
): Promise<IssueLink | null> {
  const raw = await ctx.state.get({
    scopeKind: "instance",
    scopeId: "default",
    stateKey: linkStateKey(paperclipIssueId),
  });
  if (!raw) return null;
  return JSON.parse(String(raw)) as IssueLink;
}

export async function getLinkByGitHub(
  ctx: PluginContext,
  owner: string,
  repo: string,
  number: number,
): Promise<IssueLink | null> {
  const raw = await ctx.state.get({
    scopeKind: "instance",
    scopeId: "default",
    stateKey: ghStateKey(owner, repo, number),
  });
  if (!raw) return null;
  const paperclipIssueId = String(raw);
  return getLink(ctx, paperclipIssueId);
}

export async function createLink(
  ctx: PluginContext,
  params: {
    paperclipIssueId: string;
    paperclipCompanyId: string;
    ghOwner: string;
    ghRepo: string;
    ghNumber: number;
    ghHtmlUrl: string;
    ghState: "open" | "closed";
    syncDirection: IssueLink["syncDirection"];
  },
): Promise<IssueLink> {
  const link: IssueLink = {
    paperclipIssueId: params.paperclipIssueId,
    paperclipCompanyId: params.paperclipCompanyId,
    ghOwner: params.ghOwner,
    ghRepo: params.ghRepo,
    ghNumber: params.ghNumber,
    ghHtmlUrl: params.ghHtmlUrl,
    syncDirection: params.syncDirection,
    lastSyncAt: new Date().toISOString(),
    lastGhState: params.ghState,
    lastCommentSyncAt: null,
  };

  await ctx.state.set({
    scopeKind: "instance",
    scopeId: "default",
    stateKey: linkStateKey(params.paperclipIssueId),
    value: JSON.stringify(link),
  });

  await ctx.state.set({
    scopeKind: "instance",
    scopeId: "default",
    stateKey: ghStateKey(params.ghOwner, params.ghRepo, params.ghNumber),
    value: params.paperclipIssueId,
  });

  return link;
}

export async function removeLink(
  ctx: PluginContext,
  paperclipIssueId: string,
): Promise<boolean> {
  const link = await getLink(ctx, paperclipIssueId);
  if (!link) return false;

  await ctx.state.delete({
    scopeKind: "instance",
    scopeId: "default",
    stateKey: linkStateKey(paperclipIssueId),
  });

  await ctx.state.delete({
    scopeKind: "instance",
    scopeId: "default",
    stateKey: ghStateKey(link.ghOwner, link.ghRepo, link.ghNumber),
  });

  return true;
}

async function updateLink(
  ctx: PluginContext,
  link: IssueLink,
): Promise<void> {
  link.lastSyncAt = new Date().toISOString();
  await ctx.state.set({
    scopeKind: "instance",
    scopeId: "default",
    stateKey: linkStateKey(link.paperclipIssueId),
    value: JSON.stringify(link),
  });
}

/**
 * Map GitHub issue state to Paperclip issue status.
 */
function ghStateToPaperclipStatus(ghState: "open" | "closed"): string {
  return ghState === "closed" ? "done" : "in_progress";
}

/**
 * Map Paperclip issue status to GitHub issue state.
 */
function paperclipStatusToGhState(status: string): "open" | "closed" {
  return status === "done" || status === "cancelled" ? "closed" : "open";
}

/**
 * Sync a linked GitHub issue's state to the Paperclip issue.
 */
export async function syncFromGitHub(
  ctx: PluginContext,
  link: IssueLink,
  ghIssue: github.GitHubIssue,
): Promise<void> {
  if (
    link.syncDirection === "paperclip-to-github" ||
    ghIssue.state === link.lastGhState
  ) {
    return;
  }

  const newStatus = ghStateToPaperclipStatus(ghIssue.state);
  await ctx.issues.update(link.paperclipIssueId, { status: newStatus });

  link.lastGhState = ghIssue.state;
  await updateLink(ctx, link);

  ctx.logger.info(
    `Synced GitHub ${link.ghOwner}/${link.ghRepo}#${link.ghNumber} (${ghIssue.state}) -> Paperclip ${link.paperclipIssueId} (${newStatus})`,
  );
}

/**
 * Sync a Paperclip issue's status to the linked GitHub issue.
 */
export async function syncToGitHub(
  ctx: PluginContext,
  link: IssueLink,
  paperclipStatus: string,
  token: string,
): Promise<void> {
  if (link.syncDirection === "github-to-paperclip") return;

  const targetGhState = paperclipStatusToGhState(paperclipStatus);
  if (targetGhState === link.lastGhState) return;

  await github.updateIssueState(
    ctx.http.fetch.bind(ctx.http),
    token,
    link.ghOwner,
    link.ghRepo,
    link.ghNumber,
    targetGhState,
  );

  link.lastGhState = targetGhState;
  await updateLink(ctx, link);

  ctx.logger.info(
    `Synced Paperclip ${link.paperclipIssueId} (${paperclipStatus}) -> GitHub ${link.ghOwner}/${link.ghRepo}#${link.ghNumber} (${targetGhState})`,
  );
}

/**
 * Bridge new comments from GitHub to Paperclip.
 */
export async function syncCommentsFromGitHub(
  ctx: PluginContext,
  link: IssueLink,
  token: string,
): Promise<number> {
  const since = link.lastCommentSyncAt ?? link.lastSyncAt;
  const comments = await github.listComments(
    ctx.http.fetch.bind(ctx.http),
    token,
    link.ghOwner,
    link.ghRepo,
    link.ghNumber,
    since,
  );

  let bridged = 0;
  for (const comment of comments) {
    // Skip comments from the sync bot itself (contain the bridge marker)
    if (comment.body.includes("[synced from Paperclip]")) continue;

    await ctx.issues.addComment(link.paperclipIssueId, {
      body: `**@${comment.user.login}** ([GitHub](${comment.html_url})):\n\n${comment.body}`,
    });
    bridged++;
  }

  if (bridged > 0) {
    link.lastCommentSyncAt = new Date().toISOString();
    await updateLink(ctx, link);
  }

  return bridged;
}

/**
 * Bridge a Paperclip comment to GitHub.
 */
export async function bridgeCommentToGitHub(
  ctx: PluginContext,
  link: IssueLink,
  token: string,
  commentBody: string,
  authorName: string,
): Promise<void> {
  if (link.syncDirection === "github-to-paperclip") return;

  // Skip if this comment was bridged FROM GitHub (prevent echo loop)
  if (commentBody.includes("[GitHub](https://github.com/")) return;

  await github.createComment(
    ctx.http.fetch.bind(ctx.http),
    token,
    link.ghOwner,
    link.ghRepo,
    link.ghNumber,
    `**${authorName}** [synced from Paperclip]:\n\n${commentBody}`,
  );
}
