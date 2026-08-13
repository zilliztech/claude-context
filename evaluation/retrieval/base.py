import json
import os
import traceback
from pathlib import Path
from tqdm.auto import tqdm
from typing import List, Dict, Any, Tuple

from datasets import load_from_disk, load_dataset

from utils.file_management import get_remaining_instances


from utils.file_management import ContextManager, clone_repo

import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


class BaseRetrieval:
    def __init__(
        self, *, dataset_name_or_path, splits, output_dir, max_instances=None, **kwargs
    ):
        self.dataset_name_or_path = dataset_name_or_path
        self.splits = splits
        self.output_dir = output_dir
        self.max_instances = max_instances
        self.instances = self._prepare_instances()
        self.prompt = """The codebase is at {repo_path}.

Issue: 
<issue>
{issue}
</issue>

Your task is to identify and edit the files that need to be modified to resolve the issue.
Focus on making the necessary changes to completely address the problem.
Use the available tools step by step to accomplish this goal. The primary objective is to edit the existing code files. No validation or testing is required.
"""

    def _prepare_instances(self) -> List[Dict]:
        if Path(self.dataset_name_or_path).exists():
            # Check if it's a JSON file
            if self.dataset_name_or_path.endswith(".json"):
                with open(self.dataset_name_or_path, "r") as f:
                    data = json.load(f)
                    # If it's our custom JSON format with instances data
                    if "instances" in data:
                        logger.info(
                            f"Loaded {len(data['instances'])} instances from JSON file"
                        )
                        if "metadata" in data and "statistics" in data["metadata"]:
                            logger.info(f"Statistics: {data['metadata']['statistics']}")
                        # Create a simple dict that mimics HuggingFace dataset structure
                        dataset = {"test": data["instances"]}
                    elif "test" in data:
                        dataset = {"test": data["test"]}
                    else:
                        # Assume the JSON file itself contains the instances
                        dataset = {"test": data if isinstance(data, list) else [data]}
                dataset_name = os.path.basename(self.dataset_name_or_path).replace(
                    ".json", ""
                )
            else:
                dataset = load_from_disk(self.dataset_name_or_path)
                dataset_name = os.path.basename(self.dataset_name_or_path)
        else:
            dataset = load_dataset(self.dataset_name_or_path)
            dataset_name = self.dataset_name_or_path.replace("/", "__")

        instances = []
        from datasets import DatasetDict

        if isinstance(dataset, DatasetDict):
            available_splits = set(dataset.keys())
            if set(self.splits) - available_splits != set():
                missing_splits = set(self.splits) - available_splits
                logger.warning(f"Unknown splits {missing_splits}")

        for split in self.splits:
            logger.info(f"Loading split '{split}'")
            from datasets import DatasetDict, IterableDatasetDict

            if isinstance(dataset, (DatasetDict, IterableDatasetDict)):
                split_instances = list(dataset[split])
            elif isinstance(dataset, dict) and split in dataset:
                # Handle our custom JSON format
                split_instances = dataset[split]
            else:
                split_instances = list(dataset)
            instances.extend(split_instances)
            logger.info(f"Loaded {len(split_instances)} instances from split '{split}'")

        output_file = Path(self.output_dir) / f"{dataset_name}__retrieval.jsonl"
        output_file.parent.mkdir(parents=True, exist_ok=True)

        # Check for both JSONL format (for legacy compatibility) and directory structure format
        remaining_instances, processed_count = self._filter_existing_instances(
            instances, output_file
        )

        if not remaining_instances:
            logger.info("All instances already processed")
            return []

        # Apply max_instances limit if specified
        if self.max_instances is not None and self.max_instances > 0:
            # Check if we've already processed enough instances
            if processed_count >= self.max_instances:
                logger.info(
                    f"Already processed {processed_count} instances, which meets or exceeds max_instances={self.max_instances}. No more instances to process."
                )
                return []

            # Calculate how many more instances we need to process
            remaining_needed = self.max_instances - processed_count
            if len(remaining_instances) > remaining_needed:
                logger.info(
                    f"Limiting to {remaining_needed} more instances (processed: {processed_count}, target: {self.max_instances}, remaining: {len(remaining_instances)})"
                )
                remaining_instances = remaining_instances[:remaining_needed]

        return remaining_instances

    def _filter_existing_instances(
        self, instances: List[Dict], output_file: Path
    ) -> Tuple[List[Dict], int]:
        """
        Filter instances to exclude those that have already been processed.

        This method supports both output formats:
        1. JSONL format (legacy): results saved to a single JSONL file
        2. Directory format: results saved to individual directories with result.json files

        Args:
            instances: List of instances to filter
            output_file: Path to the JSONL output file (used for legacy format detection)

        Returns:
            Tuple of (remaining_instances, processed_count)
        """
        # First check JSONL format for backward compatibility
        if output_file.exists():
            # JSONL format already handled by get_remaining_instances
            remaining_instances = get_remaining_instances(instances, output_file)
            processed_count = len(instances) - len(remaining_instances)
            return remaining_instances, processed_count
        else:
            # Check directory structure format
            processed_instance_ids = set()

            # Check if output directory exists and has subdirectories with result.json
            if os.path.exists(self.output_dir):
                for item in os.listdir(self.output_dir):
                    instance_dir = os.path.join(self.output_dir, item)
                    result_file = os.path.join(instance_dir, "result.json")
                    if os.path.isdir(instance_dir) and os.path.exists(result_file):
                        processed_instance_ids.add(item)

            processed_count = len(processed_instance_ids)
            if processed_count > 0:
                logger.info(
                    f"Found {processed_count} existing instances in directory format. Will skip them."
                )

            # Filter out already processed instances
            remaining_instances = [
                instance
                for instance in instances
                if instance["instance_id"] not in processed_instance_ids
            ]

            return remaining_instances, processed_count

    def build_index(self, repo_path: str) -> Any:
        raise NotImplementedError("Subclasses must implement this method")

    def search(self, repo_path: str, issue: str, k: int = 20) -> List[Dict[str, Any]]:
        raise NotImplementedError("Subclasses must implement this method")

    def run(self, root_dir: str, token: str = "git") -> None:
        for instance in tqdm(self.instances, desc="Running retrieval"):
            instance_id = instance["instance_id"]
            repo = instance["repo"]
            commit = instance["base_commit"]
            issue = instance["problem_statement"]

            try:
                repo_dir = clone_repo(repo, root_dir, token)

                with ContextManager(str(repo_dir), commit):
                    logger.info(f"Building index for {instance_id}")
                    self.build_index(str(repo_dir))

                    logger.info(f"Searching for {instance_id}")
                    hits = self.search(repo_dir, issue, k=20)

                result = {"instance_id": instance_id, "hits": hits}

                with open(self.output_file, "a") as f:
                    f.write(json.dumps(result) + "\n")
                    logger.info(
                        f"Retrieval completed. Results saved to {self.output_file}"
                    )

            except Exception as e:
                logger.error(f"Error processing {instance_id}: {e}")
                logger.error(traceback.format_exc())
                continue
