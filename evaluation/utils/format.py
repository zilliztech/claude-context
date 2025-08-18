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


def extract_edit_calls_from_conversation_log(log_content: str):
    """Extract all edit tool calls from conversation log content"""
    import re

    edit_calls = []

    # Split content into lines for processing
    lines = log_content.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]

        # Look for Arguments: line with edit tool (may have leading whitespace)
        if "Arguments:" in line and "'file_path'" in line:
            # Collect the full arguments block (might span multiple lines)
            args_block = line

            # Check if the line contains complete arguments
            if "}" in line:
                # Arguments are on a single line
                args_text = line
            else:
                # Arguments span multiple lines
                j = i + 1
                while j < len(lines) and "}" not in lines[j]:
                    args_block += (
                        "\n" + lines[j]
                    )  # Keep original formatting including newlines
                    j += 1
                if j < len(lines):
                    args_block += "\n" + lines[j]
                args_text = args_block

            # Extract file_path, old_string, new_string using regex
            file_path_match = re.search(r"'file_path':\s*'([^']*)'", args_text)
            # old_string can be either single-quoted or double-quoted
            old_string_match = re.search(
                r"'old_string':\s*[\"'](.*?)[\"'](?=,\s*'new_string')",
                args_text,
                re.DOTALL,
            )
            # new_string can be either single-quoted or double-quoted
            new_string_match = re.search(
                r"'new_string':\s*[\"'](.*?)[\"'](?=\s*})", args_text, re.DOTALL
            )

            if file_path_match and old_string_match and new_string_match:
                file_path = file_path_match.group(1)
                old_string = old_string_match.group(1)
                new_string = new_string_match.group(1)

                # Unescape newlines and clean up strings
                old_string = old_string.replace("\\n", "\n").replace("\\'", "'")
                new_string = new_string.replace("\\n", "\n").replace("\\'", "'")

                edit_calls.append(
                    {
                        "file_path": file_path,
                        "old_string": old_string,
                        "new_string": new_string,
                    }
                )

        i += 1

    return edit_calls


def find_line_number_for_old_string(file_path: str, old_string: str):
    """Find the line number where old_string starts in the file"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Find the position of old_string in the content
        pos = content.find(old_string)
        if pos == -1:
            return None

        # Count lines up to that position
        line_num = content[:pos].count("\n") + 1
        return line_num
    except Exception:
        return None


def generate_unified_diff(file_path: str, old_string: str, new_string: str):
    """Generate unified diff format for a single edit"""
    import difflib
    import os

    # Get the relative file path for cleaner display
    rel_path = os.path.relpath(file_path) if os.path.exists(file_path) else file_path

    # Find line number where change occurs
    start_line = find_line_number_for_old_string(file_path, old_string)

    # Split strings into lines for difflib
    old_lines = old_string.splitlines(keepends=True)
    new_lines = new_string.splitlines(keepends=True)

    # Generate diff with context
    diff_lines = list(
        difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile=f"a/{rel_path}",
            tofile=f"b/{rel_path}",
            lineterm="",
            n=3,  # 3 lines of context
        )
    )

    # If we found the line number, add it as a comment
    result = []
    if start_line is not None:
        result.append(f"# Edit starting at line {start_line}")

    result.extend(diff_lines)
    return "\n".join(result)


def create_unified_diff_file(instance_dir: str, conversation_summary: str) -> None:
    """Create a unified diff file from conversation log content"""
    edit_calls = extract_edit_calls_from_conversation_log(conversation_summary)

    if not edit_calls:
        return

    diff_content = []
    diff_content.append("# Unified diff of all edits made during retrieval")
    diff_content.append("# Generated from conversation log")
    diff_content.append("")

    for i, edit_call in enumerate(edit_calls, 1):
        diff_content.append(f"# Edit {i}: {edit_call['file_path']}")
        diff_content.append("")

        unified_diff = generate_unified_diff(
            edit_call["file_path"], edit_call["old_string"], edit_call["new_string"]
        )

        diff_content.append(unified_diff)
        diff_content.append("")
        diff_content.append("=" * 80)
        diff_content.append("")

    # Write to changes.diff file
    diff_file = os.path.join(instance_dir, "changes.diff")
    with open(diff_file, "w", encoding="utf-8") as f:
        f.write("\n".join(diff_content))


def calculate_total_tokens(response):
    """Calculate total token usage from the response"""
    total_input_tokens = 0
    total_output_tokens = 0
    total_tokens = 0
    max_single_turn_tokens = 0

    if "messages" in response:
        messages = response["messages"]

        for message in messages:
            current_turn_tokens = 0

            # Check for usage metadata in AI messages
            if hasattr(message, "usage_metadata"):
                usage = message.usage_metadata
                input_tokens = usage.get("input_tokens", 0)
                output_tokens = usage.get("output_tokens", 0)
                turn_total = usage.get("total_tokens", input_tokens + output_tokens)

                total_input_tokens += input_tokens
                total_output_tokens += output_tokens
                total_tokens += turn_total
                current_turn_tokens = turn_total

            # Also check response_metadata for additional usage info
            elif (
                hasattr(message, "response_metadata")
                and "usage" in message.response_metadata
            ):
                usage = message.response_metadata["usage"]
                input_tokens = usage.get("input_tokens", 0)
                output_tokens = usage.get("output_tokens", 0)

                total_input_tokens += input_tokens
                total_output_tokens += output_tokens

                # Calculate total if not provided
                if "total_tokens" in usage:
                    turn_total = usage["total_tokens"]
                    total_tokens += turn_total
                else:
                    turn_total = input_tokens + output_tokens
                    total_tokens += turn_total

                current_turn_tokens = turn_total

            # Track maximum single turn tokens
            if current_turn_tokens > max_single_turn_tokens:
                max_single_turn_tokens = current_turn_tokens

    return {
        "input_tokens": total_input_tokens,
        "output_tokens": total_output_tokens,
        "total_tokens": (
            total_tokens
            if total_tokens > 0
            else total_input_tokens + total_output_tokens
        ),
        "max_single_turn_tokens": max_single_turn_tokens,
    }


def print_token_usage(response):
    """Print simple token usage statistics"""
    usage = calculate_total_tokens(response)

    print(f"📥 Input Tokens:  {usage['input_tokens']:,}")
    print(f"📤 Output Tokens: {usage['output_tokens']:,}")
    print(f"🔢 Total Tokens:  {usage['total_tokens']:,}")
    print(f"🎯 Max Single Turn: {usage['max_single_turn_tokens']:,}")


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
