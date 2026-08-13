#!/usr/bin/env python3
"""
Analyze retrieval results and create MCP efficiency chart using real data.
This script loads data from the actual result directories and generates seaborn charts.
"""

import json
import os
import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt
import pandas as pd
from typing import Dict, List, Tuple


def normalize_file_path(file_path: str) -> str:
    """Normalize file paths."""
    if file_path.startswith("/"):
        file_path = file_path[1:]
    return file_path


def calculate_metrics(hits: List[str], oracles: List[str]) -> Dict[str, float]:
    """Calculate precision, recall, and F1-score."""
    if not hits and not oracles:
        return {"precision": 0.0, "recall": 0.0, "f1": 0.0}

    # Normalize file paths
    hits_set = set(normalize_file_path(f) for f in hits)
    oracles_set = set(normalize_file_path(f) for f in oracles)

    # Calculate intersection
    intersection = hits_set.intersection(oracles_set)

    # Calculate metrics
    precision = len(intersection) / len(hits_set) if hits_set else 0.0
    recall = len(intersection) / len(oracles_set) if oracles_set else 0.0
    f1 = (
        2 * (precision * recall) / (precision + recall)
        if (precision + recall) > 0
        else 0.0
    )

    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "num_hits": len(hits_set),
        "num_oracles": len(oracles_set),
        "num_correct": len(intersection),
    }


def load_method_results(method_dirs: List[str], method_name: str) -> Dict:
    """Load and aggregate results from multiple runs of the same method."""

    all_f1_scores = []
    all_token_usage = []
    all_tool_calls = []
    successful_instances = set()

    print(f"\nLoading {method_name} method data from {len(method_dirs)} runs...")

    for run_idx, run_dir in enumerate(method_dirs):
        print(f"  Processing run {run_idx + 1}: {run_dir}")

        if not os.path.exists(run_dir):
            print(f"    Warning: Directory {run_dir} does not exist")
            continue

        run_success_count = 0
        run_f1_scores = []
        run_tokens = []
        run_tools = []

        for item in os.listdir(run_dir):
            instance_dir = os.path.join(run_dir, item)
            result_file = os.path.join(instance_dir, "result.json")

            if os.path.isdir(instance_dir) and os.path.exists(result_file):
                try:
                    with open(result_file, "r") as f:
                        data = json.load(f)

                    # Calculate F1-score
                    hits = data.get("hits", [])
                    oracles = data.get("oracles", [])
                    metrics = calculate_metrics(hits, oracles)

                    # Extract other metrics
                    tokens = data.get("token_usage", {}).get("total_tokens", 0)
                    tools = data.get("tool_stats", {}).get("total_tool_calls", 0)

                    # Store data
                    run_f1_scores.append(metrics["f1"])
                    run_tokens.append(tokens)
                    run_tools.append(tools)

                    successful_instances.add(item)
                    run_success_count += 1

                except Exception as e:
                    print(f"    Warning: Failed to load {result_file}: {e}")
                    continue

        print(f"    Loaded {run_success_count} successful instances")

        # Add this run's data to overall collection
        all_f1_scores.extend(run_f1_scores)
        all_token_usage.extend(run_tokens)
        all_tool_calls.extend(run_tools)

    # Calculate aggregated statistics
    results = {
        "method_name": method_name,
        "total_runs": len(method_dirs),
        "successful_instances": len(successful_instances),
        "avg_f1": np.mean(all_f1_scores) if all_f1_scores else 0,
        "std_f1": np.std(all_f1_scores) if all_f1_scores else 0,
        "avg_tokens": np.mean(all_token_usage) if all_token_usage else 0,
        "std_tokens": np.std(all_token_usage) if all_token_usage else 0,
        "avg_tools": np.mean(all_tool_calls) if all_tool_calls else 0,
        "std_tools": np.std(all_tool_calls) if all_tool_calls else 0,
    }

    print(f"  Aggregated results:")
    print(f"    Avg F1-Score: {results['avg_f1']:.3f} ± {results['std_f1']:.3f}")
    print(f"    Avg Tokens: {results['avg_tokens']:.0f} ± {results['std_tokens']:.0f}")
    print(
        f"    Avg Tool Calls: {results['avg_tools']:.1f} ± {results['std_tools']:.1f}"
    )

    return results


def create_efficiency_chart(both_results: Dict, grep_results: Dict):
    """Create the efficiency comparison chart using Seaborn."""

    # Set the aesthetic style
    sns.set_style("whitegrid")
    sns.set_palette("husl")

    # Prepare data for plotting
    data = {
        "Method": [
            "With claude-context MCP",
            "Baseline",
            "With claude-context MCP",
            "Baseline",
        ],
        "Metric": ["Token Usage", "Token Usage", "Tool Calls", "Tool Calls"],
        "Value": [
            both_results["avg_tokens"] / 1000,  # Convert to thousands
            grep_results["avg_tokens"] / 1000,
            both_results["avg_tools"],
            grep_results["avg_tools"],
        ],
    }

    df = pd.DataFrame(data)

    # Create figure with custom styling
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 7))

    # Custom color palette
    colors = ["#3498db", "#e74c3c"]  # Modern blue and red

    # Token Usage subplot
    token_data = df[df["Metric"] == "Token Usage"]
    sns.barplot(
        data=token_data,
        x="Method",
        y="Value",
        ax=ax1,
        palette=colors,
        alpha=0.8,
        edgecolor="white",
        linewidth=2,
    )

    ax1.set_title("Token Usage", fontsize=18, fontweight="bold", pad=20)
    ax1.set_ylabel("Average Tokens (K)", fontsize=14, fontweight="bold")
    ax1.set_xlabel("")
    ax1.tick_params(axis="x", labelsize=12)
    ax1.tick_params(axis="y", labelsize=12)
    # Set y-axis range with some padding
    ax1.set_ylim(0, max(token_data["Value"]) * 1.15)

    # Add value labels for token usage
    token_values = [
        both_results["avg_tokens"] / 1000,
        grep_results["avg_tokens"] / 1000,
    ]
    for i, val in enumerate(token_values):
        ax1.text(
            i,
            val + 2,
            f"{val:.1f}K",
            ha="center",
            va="bottom",
            fontweight="bold",
            fontsize=13,
            color=colors[i],
        )

    # Add improvement annotation for tokens
    token_reduction = (
        (grep_results["avg_tokens"] - both_results["avg_tokens"])
        / grep_results["avg_tokens"]
        * 100
    )
    mid_height = max(token_values) * 0.8
    ax1.annotate(
        f"-{token_reduction:.1f}%",
        xy=(0.5, mid_height),
        xycoords="data",
        ha="center",
        va="center",
        fontsize=16,
        fontweight="bold",
        bbox=dict(
            boxstyle="round,pad=0.5",
            facecolor="#2ecc71",
            alpha=0.8,
            edgecolor="white",
            linewidth=2,
        ),
        color="white",
    )

    # Tool Calls subplot
    tool_data = df[df["Metric"] == "Tool Calls"]
    sns.barplot(
        data=tool_data,
        x="Method",
        y="Value",
        ax=ax2,
        palette=colors,
        alpha=0.8,
        edgecolor="white",
        linewidth=2,
    )

    ax2.set_title("Tool Calls", fontsize=18, fontweight="bold", pad=20)
    ax2.set_ylabel("Average Number of Calls", fontsize=14, fontweight="bold")
    ax2.set_xlabel("")
    ax2.tick_params(axis="x", labelsize=12)
    ax2.tick_params(axis="y", labelsize=12)
    # Set y-axis range with some padding
    ax2.set_ylim(0, max(tool_data["Value"]) * 1.15)

    # Add value labels for tool calls
    tool_values = [both_results["avg_tools"], grep_results["avg_tools"]]
    for i, val in enumerate(tool_values):
        ax2.text(
            i,
            val + 0.2,
            f"{val:.1f}",
            ha="center",
            va="bottom",
            fontweight="bold",
            fontsize=13,
            color=colors[i],
        )

    # Add improvement annotation for tool calls
    tool_reduction = (
        (grep_results["avg_tools"] - both_results["avg_tools"])
        / grep_results["avg_tools"]
        * 100
    )
    mid_height = max(tool_values) * 0.8
    ax2.annotate(
        f"-{tool_reduction:.1f}%",
        xy=(0.5, mid_height),
        xycoords="data",
        ha="center",
        va="center",
        fontsize=16,
        fontweight="bold",
        bbox=dict(
            boxstyle="round,pad=0.5",
            facecolor="#2ecc71",
            alpha=0.8,
            edgecolor="white",
            linewidth=2,
        ),
        color="white",
    )

    # Keep x-axis labels horizontal and add grid
    for ax in [ax1, ax2]:
        ax.tick_params(axis="x", rotation=0)
        ax.grid(True, alpha=0.3)

    # Adjust layout
    plt.tight_layout()

    # Save with high quality
    output_file = "mcp_efficiency_analysis_chart.png"
    plt.savefig(
        output_file, dpi=300, bbox_inches="tight", facecolor="white", edgecolor="none"
    )
    plt.show()

    print(f"\nChart saved as: {output_file}")

    # Print summary
    print(f"\n{'='*80}")
    print(f"MCP EFFICIENCY ANALYSIS SUMMARY")
    print(f"{'='*80}")
    print(f"Method Comparison:")
    print(f"  Both (MCP) vs Grep (Baseline)")
    print(
        f"  Runs per method: {both_results['total_runs']} vs {grep_results['total_runs']}"
    )

    print(f"\nF1-Score Comparison:")
    print(f"  Both Method: {both_results['avg_f1']:.3f} ± {both_results['std_f1']:.3f}")
    print(f"  Grep Method: {grep_results['avg_f1']:.3f} ± {grep_results['std_f1']:.3f}")
    f1_change = (
        (
            (both_results["avg_f1"] - grep_results["avg_f1"])
            / grep_results["avg_f1"]
            * 100
        )
        if grep_results["avg_f1"] > 0
        else 0
    )
    print(f"  F1-Score change: {f1_change:+.1f}%")

    print(f"\nEfficiency Improvements:")
    print(
        f"  Token usage reduction: {token_reduction:.1f}% (from {grep_results['avg_tokens']:.0f} to {both_results['avg_tokens']:.0f})"
    )
    print(
        f"  Tool calls reduction: {tool_reduction:.1f}% (from {grep_results['avg_tools']:.1f} to {both_results['avg_tools']:.1f})"
    )
    print(
        f"  Average token savings: {grep_results['avg_tokens'] - both_results['avg_tokens']:.0f} tokens per instance"
    )


def main():
    """Main function to analyze and plot MCP efficiency."""

    print("MCP Efficiency Analysis - Loading Data")
    print("=" * 60)

    # Define directories for each method
    both_dirs = [
        "retrieval_results_both",
        "retrieval_results_both2",
        "retrieval_results_both3",
    ]

    grep_dirs = [
        "retrieval_results_grep",
        "retrieval_results_grep2",
        "retrieval_results_grep3",
    ]

    # Load and analyze results
    both_results = load_method_results(both_dirs, "Both (with claude-context MCP)")
    grep_results = load_method_results(grep_dirs, "Grep (baseline)")

    # Create the efficiency chart
    create_efficiency_chart(both_results, grep_results)


if __name__ == "__main__":
    main()
