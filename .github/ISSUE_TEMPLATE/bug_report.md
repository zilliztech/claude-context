---
name: Bug report
about: Create a report to help us improve
title: ''
labels: ''
assignees: ''

---

**Describe the bug**
Please describe your problem in **English**

**Troubleshooting Guide**
Try to follow the [Troubleshooting Guide](https://github.com/zilliztech/claude-context/blob/main/docs/troubleshooting/troubleshooting-guide.md) to solve the problem. If you can not solve the problem, please open an issue.

## For MCP Use Cases
**Get your MCP logs first**
- If you use Claude Code or Gemini CLI, you can start them with `--debug` mode, e.g.,`claude --debug` or `gemini --debug` to get the detailed MCP logs.
- If you use Cursor-like GUI IDEs, you can 1. Open the Output panel in Cursor (⌘⇧U) 2. Select “MCP Logs” from the dropdown. See https://docs.cursor.com/en/context/mcp#faq for details.

**What's your MCP Client Setting**
Suppose you can not solve the problem from the logs. You can report which MCP client you use, and the setting JSON contents. This information will be helpful to locate the issue.

## For vscode-extension Use Cases
**Get your logs first**
In the global search panel, type `> Toggle Developer Tools` to open the Chrome DevTools window to get the logs. See https://stackoverflow.com/questions/30765782/what-is-the-use-of-the-developer-tools-in-vs-code to get more details.

**Report your issue**
Suppose you can not solve the problem from the logs. You can report the settings in the panel if possible. This information will be helpful to locate the issue.

## For Other Cases
Try to locate the issue and provide more detailed setting information.

## Other Information

**Whether you can reproduce the error**
Try to see if the results of reproduced errors are the same every time.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Software version:**
 - IDE version
 - node/npm/pnpm Version
 
**Additional context**
Add any other context about the problem here.
