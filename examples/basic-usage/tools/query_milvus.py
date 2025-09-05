from pymilvus import connections, utility, Collection

# 1. connect to Milvus
connections.connect(alias="default", host="127.0.0.1", port="19530")

import sys

def list_collections():
    collections = utility.list_collections()
    print("all collections:")
    for name in collections:
        print(f"- {name}")

def get_collection_info(collection_name):
    try:
        collection = Collection(collection_name)
        print(f"\nschema of {collection_name}:")
        print(collection.schema)
        print(f"\nrecord count of {collection_name}:")
        print(collection.num_entities)
    except Exception as e:
        print(f"Error: {e}")

def list_some_records(collection_name, count):
    collection = Collection(collection_name)
    print(f"\nfirst {count} records of {collection_name}:")

    # Exclude fields that are not allowed to be retrieved (e.g., sparse_vector)
    forbidden_fields = {"sparse_vector"}
    output_fields = [field.name for field in collection.schema.fields if field.name not in forbidden_fields]

    try:
        results = collection.query(
            expr="",
            output_fields=output_fields,
            limit=count
        )
    except Exception as e:
        print(f"Error querying records: {e}")
        return

    if not results:
        print("No records found.")
        return

    for record in results:
        import json
        with open(f"{collection_name}_records.json", "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
            f.write("\n")

def query_collection(collection_name, query_text):
    from pymilvus import DataType
    import numpy as np

    collection = Collection(collection_name)

    # In a hybrid collection, there may be multiple vector fields (e.g., dense and sparse)
    # Each vector field can have its own metric_type and dimension.
    # We'll print all vector fields and their metric types, and let the user choose which to search.

    vector_fields = []
    for field in collection.schema.fields:
        if field.dtype == DataType.FLOAT_VECTOR or field.dtype == DataType.BINARY_VECTOR:
            metric_type = field.params.get("metric_type", None)
            dim = field.params.get("dim", None)
            vector_fields.append({
                "name": field.name,
                "dtype": field.dtype,
                "dim": dim,
                "metric_type": metric_type
            })
        # Also check for sparse vector fields (e.g., SPARSE_FLOAT_VECTOR in Milvus 2.3+)
        if hasattr(DataType, "SPARSE_FLOAT_VECTOR") and field.dtype == DataType.SPARSE_FLOAT_VECTOR:
            metric_type = field.params.get("metric_type", None)
            dim = field.params.get("dim", None)
            vector_fields.append({
                "name": field.name,
                "dtype": field.dtype,
                "dim": dim,
                "metric_type": metric_type
            })

    if not vector_fields:
        print("No vector fields found in collection schema.")
        return

    print("Vector fields in this (hybrid) collection:")
    for idx, vf in enumerate(vector_fields):
        print(f"  [{idx}] name: {vf['name']}, dtype: {vf['dtype']}, dim: {vf['dim']}, metric_type: {vf['metric_type']}")

    # Ask user which vector field to search
    if len(vector_fields) > 1:
        try:
            choice = int(input(f"Select vector field to search [0-{len(vector_fields)-1}]: "))
            vf = vector_fields[choice]
        except Exception:
            print("Invalid selection.")
            return
    else:
        vf = vector_fields[0]

    anns_field = vf["name"]
    dim = vf["dim"]
    metric_type = vf["metric_type"]
    dtype = vf["dtype"]

    if anns_field is None or dim is None or metric_type is None:
        print("Could not determine vector field, dimension, or metric_type from schema.")
        return

    print(f"Using anns_field: {anns_field}, dim: {dim}, metric_type: {metric_type}")
    print("NOTE: This demo uses a random vector as the query. Replace with your embedding for real search.")

    if isinstance(dim, str):
        dim = int(dim)
    if dtype == DataType.BINARY_VECTOR:
        query_vec = [np.random.bytes(dim // 8)]
    else:
        query_vec = [np.random.rand(dim).astype(np.float32).tolist()]

    # Use the correct metric_type for the search
    search_params = {"metric_type": metric_type, "params": {"nprobe": 10}}
    try:
        results = collection.search(
            query_vec,
            anns_field=anns_field,
            param=search_params,
            limit=10,
            output_fields=None
        )
        print("Search results:")
        for hits in results:
            for hit in hits:
                print(f"id: {hit.id}, distance: {hit.distance}, entity: {hit.entity}")
    except Exception as e:
        print(f"Error during search: {e}")
        print("If you see a metric type mismatch error, check your collection's metric_type and ensure you are passing the correct one in the search parameters.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python query_milvus.py <subcommand> [collection_name]")
        print("Subcommands:")
        print("  list                List all collections")
        print("  get <collection>    Get schema and record count of a collection")
        print("  query <collection> <query_text>   Search collection (demo: random vector)")
        print("  list_some_records <collection> <count>   List some records of a collection")
        sys.exit(1)

    subcommand = sys.argv[1]
    if subcommand == "list":
        list_collections()
    elif subcommand == "get":
        if len(sys.argv) < 3:
            print("Usage: python query_milvus.py get <collection_name>")
            sys.exit(1)
        collection_name = sys.argv[2]
        get_collection_info(collection_name)
    elif subcommand == "query":
        if len(sys.argv) < 4:
            print("Usage: python query_milvus.py query <collection_name> <query_text>")
            sys.exit(1)
        collection_name = sys.argv[2]
        query_text = sys.argv[3]
        query_collection(collection_name, query_text)
    elif subcommand == "list_some_records":
        if len(sys.argv) < 4:
            print("Usage: python query_milvus.py list_some_records <collection_name> <count>")
            sys.exit(1)
        collection_name = sys.argv[2]
        count = int(sys.argv[3])
        list_some_records(collection_name, count)
    else:
        print(f"Unknown subcommand: {subcommand}")
        sys.exit(1)
