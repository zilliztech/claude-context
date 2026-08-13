# Claude Context MCP Evaluation

This directory contains the evaluation framework and experimental results for comparing the efficiency of code retrieval using Claude Context MCP versus traditional grep-only approaches.

## Overview

We conducted a controlled experiment to measure the impact of adding Claude Context MCP tool to a baseline coding agent. The evaluation demonstrates significant improvements in token efficiency while maintaining comparable retrieval quality.

## Experimental Design

We designed a controlled experiment comparing two coding agents performing identical retrieval tasks. The baseline agent uses simple tools including read, grep, and edit functions. The enhanced agent adds Claude Context MCP tool to this same foundation. Both agents work on the same dataset using the same model to ensure fair comparison. We use [LangGraph MCP and ReAct framework](https://langchain-ai.github.io/langgraph/agents/mcp/#use-mcp-tools) to implement it.

We selected 30 instances from Princeton NLP's [SWE-bench_Verified](https://openai.com/index/introducing-swe-bench-verified/) dataset, filtering for 15-60 minute difficulty problems with exactly 2 file modifications. This subset represents typical coding tasks and enables quick validation. The dataset generation is implemented in [`generate_subset_json.py`](./generate_subset_json.py).

We chose [GPT-4o-mini](https://platform.openai.com/docs/models/gpt-4o-mini) as the default model for cost-effective considerations.

We ran each method 3 times independently, giving us 6 total runs for statistical reliability. We measured token usage, tool calls, retrieval precision, recall, and F1-score across all runs. The main entry point for running evaluations is [`run_evaluation.py`](./run_evaluation.py).

## Key Results

### Performance Summary

| Metric | Baseline (Grep Only) | With Claude Context MCP | Improvement |
|--------|---------------------|--------------------------|-------------|
| **Average F1-Score** | 0.40 | 0.40 | Comparable |
| **Average Token Usage** | 73,373 | 44,449 | **-39.4%** |
| **Average Tool Calls** | 8.3 | 5.3 | **-36.3%** |

### Key Findings

**Dramatic Efficiency Gains**: 

With Claude Context MCP, we achieved:
- **39.4% reduction** in token consumption (28,924 tokens saved per instance)
- **36.3% reduction** in tool calls (3.0 fewer calls per instance)


## Conclusion

The results demonstrate that Claude Context MCP provides:

### Immediate Benefits
- **Cost Efficiency**: ~40% reduction in token usage directly reduces operational costs
- **Speed Improvement**: Fewer tool calls and tokens mean faster code localization and task completion
- **Better Quality**: This also means that, under the constraint of limited token context length, using Claude Context yields better retrieval and answer results.

### Strategic Advantages
- **Better Resource Utilization**: Under fixed token budgets, Claude Context MCP enables handling more tasks
- **Wider Usage Scenarios**: Lower per-task costs enable broader usage scenarios
- **Improved User Experience**: Faster responses with maintained accuracy


## Running the Evaluation

To reproduce these results:

1. **Install Dependencies**:

   For python environment, you can use `uv` to install the lockfile dependencies.
   ```bash
   cd evaluation && uv sync
   source .venv/bin/activate
   ```
   For node environment, make sure your `node` version is `Node.js >= 20.0.0 and < 24.0.0`.

   Our evaluation results are tested on `claude-context-mcp@0.1.0`, you can change the `claude-context` mcp server setting in the `retrieval/custom.py` file to get the latest version or use a development version.
   
2. **Set Environment Variables**:
   ```bash
   export OPENAI_API_KEY=your_openai_api_key
   export MILVUS_ADDRESS=your_milvus_address
   ```
   For more configuration details, refer the `claude-context` mcp server settings in the `retrieval/custom.py` file.

   ```bash
   export GITHUB_TOKEN=your_github_token
   ```
   You need also prepare a `GITHUB_TOKEN` for automatically cloning the repositories, refer to [SWE-bench documentation](https://www.swebench.com/SWE-bench/guides/create_rag_datasets/#example-usage) for more details.

3. **Generate Dataset**:
   ```bash
   python generate_subset_json.py
   ```

4. **Run Baseline Evaluation**:
   ```bash
   python run_evaluation.py --retrieval_types grep --output_dir retrieval_results_grep
   ```

5. **Run Enhanced Evaluation**:
   ```bash
   python run_evaluation.py --retrieval_types cc,grep --output_dir retrieval_results_both
   ```

6. **Analyze Results**:
   ```bash
   python analyze_and_plot_mcp_efficiency.py
   ```

The evaluation framework is designed to be reproducible and can be easily extended to test additional configurations or datasets. Due to the proprietary nature of LLMs, exact numerical results may vary between runs and cannot be guaranteed to be identical. However, the core conclusions drawn from the analysis remain consistent and robust across different runs.

## Results Visualization

![MCP Efficiency Analysis](../assets/mcp_efficiency_analysis_chart.png)

*The chart above shows the dramatic efficiency improvements achieved by Claude Context MCP. The token usage and tool calls are significantly reduced.*

## Case Study

For detailed analysis of why grep-only approaches have limitations and how semantic search addresses these challenges, please refer to our **[Case Study](./case_study/)** which provides in-depth comparisons and analysis on the this experiment results.