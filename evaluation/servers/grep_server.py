#!/usr/bin/env python3
"""
A grep server using MCP (Model Context Protocol).
This server provides grep functionality to search for regular expression patterns within files.

Implementation logic inspired by Gemini CLI's grep.ts:
https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/grep.ts
Adapted from TypeScript to Python implementation with similar fallback strategy.
"""

import os
import subprocess
from typing import Dict, Any, Optional
from mcp.server.fastmcp import FastMCP

# Create the MCP server
mcp = FastMCP("Grep Server")


def is_git_repository(path: str) -> bool:
    """Check if the given path is inside a git repository."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=path,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0
    except (subprocess.SubprocessError, subprocess.TimeoutExpired, FileNotFoundError):
        return False


@mcp.tool()
def search_text(
    pattern: str, path: Optional[str] = None, include: Optional[str] = None
) -> Dict[str, Any]:
    """Searches for a regular expression pattern within the content of files in a specified directory (or current working directory). Can filter files by a glob pattern. Returns the lines containing matches, along with their file paths and line numbers.

    Args:
        pattern: The regular expression (regex) pattern to search for within file contents (e.g., 'function\\s+myFunction', 'import\\s+\\{.*\\}\\s+from\\s+.*').
        path: Optional: The absolute path to the directory to search within. If omitted, searches the current working directory.
        include: Optional: A glob pattern to filter which files are searched (e.g., '*.js', '*.{ts,tsx}', 'src/**'). If omitted, searches all files (respecting potential global ignores).

    Returns:
        A dictionary containing search results with file paths, line numbers, and matching lines.
    """
    # Use current working directory if no path specified
    search_path = path if path else os.getcwd()

    # Validate that the search path exists
    if not os.path.exists(search_path):
        return {"error": f"Path does not exist: {search_path}", "matches": []}

    try:
        # Check if we're in a git repository and try git grep first
        if is_git_repository(search_path):
            try:
                # Build git grep command
                git_cmd = ["git", "grep", "-n", "-E"]

                # Add include pattern if specified (git grep uses different syntax)
                if include:
                    git_cmd.extend(["--", include])
                else:
                    git_cmd.append("--")

                # Add pattern
                git_cmd.insert(-1, pattern)  # Insert pattern before the "--" separator

                # Execute git grep command
                result = subprocess.run(
                    git_cmd,
                    cwd=search_path,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="ignore",
                    timeout=30,
                )

                # If git grep succeeds, use its output
                if result.returncode == 0:
                    # Parse git grep output and return results
                    matches = []
                    if result.stdout:
                        for line in result.stdout.strip().split("\n"):
                            if ":" in line:
                                # Parse git grep output format: filepath:line_number:content
                                parts = line.split(":", 2)
                                if len(parts) >= 3:
                                    file_path = parts[0]
                                    try:
                                        line_number = int(parts[1])
                                        line_content = parts[2]
                                        matches.append(
                                            {
                                                "file": os.path.join(
                                                    search_path, file_path
                                                )
                                                if not os.path.isabs(file_path)
                                                else file_path,
                                                "line_number": line_number,
                                                "line_content": line_content,
                                                "match": pattern,
                                            }
                                        )
                                    except ValueError:
                                        continue

                    return {
                        "pattern": pattern,
                        "search_path": search_path,
                        "total_matches": len(matches),
                        "matches": matches,
                        "command": " ".join(git_cmd),
                        "method": "git grep",
                    }

            except (
                subprocess.SubprocessError,
                subprocess.TimeoutExpired,
                FileNotFoundError,
            ):
                # Git grep failed, fall back to regular grep
                pass

        # Fallback: Build regular grep command
        cmd = [
            "grep",
            "-n",
            "-r",
            "-E",
        ]  # -n for line numbers, -r for recursive, -E for extended regex

        # Add include pattern if specified
        if include:
            cmd.extend(["--include", include])

        # Add common exclusions
        cmd.extend(
            [
                "--exclude-dir=.git",
                "--exclude-dir=node_modules",
                "--exclude-dir=__pycache__",
                "--exclude-dir=.svn",
                "--exclude-dir=.hg",
                "--exclude-dir=venv",
                "--exclude-dir=env",
                "--exclude=*.pyc",
                "--exclude=*.pyo",
                "--exclude=*.so",
                "--exclude=*.dll",
                "--exclude=*.exe",
                "--exclude=*.jpg",
                "--exclude=*.jpeg",
                "--exclude=*.png",
                "--exclude=*.gif",
                "--exclude=*.zip",
                "--exclude=*.tar",
                "--exclude=*.gz",
                "--exclude=*.pdf",
                "--exclude=*.wasm",
            ]
        )

        # Add pattern and search path
        cmd.extend([pattern, search_path])

        # Execute grep command
        result = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore"
        )

        # Parse grep output
        matches = []
        if result.stdout:
            for line in result.stdout.strip().split("\n"):
                if ":" in line:
                    # Parse grep output format: filepath:line_number:content
                    parts = line.split(":", 2)
                    if len(parts) >= 3:
                        file_path = parts[0]
                        try:
                            line_number = int(parts[1])
                            line_content = parts[2]
                            matches.append(
                                {
                                    "file": file_path,
                                    "line_number": line_number,
                                    "line_content": line_content,
                                    "match": pattern,  # grep already matched, so pattern is the match
                                }
                            )
                        except ValueError:
                            # Skip malformed lines
                            continue

        return {
            "pattern": pattern,
            "search_path": search_path,
            "total_matches": len(matches),
            "matches": matches,
            "command": " ".join(cmd),  # Include the actual command for debugging
            "method": "system grep",
        }

    except subprocess.SubprocessError as e:
        return {"error": f"Grep command failed: {str(e)}", "matches": []}
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}", "matches": []}


if __name__ == "__main__":
    # Run the server with stdio transport
    mcp.run(transport="stdio")
