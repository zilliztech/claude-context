import os
from argparse import ArgumentParser
from typing import List, Optional

from retrieval.grep import GrepRetrieval
from utils.constant import evaluation_path, project_path

import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main(
    dataset_name_or_path: str,
    output_dir: str,
    llm_type: str = "moonshot",
    llm_model: Optional[str] = None,
    splits: List[str] = ["test"],
    root_dir: str = str(evaluation_path / "repos"),
    max_instances: Optional[int] = 5,
):

    retrieval = GrepRetrieval(
        dataset_name_or_path=dataset_name_or_path,
        splits=splits,
        output_dir=output_dir,
        llm_type=llm_type,
        llm_model=llm_model,
        max_instances=max_instances,
    )

    retrieval.run(root_dir, token=os.environ.get("GITHUB_TOKEN", "git"))


if __name__ == "__main__":
    parser = ArgumentParser(description="Retrieval for SWE-bench")
    parser.add_argument(
        "--dataset_name_or_path",
        type=str,
        # default="SWE-bench/SWE-bench_Lite",
        default="swe_verified_multifile_instances.json",
        help="Dataset name or path",
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default=str(evaluation_path / "retrieval_results_grep"),
        help="Output directory",
    )
    parser.add_argument(
        "--llm_type",
        type=str,
        choices=["openai", "ollama", "moonshot"],
        # default="moonshot",
        default="openai",
        help="LLM type",
    )
    parser.add_argument(
        "--llm_model",
        type=str,
        # default="kimi-k2-0711-preview",
        default="gpt-4o-mini",
        help="LLM model name, e.g. kimi-k2-0711-preview",
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
