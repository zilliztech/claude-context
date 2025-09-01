#!/usr/bin/env python3
"""
ChromaDB Client Tool
 
A command-line tool for managing ChromaDB collections and records.
Supports listing collections, querying records, and deleting collections.
"""
 
import argparse
import json
import sys
from typing import List, Optional, Dict, Any
from chromadb import HttpClient
from chromadb.config import Settings
 
 
class ChromaDBClient:
    """ChromaDB client wrapper with utility methods."""
   
    def __init__(self, host: str = 'localhost', port: int = 19801, ssl: bool = False):
        """Initialize ChromaDB client."""
        try:
            self.client = HttpClient(
                host=host,
                port=port,
                ssl=ssl,
                settings=Settings(allow_reset=True)
            )
            # Test connection
            self.client.heartbeat()
        except Exception as e:
            print(f"Error connecting to ChromaDB: {e}")
            sys.exit(1)
   
    def list_collections(self) -> List[Dict[str, Any]]:
        """List all collections with their record counts."""
        try:
            collections = self.client.list_collections()
            result = []
           
            for collection in collections:
                try:
                    count = collection.count()
                    result.append({
                        'name': collection.name,
                        'count': count,
                        'metadata': collection.metadata or {}
                    })
                except Exception as e:
                    print(f"Warning: Could not get count for collection '{collection.name}': {e}")
                    result.append({
                        'name': collection.name,
                        'count': 'unknown',
                        'metadata': collection.metadata or {}
                    })
           
            return result
        except Exception as e:
            print(f"Error listing collections: {e}")
            return []
   
    def query_records(self, collection_name: str, ids: Optional[List[str]] = None,
                     limit: int = 100, where: Optional[Dict] = None) -> Dict[str, Any]:
        """Query records from a specific collection."""
        try:
            collection = self.client.get_collection(collection_name)
           
            # Build query parameters
            query_params = {}
            if ids:
                query_params['ids'] = ids
            if where:
                query_params['where'] = where
            if limit:
                query_params['limit'] = limit
           
            results = collection.get(**query_params)
           
            return {
                'collection_name': collection_name,
                'total_count': len(results['ids']),
                'records': []
            }
           
        except Exception as e:
            print(f"Error querying collection '{collection_name}': {e}")
            return {'error': str(e)}
   
    def get_record_details(self, collection_name: str, ids: List[str]) -> Dict[str, Any]:
        """Get detailed information about specific records."""
        try:
            collection = self.client.get_collection(collection_name)
            results = collection.get(ids=ids)
           
            records = []
            for i in range(len(results['ids'])):
                record = {
                    'id': results['ids'][i],
                    'document': results['documents'][i] if results.get('documents') else None,
                    'metadata': results['metadatas'][i] if results.get('metadatas') else None,
                    'embeddings': results['embeddings'][i] if results.get('embeddings') else None
                }
                records.append(record)
           
            return {
                'collection_name': collection_name,
                'requested_ids': ids,
                'found_count': len(records),
                'records': records
            }
           
        except Exception as e:
            print(f"Error getting record details: {e}")
            return {'error': str(e)}
   
    def get_top_records(self, collection_name: str, limit: int = 10, where: Optional[Dict] = None) -> Dict[str, Any]:
        """Get top N records from a collection."""
        try:
            collection = self.client.get_collection(collection_name)
           
            # Build query parameters
            query_params = {'limit': limit}
            if where:
                query_params['where'] = where
           
            results = collection.get(**query_params)
           
            records = []
            for i in range(len(results['ids'])):
                record = {
                    'id': results['ids'][i],
                    'document': results['documents'][i] if results.get('documents') else None,
                    'metadata': results['metadatas'][i] if results.get('metadatas') else None,
                    'embeddings': results['embeddings'][i] if results.get('embeddings') else None
                }
                records.append(record)
           
            return {
                'collection_name': collection_name,
                'limit': limit,
                'total_found': len(records),
                'records': records
            }
           
        except Exception as e:
            print(f"Error getting top records from collection '{collection_name}': {e}")
            return {'error': str(e)}
 
    def delete_collection(self, collection_name: str) -> Dict[str, Any]:
        """Delete a collection by name."""
        try:
            # Check if collection exists
            collections = self.client.list_collections()
            collection_names = [c.name for c in collections]
           
            if collection_name not in collection_names:
                return {
                    'success': False,
                    'error': f"Collection '{collection_name}' not found"
                }
           
            # Get collection info before deletion
            collection = self.client.get_collection(collection_name)
            count = collection.count()
           
            # Delete the collection
            self.client.delete_collection(collection_name)
           
            return {
                'success': True,
                'collection_name': collection_name,
                'deleted_records': count,
                'message': f"Collection '{collection_name}' with {count} records deleted successfully"
            }
           
        except Exception as e:
            print(f"Error deleting collection '{collection_name}': {e}")
            return {
                'success': False,
                'error': str(e)
            }
 
 
def print_collections(collections: List[Dict[str, Any]], format_output: str = 'table'):
    """Print collections in specified format."""
    if format_output == 'json':
        print(json.dumps(collections, indent=2))
        return
   
    if not collections:
        print("No collections found in ChromaDB")
        return
   
    print("ChromaDB Collections:")
    print("=" * 50)
    print(f"{'Collection Name':<30} {'Record Count':<15} {'Metadata'}")
    print("-" * 50)
   
    for collection in collections:
        name = collection['name'][:29]  # Truncate if too long
        count = str(collection['count'])
        metadata = json.dumps(collection['metadata'])[:20] + "..." if collection['metadata'] else "{}"
        print(f"{name:<30} {count:<15} {metadata}")
 
 
def print_record_details(result: Dict[str, Any], format_output: str = 'table'):
    """Print record details in specified format."""
    if format_output == 'json':
        print(json.dumps(result, indent=2))
        return
   
    if 'error' in result:
        print(f"Error: {result['error']}")
        return
   
    print(f"\nRecords in collection '{result['collection_name']}':")
    print("=" * 60)
    print(f"Total records found: {result['found_count']}")
    print(f"Requested IDs: {result['requested_ids']}")
    print("-" * 60)
   
    for i, record in enumerate(result['records'], 1):
        print(f"\nRecord {i}:")
        print(f"ID: {record['id']}")
        if record['document']:
            doc_preview = record['document'][:100] + "..." if len(str(record['document'])) > 100 else record['document']
            print(f"Document: {doc_preview}")
        if record['metadata']:
            print(f"Metadata: {json.dumps(record['metadata'], indent=2)}")
        print("-" * 40)
 
 
def print_top_records(result: Dict[str, Any], format_output: str = 'table'):
    """Print top records in specified format."""
    if format_output == 'json':
        print(json.dumps(result, indent=2))
        return
   
    if 'error' in result:
        print(f"Error: {result['error']}")
        return
   
    print(f"\nTop {result['limit']} records in collection '{result['collection_name']}':")
    print("=" * 60)
    print(f"Total records found: {result['total_found']}")
    print("-" * 60)
   
    for i, record in enumerate(result['records'], 1):
        print(f"\nRecord {i}:")
        print(f"ID: {record['id']}")
        if record['document']:
            doc_preview = record['document'][:100] + "..." if len(str(record['document'])) > 100 else record['document']
            print(f"Document: {doc_preview}")
        if record['metadata']:
            print(f"Metadata: {json.dumps(record['metadata'], indent=2)}")
        print("-" * 40)
 
 
def main():
    """Main function to handle command-line interface."""
    parser = argparse.ArgumentParser(
        description="ChromaDB Client Tool - Manage collections and records",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s list
  %(prog)s list --format json
  %(prog)s query --collection my_collection --ids id1,id2,id3
  %(prog)s query --collection my_collection --limit 10
  %(prog)s top --collection my_collection --limit 5
  %(prog)s top --collection my_collection --limit 20 --where '{"type": "code"}'
  %(prog)s delete --collection my_collection
        """
    )
   
    parser.add_argument('--host', default='localhost', help='ChromaDB host (default: localhost)')
    parser.add_argument('--port', type=int, default=19801, help='ChromaDB port (default: 19801)')
    parser.add_argument('--ssl', action='store_true', help='Use SSL connection')
    parser.add_argument('--format', choices=['table', 'json'], default='table',
                       help='Output format (default: table)')
   
    subparsers = parser.add_subparsers(dest='command', help='Available commands')
   
    # List command
    list_parser = subparsers.add_parser('list', help='List all collections')
   
    # Query command
    query_parser = subparsers.add_parser('query', help='Query records from a collection')
    query_parser.add_argument('--collection', required=True, help='Collection name')
    query_parser.add_argument('--ids', help='Comma-separated list of record IDs')
    query_parser.add_argument('--limit', type=int, default=100, help='Maximum number of records to return')
    query_parser.add_argument('--where', help='JSON filter condition')
   
    # Top records command
    top_parser = subparsers.add_parser('top', help='List top N records from a collection')
    top_parser.add_argument('--collection', required=True, help='Collection name')
    top_parser.add_argument('--limit', type=int, default=10, help='Number of records to return (default: 10)')
    top_parser.add_argument('--where', help='JSON filter condition')
   
    # Delete command
    delete_parser = subparsers.add_parser('delete', help='Delete a collection')
    delete_parser.add_argument('--collection', required=True, help='Collection name to delete')
    delete_parser.add_argument('--confirm', action='store_true', help='Skip confirmation prompt')
   
    args = parser.parse_args()
   
    if not args.command:
        parser.print_help()
        return
   
    # Initialize client
    client = ChromaDBClient(host=args.host, port=args.port, ssl=args.ssl)
   
    if args.command == 'list':
        collections = client.list_collections()
        print_collections(collections, args.format)
   
    elif args.command == 'query':
        # Parse IDs if provided
        ids = None
        if args.ids:
            ids = [id.strip() for id in args.ids.split(',')]
       
        # Parse where condition if provided
        where = None
        if args.where:
            try:
                where = json.loads(args.where)
            except json.JSONDecodeError:
                print("Error: Invalid JSON in --where parameter")
                return
       
        if ids:
            # Get specific records by IDs
            result = client.get_record_details(args.collection, ids)
            print_record_details(result, args.format)
        else:
            # Query records with filters
            result = client.query_records(args.collection, limit=args.limit, where=where)
            if args.format == 'json':
                print(json.dumps(result, indent=2))
            else:
                print(f"Query results for collection '{args.collection}':")
                print(f"Total records: {result.get('total_count', 0)}")
   
    elif args.command == 'top':
        # Parse where condition if provided
        where = None
        if args.where:
            try:
                where = json.loads(args.where)
            except json.JSONDecodeError:
                print("Error: Invalid JSON in --where parameter")
                return
       
        result = client.get_top_records(args.collection, limit=args.limit, where=where)
        print_top_records(result, args.format)
   
    elif args.command == 'delete':
        if not args.confirm:
            # Ask for confirmation
            response = input(f"Are you sure you want to delete collection '{args.collection}'? (y/N): ")
            if response.lower() not in ['y', 'yes']:
                print("Deletion cancelled.")
                return
       
        result = client.delete_collection(args.collection)
        if args.format == 'json':
            print(json.dumps(result, indent=2))
        else:
            if result['success']:
                print(f"✓ {result['message']}")
            else:
                print(f"✗ Error: {result['error']}")
 
 
# python chromadb_test.py list
# python chromadb_test.py query --collection code_chunks --ids chunk_001,chunk_002
# python chromadb_test.py top --collection code_chunks --limit 5
# python chromadb_test.py top --collection code_chunks --limit 10 --where '{"type": "documentation"}'
# python chromadb_test.py delete --collection old_collection
# python chromadb_test.py --host remote-server.com --port 19801 list
 
if __name__ == "__main__":
    main()