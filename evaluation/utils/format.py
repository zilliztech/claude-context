import json
import re
import os


def extract_final_answer(response):
    """Extract the final answer from the agent response"""
    if "messages" in response:
        messages = response["messages"]
        # Get the last AI message
        for message in reversed(messages):
            if hasattr(message, "content") and isinstance(message.content, str):
                return message.content
            elif hasattr(message, "content") and isinstance(message.content, list):
                # Handle structured content
                for content_item in message.content:
                    if (
                        isinstance(content_item, dict)
                        and content_item.get("type") == "text"
                    ):
                        return content_item.get("text", "")
    return "No answer found"


def extract_file_paths_from_edits(response, codebase_path):
    """Extract file paths from edit tool responses and convert to relative paths"""
    import re

    file_paths = []
    seen_relative_paths = set()  # Use set for faster lookup
    codebase_path = os.path.abspath(codebase_path)

    # Extract the entire conversation content
    if hasattr(response, "get") and "messages" in response:
        # Handle LangGraph response format
        content = ""
        for message in response["messages"]:
            if hasattr(message, "content"):
                content += str(message.content) + "\n"
            elif isinstance(message, dict) and "content" in message:
                content += str(message["content"]) + "\n"
    else:
        # Fallback for other response formats
        content = str(response)

    # Pattern to match "Successfully modified file: /path/to/file"
    edit_pattern = r"Successfully modified file:\s*(.+?)(?:\s|$)"

    # Also check for edit tool calls in the response
    # Pattern to match edit tool calls with file_path parameter
    tool_call_pattern = r"edit.*?file_path[\"']?\s*:\s*[\"']([^\"']+)[\"']"

    for line in content.split("\n"):
        # Check for "Successfully modified file:" pattern
        match = re.search(edit_pattern, line.strip())
        if match:
            file_path = match.group(1).strip()
            # Convert to relative path immediately for deduplication
            rel_path = _normalize_to_relative_path(file_path, codebase_path)
            if rel_path and rel_path not in seen_relative_paths:
                seen_relative_paths.add(rel_path)
                file_paths.append(rel_path)

        # Check for edit tool calls
        match = re.search(tool_call_pattern, line.strip(), re.IGNORECASE)
        if match:
            file_path = match.group(1).strip()
            # Convert to relative path immediately for deduplication
            rel_path = _normalize_to_relative_path(file_path, codebase_path)
            if rel_path and rel_path not in seen_relative_paths:
                seen_relative_paths.add(rel_path)
                file_paths.append(rel_path)

    return file_paths


def _normalize_to_relative_path(file_path, codebase_path):
    """Convert a file path to relative path based on codebase_path"""
    if isinstance(file_path, str):
        if os.path.isabs(file_path):
            # Absolute path - convert to relative
            abs_path = os.path.abspath(file_path)
            if abs_path.startswith(codebase_path):
                return os.path.relpath(abs_path, codebase_path)
            else:
                # Path outside codebase, return as-is
                return file_path
        else:
            # Already relative path
            return file_path
    return None


def extract_oracle_files_from_patch(patch):
    """Extract the list of oracle files from the patch field"""
    import re

    if not patch:
        return []

    # Pattern to match patch headers like "--- a/path/to/file"
    patch_files_pattern = re.compile(r"\-\-\- a/(.+)")
    oracle_files = list(set(patch_files_pattern.findall(patch)))

    return oracle_files


def calculate_total_tokens(response):
    """Calculate total token usage from the response"""
    total_input_tokens = 0
    total_output_tokens = 0
    total_tokens = 0

    if "messages" in response:
        messages = response["messages"]

        for message in messages:
            # Check for usage metadata in AI messages
            if hasattr(message, "usage_metadata"):
                usage = message.usage_metadata
                total_input_tokens += usage.get("input_tokens", 0)
                total_output_tokens += usage.get("output_tokens", 0)
                total_tokens += usage.get("total_tokens", 0)

            # Also check response_metadata for additional usage info
            elif (
                hasattr(message, "response_metadata")
                and "usage" in message.response_metadata
            ):
                usage = message.response_metadata["usage"]
                total_input_tokens += usage.get("input_tokens", 0)
                total_output_tokens += usage.get("output_tokens", 0)
                # Calculate total if not provided
                if "total_tokens" in usage:
                    total_tokens += usage["total_tokens"]
                else:
                    total_tokens += usage.get("input_tokens", 0) + usage.get(
                        "output_tokens", 0
                    )

    return {
        "input_tokens": total_input_tokens,
        "output_tokens": total_output_tokens,
        "total_tokens": (
            total_tokens
            if total_tokens > 0
            else total_input_tokens + total_output_tokens
        ),
    }


def print_token_usage(response):
    """Print simple token usage statistics"""
    usage = calculate_total_tokens(response)

    print(f"📥 Input Tokens:  {usage['input_tokens']:,}")
    print(f"📤 Output Tokens: {usage['output_tokens']:,}")
    print(f"🔢 Total Tokens:  {usage['total_tokens']:,}")


def truncate_long_content(content, max_lines=30):
    """Truncate content if it exceeds max_lines"""
    if not isinstance(content, str):
        content = str(content)

    lines = content.split("\n")
    if len(lines) <= max_lines:
        return content

    truncated = "\n".join(lines[:max_lines])
    remaining_lines = len(lines) - max_lines
    return f"{truncated}\n... {remaining_lines} more lines"


def extract_conversation_summary(response):
    """Extract conversation summary and return as (summary_string, tool_stats_dict)"""
    summary_lines = []
    tool_call_counts = {}  # Count of calls for each tool
    total_tool_calls = 0  # Total number of tool calls

    if "messages" in response:
        messages = response["messages"]

        summary_lines.append("📝 Conversation Summary:")
        summary_lines.append("=" * 50)

        for i, message in enumerate(messages):
            if hasattr(message, "content"):
                if hasattr(message, "role") or "Human" in str(type(message)):
                    # Human message
                    content = (
                        message.content
                        if isinstance(message.content, str)
                        else str(message.content)
                    )
                    summary_lines.append(f"👤 User: {content}")
                    summary_lines.append("=" * 50)

                elif "AI" in str(type(message)):
                    # AI message - extract text content
                    if isinstance(message.content, str):
                        summary_lines.append(f"🤖 LLM: {message.content}")
                        summary_lines.append("=" * 50)
                    elif isinstance(message.content, list):
                        for content_item in message.content:
                            if isinstance(content_item, dict):
                                if content_item.get("type") == "text":
                                    summary_lines.append(
                                        f"🤖 LLM: {content_item.get('text', '')}"
                                    )
                                    summary_lines.append("=" * 50)
                                elif content_item.get("type") == "tool_use":
                                    tool_name = content_item.get("name", "unknown")
                                    tool_input = content_item.get("input", {})
                                    tool_id = content_item.get("id", "unknown")

                                    # Count tool calls
                                    tool_call_counts[tool_name] = (
                                        tool_call_counts.get(tool_name, 0) + 1
                                    )
                                    total_tool_calls += 1

                                    summary_lines.append(f"🔧 Tool Call: '{tool_name}'")
                                    summary_lines.append(f"   ID: {tool_id}")
                                    summary_lines.append(f"   Arguments: {tool_input}")
                                    summary_lines.append("=" * 50)

                    # Also check for tool_calls attribute (LangChain format)
                    if hasattr(message, "tool_calls") and message.tool_calls:
                        for tool_call in message.tool_calls:
                            tool_name = tool_call.get("name", "unknown")
                            tool_args = tool_call.get("args", {})
                            tool_id = tool_call.get("id", "unknown")

                            # Count tool calls
                            tool_call_counts[tool_name] = (
                                tool_call_counts.get(tool_name, 0) + 1
                            )
                            total_tool_calls += 1

                            summary_lines.append(f"🔧 Tool Call: '{tool_name}'")
                            summary_lines.append(f"   ID: {tool_id}")
                            summary_lines.append(f"   Arguments: {tool_args}")
                            summary_lines.append("=" * 50)

                elif "Tool" in str(type(message)):
                    # Tool response
                    tool_name = getattr(message, "name", "unknown")
                    tool_call_id = getattr(message, "tool_call_id", "unknown")
                    content = getattr(message, "content", "no result")

                    # Truncate long content
                    truncated_content = truncate_long_content(content, max_lines=30)

                    summary_lines.append(f"⚙️ Tool Response: '{tool_name}'")
                    summary_lines.append(f"   Call ID: {tool_call_id}")
                    summary_lines.append(f"   Result: {truncated_content}")
                    summary_lines.append("=" * 50)

    # Build tool statistics
    tool_stats = {
        "tool_call_counts": tool_call_counts,
        "total_tool_calls": total_tool_calls,
    }

    return "\n".join(summary_lines), tool_stats


def print_conversation_summary(response):
    """Print a clean summary of the conversation"""
    summary, tool_stats = extract_conversation_summary(response)
    print(summary)
    print("\n🔧 Tool Usage Statistics:")
    print(f"   Total tool calls: {tool_stats['total_tool_calls']}")
    if tool_stats["tool_call_counts"]:
        for tool_name, count in tool_stats["tool_call_counts"].items():
            print(f"   {tool_name}: {count} calls")
