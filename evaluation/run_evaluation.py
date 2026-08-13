import os
from argparse import ArgumentParser
from typing import List, Optional

from retrieval.custom import CustomRetrieval
from utils.constant import evaluation_path, project_path

import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main(
    dataset_name_or_path: str,
    output_dir: str,
    retrieval_types: List[str],
    llm_type: str = "openai",
    llm_model: Optional[str] = None,
    splits: List[str] = ["test"],
    root_dir: str = str(evaluation_path / "repos"),
    max_instances: Optional[int] = 5,
):
    """
    Main function to run custom retrieval.
    
    Args:
        dataset_name_or_path: Dataset path or name
        output_dir: Output directory for results
        retrieval_types: List of retrieval types to use ('cc', 'grep', or both)
        llm_type: Type of LLM to use
        llm_model: LLM model name
        splits: Dataset splits to process
        root_dir: Root directory for repositories
        max_instances: Maximum number of instances to process
    """
    logger.info(f"Starting custom retrieval with types: {retrieval_types}")

    retrieval = CustomRetrieval(
        dataset_name_or_path=dataset_name_or_path,
        splits=splits,
        output_dir=output_dir,
        retrieval_types=retrieval_types,
        llm_type=llm_type,
        llm_model=llm_model,
        max_instances=max_instances,
    )

    retrieval.run(root_dir, token=os.environ.get("GITHUB_TOKEN", "git"))


def parse_retrieval_types(value: str) -> List[str]:
    """Parse comma-separated retrieval types string into list"""
    types = [t.strip().lower() for t in value.split(",")]
    valid_types = {"cc", "grep"}

    for t in types:
        if t not in valid_types:
            raise ValueError(
                f"Invalid retrieval type '{t}'. Must be one of: {valid_types}"
            )

    return types


if __name__ == "__main__":
    parser = ArgumentParser(
        description="Custom Retrieval for SWE-bench with flexible retrieval types"
    )
    parser.add_argument(
        "--dataset_name_or_path",
        type=str,
        # default="SWE-bench/SWE-bench_Lite",
        default="swe_verified_15min1h_2files_instances.json",
        help="Dataset name or path",
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default=str(evaluation_path / "retrieval_results_custom"),
        help="Output directory",
    )
    parser.add_argument(
        "--retrieval_types",
        type=parse_retrieval_types,
        default="cc,grep",
        help="Comma-separated list of retrieval types to use. Options: 'cc', 'grep', or 'cc,grep' (default: 'cc,grep')",
    )
    parser.add_argument(
        "--llm_type",
        type=str,
        choices=["openai", "ollama", "moonshot"],
        # default="moonshot",
        default="openai",
        # default="anthropic",
        help="LLM type",
    )
    parser.add_argument(
        "--llm_model",
        type=str,
        # default="kimi-k2-0711-preview",
        default="gpt-4o-mini",
        # default="claude-sonnet-4-20250514",
        help="LLM model name, e.g. gpt-4o-mini",
    )
    parser.add_argument(
        "--splits", nargs="+", default=["test"], help="Dataset splits to process"
    )
    parser.add_argument(
        "--root_dir",
        type=str,
        default=str(evaluation_path / "repos"),
        help="Temporary directory for repositories",
    )
    parser.add_argument(
        "--max_instances",
        type=int,
        default=5,
        help="Maximum number of instances to process (default: 5, set to -1 for all)",
    )

    args = parser.parse_args()
    main(**vars(args))
