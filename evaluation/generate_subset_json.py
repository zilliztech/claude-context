#!/usr/bin/env python3
"""
Generate swe_verified_15min1h_2files_instances.json from the subset analysis
"""

import json
import re
from datasets import load_dataset

def parse_patch_files(patch_content):
    """Parse patch content to extract the number of modified files"""
    if not patch_content:
        return []
    
    file_pattern = r'^diff --git a/(.*?) b/(.*?)$'
    files = []
    
    for line in patch_content.split('\n'):
        match = re.match(file_pattern, line)
        if match:
            file_path = match.group(1)
            files.append(file_path)
    
    return files

def main():
    print("Loading SWE-bench_Verified dataset...")
    dataset = load_dataset("princeton-nlp/SWE-bench_Verified")
    instances = list(dataset['test'])
    
    print("Filtering instances for: 15min-1hour difficulty + 2 patch files...")
    
    # Filter for the specific subset
    subset_instances = []
    
    for instance in instances:
        difficulty = instance.get('difficulty', 'Unknown')
        
        # Parse main patch to count files
        patch_content = instance.get('patch', '')
        patch_files = parse_patch_files(patch_content)
        oracle_count = len(patch_files)
        
        # Check if it matches our criteria
        if difficulty == '15 min - 1 hour' and oracle_count == 2:
            subset_instances.append(instance)
    
    print(f"Found {len(subset_instances)} instances matching criteria")
    
    # Create the JSON structure that _prepare_instances expects
    output_data = {
        "metadata": {
            "description": "SWE-bench_Verified subset: 15min-1hour difficulty with 2 patch files",
            "source_dataset": "princeton-nlp/SWE-bench_Verified", 
            "extraction_date": "2024",
            "filter_criteria": {
                "difficulty": "15 min - 1 hour",
                "patch_files_count": 2
            },
            "total_instances": len(subset_instances),
            "statistics": {
                "total_instances_in_original": 500,
                "subset_count": len(subset_instances),
                "percentage_of_original": round((len(subset_instances) / 500) * 100, 1)
            }
        },
        "instances": subset_instances
    }
    
    # Save to JSON file
    output_file = "swe_verified_15min1h_2files_instances.json"
    with open(output_file, 'w') as f:
        json.dump(output_data, f, indent=2)
    
    print(f"Generated {output_file} with {len(subset_instances)} instances")
    
    # Verify the structure
    print("\nVerifying JSON structure...")
    with open(output_file, 'r') as f:
        loaded_data = json.load(f)
    
    print(f"✓ Contains 'instances' key: {'instances' in loaded_data}")
    print(f"✓ Contains 'metadata' key: {'metadata' in loaded_data}")
    print(f"✓ Number of instances: {len(loaded_data['instances'])}")
    print(f"✓ First instance has required fields:")
    
    if loaded_data['instances']:
        first_instance = loaded_data['instances'][0]
        required_fields = ['instance_id', 'repo', 'base_commit', 'problem_statement']
        for field in required_fields:
            has_field = field in first_instance
            print(f"   - {field}: {'✓' if has_field else '✗'}")
    
    print(f"\nFile successfully generated: {output_file}")
    print("This file can be used with BaseRetrieval._prepare_instances()")

if __name__ == "__main__":
    main()
