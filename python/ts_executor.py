#!/usr/bin/env python3
"""
TypeScript Executor - Execute TypeScript methods from Python
Supports calling TypeScript functions with complex parameters and async/await
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional


class TypeScriptExecutor:
    """TypeScript method executor"""

    def __init__(self, working_dir: Optional[str] = None):
        """Initialize TypeScript executor

        Args:
            working_dir: Working directory, defaults to current directory
        """
        self.working_dir = working_dir or os.getcwd()

    def call_method(self, ts_file_path: str, method_name: str, *args, **kwargs) -> Any:
        """Call TypeScript method

        Args:
            ts_file_path: TypeScript file path
            method_name: Method name
            *args: Positional arguments
            **kwargs: Keyword arguments

        Returns:
            Execution result
        """

        # Convert relative path to absolute path
        if not os.path.isabs(ts_file_path):
            ts_file_path = os.path.join(self.working_dir, ts_file_path)

        # Ensure the target file exists
        if not os.path.exists(ts_file_path):
            raise FileNotFoundError(f"TypeScript file not found: {ts_file_path}")

        # Get the directory of the target file
        target_dir = os.path.dirname(ts_file_path)

        # Create wrapper script
        wrapper_code = self._create_wrapper_script(
            ts_file_path, method_name, list(args), kwargs
        )

        # Create temporary file in the same directory as the target file
        temp_fd, temp_file = tempfile.mkstemp(suffix=".ts", dir=target_dir)

        try:
            # Write wrapper script
            with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
                f.write(wrapper_code)

            # Execute TypeScript code using ts-node
            result = subprocess.run(
                ["npx", "ts-node", temp_file],
                capture_output=True,
                text=True,
                check=True,
                cwd=self.working_dir,
            )

            # Parse results
            if result.stdout.strip():
                # Try to extract JSON part from output
                import re

                output = result.stdout.strip()
                # Find the last complete JSON object - improved regex
                json_match = re.search(
                    r"\{.*\}(?=\s*$)", output, re.DOTALL | re.MULTILINE
                )
                if json_match:
                    try:
                        return json.loads(json_match.group())
                    except json.JSONDecodeError:
                        pass
                # If no JSON found, try direct parsing
                try:
                    return json.loads(output)
                except json.JSONDecodeError:
                    return output  # Return raw output
            else:
                return None

        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"TypeScript execution failed: {e.stderr}")
        except Exception as e:
            raise RuntimeError(f"Execution error: {str(e)}")
        finally:
            # Clean up temporary file
            os.unlink(temp_file)

    def _create_wrapper_script(
        self,
        ts_file_path: str,
        method_name: str,
        args: List[Any],
        kwargs: Dict[str, Any],
    ) -> str:
        """Create wrapper script

        Args:
            ts_file_path: TypeScript file path
            method_name: Method name
            args: Positional arguments
            kwargs: Keyword arguments

        Returns:
            Wrapper script code
        """

        # Use relative path for import, since temp file is in the same directory
        ts_filename = os.path.basename(ts_file_path)

        # Remove .ts extension, since import doesn't need it
        if ts_filename.endswith(".ts"):
            import_path = "./" + ts_filename[:-3]
        else:
            import_path = "./" + ts_filename

        args_json = json.dumps(args)
        kwargs_json = json.dumps(kwargs)

        wrapper_code = f"""
import * as targetModule from '{import_path}';

async function executeMethod() {{
    try {{
        // Prepare arguments
        const args: any[] = {args_json};
        const kwargs: any = {kwargs_json};
        
        // Get method
        const method = (targetModule as any).{method_name};
        if (typeof method !== 'function') {{
            throw new Error(`Method '{method_name}' does not exist or is not a function`);
        }}
        
        // Call method
        let result: any;
        if (Object.keys(kwargs).length > 0) {{
            // If there are keyword arguments, pass them as the last parameter
            result = await method(...args, kwargs);
        }} else {{
            // Only positional arguments
            result = await method(...args);
        }}
        
        // Output result
        console.log(JSON.stringify(result));
    }} catch (error: any) {{
        console.error(JSON.stringify({{
            error: (error as Error).message,
            stack: (error as Error).stack
        }}));
        process.exit(1);
    }}
}}

executeMethod();
"""
        return wrapper_code


# Convenience function
def call_ts_method(
    ts_file: str, method_name: str, *args, working_dir: Optional[str] = None, **kwargs
) -> Any:
    """Convenience function: Call TypeScript method

    Args:
        ts_file: TypeScript file path
        method_name: Method name
        *args: Positional arguments
        working_dir: Working directory
        **kwargs: Keyword arguments

    Returns:
        Execution result
    """
    executor = TypeScriptExecutor(working_dir)
    return executor.call_method(ts_file, method_name, *args, **kwargs)


# Usage example
if __name__ == "__main__":

    # Create test TypeScript file
    test_ts_content = """
export function add(a: number, b: number): number {
    return a + b;
}

export function greet(name: string, options?: { formal?: boolean }): string {
    const greeting = options?.formal ? "Hello" : "Hi";
    return `${greeting}, ${name}!`;
}

export async function processData(data: any[]): Promise<{ count: number; items: any[] }> {
    // Simulate async processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
        count: data.length,
        items: data.map(item => ({ processed: true, original: item }))
    };
}

export function complexFunction(
    numbers: number[], 
    config: { multiplier: number; offset: number }
): { result: number[]; sum: number } {
    const result = numbers.map(n => n * config.multiplier + config.offset);
    const sum = result.reduce((a, b) => a + b, 0);
    
    return { result, sum };
}
"""

    # Write test file
    with open("test_methods.ts", "w") as f:
        f.write(test_ts_content)

    try:
        # Create executor
        executor = TypeScriptExecutor()

        print("=== TypeScript Method Execution Test ===")

        # Test 1: Simple function
        print("\n1. Testing simple addition function:")
        result = executor.call_method("test_methods.ts", "add", 10, 20)
        print(f"   add(10, 20) = {result}")

        # Test 2: Function with optional parameters
        print("\n2. Testing greeting function:")
        result1 = executor.call_method("test_methods.ts", "greet", "Alice")
        print(f"   greet('Alice') = {result1}")

        result2 = executor.call_method(
            "test_methods.ts", "greet", "Bob", {"formal": True}
        )
        print(f"   greet('Bob', {{formal: true}}) = {result2}")

        # Test 3: Async function
        print("\n3. Testing async function:")
        result = executor.call_method(
            "test_methods.ts", "processData", [1, 2, 3, "hello"]
        )
        print(f"   processData([1, 2, 3, 'hello']) = {result}")

        # Test 4: Complex function
        print("\n4. Testing complex function:")
        result = executor.call_method(
            "test_methods.ts",
            "complexFunction",
            [1, 2, 3, 4, 5],
            {"multiplier": 2, "offset": 1},
        )
        print(f"   complexFunction([1,2,3,4,5], {{multiplier:2, offset:1}}) = {result}")

        # Test 5: Using convenience function
        print("\n5. Testing convenience function:")
        result = call_ts_method("test_methods.ts", "add", 100, 200)
        print(f"   call_ts_method('test_methods.ts', 'add', 100, 200) = {result}")

    except Exception as e:
        print(f"Error: {e}")

    finally:
        # Clean up test file
        if os.path.exists("test_methods.ts"):
            os.remove("test_methods.ts")
