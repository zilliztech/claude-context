import re

with open("app_with_cache.log", "r") as f:
    log_text = f.read()

pattern = r"Total get_embeddings runtime: ([0-9.]+) seconds"
matches = re.findall(pattern, log_text)

times = [float(x) for x in matches]

if times:
    average_time = sum(times) / len(times)
    print(f"Total log entries with runtime: {len(times)}")
    print(f"Average total runtime: {average_time:.4f} seconds")
else:
    print("No total runtime entries found.")
