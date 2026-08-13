import os
import json
from pathlib import Path
import re
import logging
from git import Repo
from filelock import FileLock

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def get_remaining_instances(instances, output_file):
    """
    Filters a list of instances to exclude those that have already been processed and saved in a file.

    Args:
        instances (List[Dict]): A list of instances, where each instance is a dictionary with an "instance_id" key.
        output_file (Path): The path to the file where the processed instances are saved.

    Returns:
        List[Dict]: A list of instances that have not been processed yet.
    """
    instance_ids = set()
    remaining_instances = list()
    if output_file.exists():
        with FileLock(output_file.as_posix() + ".lock"):
            with open(output_file) as f:
                for line in f:
                    instance = json.loads(line)
                    instance_id = instance["instance_id"]
                    instance_ids.add(instance_id)
            logger.warning(
                f"Found {len(instance_ids)} existing instances in {output_file}. Will skip them."
            )
    else:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        return instances
    for instance in instances:
        instance_id = instance["instance_id"]
        if instance_id not in instance_ids:
            remaining_instances.append(instance)
    return remaining_instances


def is_test(name, test_phrases=None):
    if test_phrases is None:
        test_phrases = ["test", "tests", "testing"]
    words = set(re.split(r" |_|\/|\.", name.lower()))
    return any(word in words for word in test_phrases)


def list_files(root_dir, include_tests=False):
    files = []
    for filename in Path(root_dir).rglob("*.py"):
        if not include_tests and is_test(filename.as_posix()):
            continue
        files.append(filename.relative_to(root_dir).as_posix())
    return files


class ContextManager:
    """
    A context manager for managing a Git repository at a specific commit.

    Args:
        repo_path (str): The path to the Git repository.
        base_commit (str): The commit hash to switch to.
        verbose (bool, optional): Whether to print verbose output. Defaults to False.

    Attributes:
        repo_path (str): The path to the Git repository.
        base_commit (str): The commit hash to switch to.
        verbose (bool): Whether to print verbose output.
        repo (git.Repo): The Git repository object.

    Methods:
        __enter__(): Switches to the specified commit and returns the context manager object.
        get_readme_files(): Returns a list of filenames for all README files in the repository.
        __exit__(exc_type, exc_val, exc_tb): Does nothing.
    """

    def __init__(self, repo_path, base_commit, verbose=False):
        self.repo_path = Path(repo_path).resolve().as_posix()
        self.base_commit = base_commit
        self.verbose = verbose
        self.repo = Repo(self.repo_path)

    def __enter__(self):
        if self.verbose:
            print(f"Switching to {self.base_commit}")
        try:
            self.repo.git.reset("--hard", self.base_commit)
            self.repo.git.clean("-fdxq")
        except Exception as e:
            logger.error(f"Failed to switch to {self.base_commit}")
            logger.error(e)
            raise e
        return self

    def get_readme_files(self):
        files = os.listdir(self.repo_path)
        files = list(filter(lambda x: os.path.isfile(x), files))
        files = list(filter(lambda x: x.lower().startswith("readme"), files))
        return files

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass


def clone_repo(repo, root_dir, token):
    """
    Clones a GitHub repository to a specified directory.

    Args:
        repo (str): The GitHub repository to clone.
        root_dir (str): The root directory to clone the repository to.
        token (str): The GitHub personal access token to use for authentication.

    Returns:
        Path: The path to the cloned repository directory.
    """
    repo_dir = Path(root_dir, f"repo__{repo.replace('/', '__')}")

    if not repo_dir.exists():
        repo_url = f"https://{token}@github.com/{repo}.git"
        logger.info(f"Cloning {repo} {os.getpid()}")
        Repo.clone_from(repo_url, repo_dir)
    return repo_dir
