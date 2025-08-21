# Troubleshooting Guide

When you encounter errors or issues with Claude Context, don't panic! This guide provides a systematic approach to identify and resolve problems.

- For MCP use cases, see [MCP Use Cases](#for-mcp-use-cases) section.
- For VSCode Extension use cases, see [VSCode Extension Use Cases](#for-vscode-extension-use-cases) section.

## For MCP Use Cases

### Step 1: Check Indexing Status First

Since indexing [runs in the background](../dive-deep/asynchronous-indexing-workflow.md), many issues are related to indexing status. 

**Start by checking the indexing status:**

Tell your agent: 
```
"Check the indexing status"
```
, which will call `get_indexing_status` tool to get error messages, progress information, or status details. They are helpful for troubleshooting.

### Step 2: Get Debug Logs

If Step 1 doesn't reveal the issue, collect detailed debug information:

**Get your MCP logs:**
- If you use Claude Code or Gemini CLI, start them with `--debug` mode:
  ```bash
  claude --debug
  # or
  gemini --debug
  ```
- If you use Cursor-like GUI IDEs, find the MCP logs in the Output panel, e.g. Cursor:
  1. Open the Output panel in Cursor (⌘⇧U)
  2. Select "MCP Logs" from the dropdown
  3. See [Cursor MCP FAQ](https://docs.cursor.com/en/context/mcp#faq) for details

**Check your MCP Client Setting:**
If logs don't solve the problem, note:
- Which MCP client you're using
- Your MCP configuration JSON contents
- This helps locate configuration issues

### Step 3: Reconnect MCP Server After Configuration Changes

If you locate the problem at [Step 1](#step-1-check-indexing-status-first) or [Step 2](#step-2-get-debug-logs), and have made changes to your environment configuration (such as [environment variables](../getting-started/environment-variables.md), API keys, or MCP settings), try restarting and reconnecting to the MCP server:

**Reconnection methods:**
- **Claude Code**: Use the command in the interactive mode:
  ```
  /mcp reconnect claude-context
  ```
  For more details, see [this comment](https://github.com/anthropics/claude-code/issues/605#issuecomment-3138778529).

- **Gemini CLI**: Use the command in the interactive mode:
  ```
  /mcp refresh
  ```
  For more details, see [this PR](https://github.com/google-gemini/gemini-cli/pull/4566).
- **Cursor and other GUI IDEs**: Look for a toggle icon or restart button to restart the MCP connection. e.g. [Cursor MCP FAQ](https://docs.cursor.com/en/context/mcp#faq)

After reconnecting, test if your issue is resolved and the system works normally.

### Step 4: Search Documentation and Community

If the previous steps don't solve the issue, search existing resources:

1. **Check Documentation:**
   - [Main Documentation](../README.md) - General usage and setup

2. **Check FAQ:**
   - [Troubleshooting FAQ](./faq.md) - Common issues and solutions

3. **Search GitHub Issues:**
   - [GitHub Issues](https://github.com/zilliztech/claude-context/issues) - Known issues and discussions
   - Search for similar problems and solutions
   - Check both open and closed issues

### Step 5: Report the Issue

If none of the above steps resolve your problem, please [create a GitHub issue](https://github.com/zilliztech/claude-context/issues/new/choose).

### Step 6: After Version Updates

If the offical version of Claude Context has been updated, try reconnecting to the MCP server using the methods described in [Step 3](#step-3-reconnect-mcp-server-after-configuration-changes):

**Reconnection methods:**
- **Claude Code**: `/mcp reconnect claude-context`
- **Gemini CLI**: `/mcp refresh`  
- **Cursor and other GUI IDEs**: Use the toggle icon or restart button

After reconnecting, test your use case again to see if the update resolved any previous issues or if new functionality is working as expected.

## For VSCode Extension Use Cases

### Step 1: Get Debug Logs

**Get your logs:**
- In the global search panel, type `> Toggle Developer Tools`
- Open the Chrome DevTools window to view logs
- See [VSCode Developer Tools guide](https://stackoverflow.com/questions/30765782/what-is-the-use-of-the-developer-tools-in-vs-code) for details

**Report your settings:**
- Include extension settings from the panel if possible
- This information helps locate configuration issues

### Step 2: Search Documentation and Community

If debug logs don't solve the issue, search existing resources:

1. **Check Documentation:**
   - [Main Documentation](../README.md) - General usage and setup

2. **Check FAQ:**
   - [Troubleshooting FAQ](./faq.md) - Common issues and solutions

3. **Search GitHub Issues:**
   - [GitHub Issues](https://github.com/zilliztech/claude-context/issues) - Known issues and discussions
   - Search for similar problems and solutions
   - Check both open and closed issues

### Step 3: Report the Issue

If none of the above steps resolve your problem, please [create a GitHub issue](https://github.com/zilliztech/claude-context/issues/new/choose).

### Step 4: After Version Updates

If the offical version of VSCode Extension has been updated, try reinstalling the extension.