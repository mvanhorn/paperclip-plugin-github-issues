# paperclip-plugin-github-issues

Bidirectional GitHub Issues sync for [Paperclip](https://paperclip.ing).

This is the first external Paperclip plugin built as a standalone npm package, created to validate the plugin developer experience.

## What it does

- **Selective linking** - pick individual GitHub issues to sync with Paperclip issues
- **Bidirectional status sync** - close a GitHub issue, the Paperclip issue updates (and vice versa)
- **Comment bridging** - optionally mirror comments between systems
- **Agent tools** - Paperclip agents can search GitHub issues and create links during runs
- **Webhook support** - receives GitHub webhook events for real-time sync
- **Periodic polling** - catches changes missed by webhooks

## Requirements

- Paperclip instance with plugin runtime enabled (requires PR #821 to be merged)
- GitHub personal access token with `repo` scope (or fine-grained token with Issues read/write)

## Installation

```bash
# From the Paperclip CLI
pnpm paperclipai plugin install paperclip-plugin-github-issues
```

Or for development:

```bash
git clone https://github.com/mvanhorn/paperclip-plugin-github-issues.git
cd paperclip-plugin-github-issues
npm install
npm run build
```

## Configuration

After installation, configure the plugin in Paperclip Settings > GitHub Issues Sync:

1. **GitHub Token** - set a secret reference pointing to your GitHub PAT
2. **Default Repository** - optional `owner/repo` for agent tool searches
3. **Sync Comments** - enable to mirror comments between systems
4. **Sync Direction** - bidirectional, github-to-paperclip, or paperclip-to-github

## GitHub Webhook Setup

For real-time sync, configure a webhook on your GitHub repository:

1. Go to your GitHub repo > Settings > Webhooks > Add webhook
2. Payload URL: `https://your-paperclip-instance/api/plugins/paperclip-plugin-github-issues/webhooks/github-events`
3. Content type: `application/json`
4. Events: select "Issues" and "Issue comments"

## Agent Tools

Agents in Paperclip can use these tools during runs:

- **github-issues:search** - search GitHub issues by query
- **github-issues:link** - link a GitHub issue to the current Paperclip issue
- **github-issues:unlink** - remove the sync link

## Plugin Architecture

```
src/
  manifest.ts    # Plugin manifest (capabilities, tools, webhooks, UI slots)
  worker.ts      # Plugin worker (event handlers, sync logic, tool registration)
  constants.ts   # Shared constants
  github.ts      # GitHub REST API client
  sync.ts        # Sync state management and bidirectional logic
  index.ts       # Package exports
```

Built with the Paperclip Plugin SDK (`@paperclipai/plugin-sdk`).

## Status

This plugin was built ahead of the plugin runtime landing on master (PR #821). It implements the full SDK contract based on the plugin spec and example plugins. Testing against a live Paperclip instance will happen once the plugin runtime ships.

## License

MIT
