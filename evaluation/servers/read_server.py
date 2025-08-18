#!/usr/bin/env python3
"""
A read_file server using MCP (Model Context Protocol).
This server provides file reading functionality for text files.

Implementation logic inspired by Gemini CLI's read-file.ts:
https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/read-file.ts
Adapted from TypeScript to Python implementation with text file handling.
"""

import os
from typing import Dict, Any, Optional
from mcp.server.fastmcp import FastMCP

# Create the MCP server
mcp = FastMCP("Read File Server")


@mcp.tool()
def read_file(
    path: str, offset: Optional[int] = None, limit: Optional[int] = None
) -> Dict[str, Any]:
    """Reads the content of a text file at the specified path.

    You can optionally specify an offset and limit to read only a portion of the file.

    Args:
        path: The absolute path to the file to read.
        offset: Optional: The line number to start reading from (0-based).
        limit: Optional: The maximum number of lines to read.

    Returns:
        A dictionary containing either:
        - For text files: {"content": "file content as string", "type": "text", "total_lines": number}
        - For errors: {"error": "error message"}
    """
    try:
        # Validate path is absolute
        if not os.path.isabs(path):
            return {"error": f"Path must be absolute: {path}"}

        # Check if file exists
        if not os.path.exists(path):
            return {"error": f"File does not exist: {path}"}

        # Check if it's actually a file
        if os.path.isdir(path):
            return {"error": f"Path is a directory, not a file: {path}"}

        # Get file extension
        _, ext = os.path.splitext(path.lower())

        # Try to read as text file
        try:
            # Try to read as text with UTF-8 encoding
            with open(path, "r", encoding="utf-8", errors="replace") as file:
                lines = file.readlines()
                total_lines = len(lines)

                if offset is not None and limit is not None:
                    # Validate offset
                    if offset < 0:
                        return {"error": f"Offset must be non-negative: {offset}"}
                    if offset >= total_lines:
                        return {
                            "error": f"Offset {offset} is beyond file length {total_lines}"
                        }

                    # Calculate end position
                    start = offset
                    end = min(offset + limit, total_lines)
                    content = "".join(lines[start:end])

                    # Add truncation notice if needed
                    if end < total_lines:
                        content = (
                            f"[File content truncated: showing lines {start + 1}-{end} of {total_lines} total lines...]\n"
                            + content
                        )
                else:
                    content = "".join(lines)

                return {
                    "content": content,
                    "type": "text",
                    "total_lines": total_lines,
                    "path": path,
                }
        except UnicodeDecodeError:
            # If UTF-8 fails, try other common encodings
            for encoding in ["latin-1", "cp1252", "iso-8859-1"]:
                try:
                    with open(path, "r", encoding=encoding, errors="replace") as file:
                        lines = file.readlines()
                        total_lines = len(lines)

                        if offset is not None and limit is not None:
                            if offset < 0:
                                return {
                                    "error": f"Offset must be non-negative: {offset}"
                                }
                            if offset >= total_lines:
                                return {
                                    "error": f"Offset {offset} is beyond file length {total_lines}"
                                }

                            start = offset
                            end = min(offset + limit, total_lines)
                            content = "".join(lines[start:end])

                            if end < total_lines:
                                content = (
                                    f"[File content truncated: showing lines {start + 1}-{end} of {total_lines} total lines...]\n"
                                    + content
                                )
                        else:
                            content = "".join(lines)

                        return {
                            "content": content,
                            "type": "text",
                            "total_lines": total_lines,
                            "path": path,
                            "encoding": encoding,
                        }
                except UnicodeDecodeError:
                    continue

            # If all encodings fail, treat as binary
            return {"error": f"Cannot read file as text (encoding issues): {path}"}

    except Exception as e:
        return {"error": f"Unexpected error reading file: {str(e)}"}


@mcp.tool()
def list_directory(path: str) -> Dict[str, Any]:
    """Lists the contents of a directory.

    Args:
        path: The absolute path to the directory to list.

    Returns:
        A dictionary containing:
        - For success: {"entries": [{"name": "...", "type": "file|directory", "size": number}], "path": "..."}
        - For errors: {"error": "error message"}
    """
    try:
        # Validate path is absolute
        if not os.path.isabs(path):
            return {"error": f"Path must be absolute: {path}"}

        # Check if directory exists
        if not os.path.exists(path):
            return {"error": f"Directory does not exist: {path}"}

        # Check if it's actually a directory
        if not os.path.isdir(path):
            return {"error": f"Path is not a directory: {path}"}

        entries = []
        for item in os.listdir(path):
            item_path = os.path.join(path, item)
            try:
                if os.path.isfile(item_path):
                    size = os.path.getsize(item_path)
                    entries.append({"name": item, "type": "file", "size": size})
                elif os.path.isdir(item_path):
                    entries.append({"name": item, "type": "directory", "size": 0})
            except (OSError, PermissionError):
                # Skip items we can't access
                continue

        # Sort entries: directories first, then files, both alphabetically
        entries.sort(key=lambda x: (x["type"] == "file", x["name"].lower()))

        return {"entries": entries, "path": path, "total_count": len(entries)}

    except PermissionError:
        return {"error": f"Permission denied accessing directory: {path}"}
    except Exception as e:
        return {"error": f"Unexpected error listing directory: {str(e)}"}


@mcp.tool()
def directory_tree(path: str, max_depth: Optional[int] = 3) -> Dict[str, Any]:
    """Generates a tree structure of a directory.

    Args:
        path: The absolute path to the directory to generate tree for.
        max_depth: Optional: Maximum depth to traverse (default: 3).

    Returns:
        A dictionary containing:
        - For success: {"tree": "tree structure as string", "path": "..."}
        - For errors: {"error": "error message"}
    """
    try:
        # Validate path is absolute
        if not os.path.isabs(path):
            return {"error": f"Path must be absolute: {path}"}

        # Check if directory exists
        if not os.path.exists(path):
            return {"error": f"Directory does not exist: {path}"}

        # Check if it's actually a directory
        if not os.path.isdir(path):
            return {"error": f"Path is not a directory: {path}"}

        def build_tree(current_path: str, prefix: str = "", depth: int = 0) -> str:
            if max_depth and depth >= max_depth:
                return ""

            tree_str = ""
            try:
                items = sorted(os.listdir(current_path))
                for i, item in enumerate(items):
                    item_path = os.path.join(current_path, item)
                    is_last = i == len(items) - 1

                    # Skip hidden files and common ignore patterns
                    if item.startswith(".") and item not in [
                        ".env",
                        ".gitignore",
                        ".gitattributes",
                    ]:
                        continue
                    if item in [
                        "node_modules",
                        "__pycache__",
                        ".git",
                        ".svn",
                        ".hg",
                        "venv",
                        "env",
                    ]:
                        continue

                    try:
                        if os.path.isdir(item_path):
                            tree_str += (
                                f"{prefix}{'└── ' if is_last else '├── '}{item}/\n"
                            )
                            extension = "    " if is_last else "│   "
                            tree_str += build_tree(
                                item_path, prefix + extension, depth + 1
                            )
                        else:
                            tree_str += (
                                f"{prefix}{'└── ' if is_last else '├── '}{item}\n"
                            )
                    except (OSError, PermissionError):
                        # Skip items we can't access
                        continue
            except (OSError, PermissionError):
                pass

            return tree_str

        tree_structure = f"{os.path.basename(path)}/\n"
        tree_structure += build_tree(path)

        return {"tree": tree_structure, "path": path, "max_depth": max_depth}

    except Exception as e:
        return {"error": f"Unexpected error generating directory tree: {str(e)}"}


if __name__ == "__main__":
    # Run the server with stdio transport
    mcp.run(transport="stdio")
