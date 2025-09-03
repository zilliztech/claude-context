"""
Sample Python file with all AST splitter features
This file contains all node types that the AST splitter recognizes for Python:
- function_definition
- class_definition  
- decorated_definition
- async_function_definition
"""

import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Protocol, TypeVar, Generic, Union
from functools import wraps, lru_cache

# Type variables for generic functions/classes
T = TypeVar('T')
K = TypeVar('K')
V = TypeVar('V')

# Function definition - simple function
def calculate_factorial(n: int) -> int:
    """Calculate factorial of a number recursively."""
    if n <= 1:
        return 1
    return n * calculate_factorial(n - 1)

# Function definition - function with multiple parameters  
def validate_email(email: str, domain_whitelist: Optional[List[str]] = None) -> bool:
    """Validate email format and optionally check domain whitelist."""
    if '@' not in email:
        return False
    
    local, domain = email.rsplit('@', 1)
    
    if not local or not domain:
        return False
        
    if domain_whitelist and domain not in domain_whitelist:
        return False
        
    return True

# Function definition - function with complex logic
def debounce(wait: float, immediate: bool = False):
    """Decorator that debounces function calls."""
    def decorator(func):
        last_call_time = [0]
        result = [None]
        
        @wraps(func)
        def wrapper(*args, **kwargs):
            current_time = time.time()
            
            if immediate and (current_time - last_call_time[0]) > wait:
                result[0] = func(*args, **kwargs)
            elif not immediate:
                if (current_time - last_call_time[0]) >= wait:
                    result[0] = func(*args, **kwargs)
                    
            last_call_time[0] = current_time
            return result[0]
            
        return wrapper
    return decorator

# Async function definition - simple async function
async def fetch_data(url: str, timeout: float = 30.0) -> Dict[str, Any]:
    """Fetch data from URL asynchronously."""
    # Mock implementation
    await asyncio.sleep(0.1)
    return {
        "url": url,
        "status": 200,
        "data": f"Response from {url}",
        "timestamp": datetime.now().isoformat()
    }

# Async function definition - complex async function
async def batch_fetch(urls: List[str], batch_size: int = 5) -> List[Dict[str, Any]]:
    """Fetch multiple URLs in batches."""
    results = []
    
    for i in range(0, len(urls), batch_size):
        batch = urls[i:i + batch_size]
        batch_tasks = [fetch_data(url) for url in batch]
        batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
        
        for result in batch_results:
            if isinstance(result, Exception):
                results.append({"error": str(result), "success": False})
            else:
                results.append({**result, "success": True})
    
    return results

# Decorated definition - function with decorators
@lru_cache(maxsize=128)
@debounce(wait=1.0)
def expensive_computation(n: int) -> int:
    """An expensive computation that benefits from caching and debouncing."""
    # Simulate expensive computation
    result = 0
    for i in range(n):
        result += i ** 2
    return result

# Decorated definition - multiple decorators
@staticmethod
def format_currency(amount: float, currency: str = "USD") -> str:
    """Format amount as currency string."""
    return f"{currency} {amount:.2f}"

# Class definition - basic class
class Logger:
    """Simple logging class with different log levels."""
    
    def __init__(self, name: str, level: str = "INFO"):
        self.name = name
        self.level = level.upper()
        self.logs = []
        
    def _log(self, level: str, message: str) -> None:
        """Internal method to add log entry."""
        timestamp = datetime.now().isoformat()
        log_entry = {
            "timestamp": timestamp,
            "level": level,
            "logger": self.name,
            "message": message
        }
        self.logs.append(log_entry)
        
    def info(self, message: str) -> None:
        """Log info level message."""
        if self.level in ["DEBUG", "INFO", "WARNING", "ERROR"]:
            self._log("INFO", message)
            
    def warning(self, message: str) -> None:
        """Log warning level message."""
        if self.level in ["WARNING", "ERROR"]:
            self._log("WARNING", message)
            
    def error(self, message: str) -> None:
        """Log error level message."""
        if self.level in ["ERROR"]:
            self._log("ERROR", message)
            
    def get_logs(self) -> List[Dict[str, Any]]:
        """Return all log entries."""
        return self.logs.copy()
        
    def clear_logs(self) -> None:
        """Clear all log entries."""
        self.logs.clear()

# Class definition - class with inheritance
class FileLogger(Logger):
    """Logger that writes to file in addition to memory."""
    
    def __init__(self, name: str, filename: str, level: str = "INFO"):
        super().__init__(name, level)
        self.filename = filename
        
    def _log(self, level: str, message: str) -> None:
        """Override to also write to file."""
        super()._log(level, message)
        
        # Write to file (mock implementation)
        log_line = f"[{datetime.now().isoformat()}] {level}: {message}\n"
        # In real implementation: append to self.filename
        
    def rotate_log_file(self) -> None:
        """Rotate log file by renaming current and starting new."""
        # Mock implementation
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        archived_name = f"{self.filename}.{timestamp}"
        print(f"Rotating {self.filename} to {archived_name}")

# Class definition - abstract base class
class Database(ABC):
    """Abstract base class for database connections."""
    
    def __init__(self, connection_string: str):
        self.connection_string = connection_string
        self.connected = False
        self.logger = Logger(self.__class__.__name__)
        
    @abstractmethod
    def connect(self) -> bool:
        """Connect to database."""
        pass
        
    @abstractmethod
    def disconnect(self) -> None:
        """Disconnect from database."""
        pass
        
    @abstractmethod
    def execute_query(self, query: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Execute a query and return results."""
        pass
        
    @abstractmethod
    def execute_command(self, command: str, params: Optional[Dict[str, Any]] = None) -> int:
        """Execute a command and return affected rows."""
        pass
        
    def is_connected(self) -> bool:
        """Check if database is connected."""
        return self.connected
        
    def log_query(self, query: str, duration: float) -> None:
        """Log executed query with duration."""
        self.logger.info(f"Query executed in {duration:.3f}s: {query[:100]}...")

# Class definition - implementing abstract class
class MockDatabase(Database):
    """Mock database implementation for testing."""
    
    def __init__(self, connection_string: str):
        super().__init__(connection_string)
        self.data = {}
        
    def connect(self) -> bool:
        """Mock connection."""
        self.logger.info(f"Connecting to {self.connection_string}")
        self.connected = True
        return True
        
    def disconnect(self) -> None:
        """Mock disconnection."""
        self.logger.info("Disconnecting from database")
        self.connected = False
        
    def execute_query(self, query: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Mock query execution."""
        start_time = time.time()
        
        # Mock delay
        time.sleep(0.01)
        
        # Mock result based on query
        if "SELECT" in query.upper():
            result = [
                {"id": 1, "name": "John Doe", "email": "john@example.com"},
                {"id": 2, "name": "Jane Smith", "email": "jane@example.com"}
            ]
        else:
            result = []
            
        duration = time.time() - start_time
        self.log_query(query, duration)
        
        return result
        
    def execute_command(self, command: str, params: Optional[Dict[str, Any]] = None) -> int:
        """Mock command execution."""
        start_time = time.time()
        time.sleep(0.005)
        
        # Mock affected rows
        affected_rows = 1 if any(cmd in command.upper() for cmd in ["INSERT", "UPDATE", "DELETE"]) else 0
        
        duration = time.time() - start_time
        self.log_query(command, duration)
        
        return affected_rows

# Class definition - generic class
class Repository(Generic[T, K]):
    """Generic repository pattern implementation."""
    
    def __init__(self, database: Database, table_name: str):
        self.database = database
        self.table_name = table_name
        self.logger = Logger(f"Repository[{table_name}]")
        
    async def find_by_id(self, id_value: K) -> Optional[T]:
        """Find record by ID."""
        query = f"SELECT * FROM {self.table_name} WHERE id = %(id)s"
        params = {"id": id_value}
        
        results = self.database.execute_query(query, params)
        
        if results:
            return self._map_result(results[0])
        return None
        
    async def create(self, entity: T) -> K:
        """Create new record."""
        # Mock implementation
        self.logger.info(f"Creating new {self.table_name} record")
        return 1  # Mock ID
        
    async def update(self, id_value: K, updates: Dict[str, Any]) -> Optional[T]:
        """Update existing record."""
        command = f"UPDATE {self.table_name} SET ... WHERE id = %(id)s"
        affected = self.database.execute_command(command, {"id": id_value})
        
        if affected > 0:
            return await self.find_by_id(id_value)
        return None
        
    async def delete(self, id_value: K) -> bool:
        """Delete record by ID."""
        command = f"DELETE FROM {self.table_name} WHERE id = %(id)s"
        affected = self.database.execute_command(command, {"id": id_value})
        return affected > 0
        
    def _map_result(self, result: Dict[str, Any]) -> T:
        """Map database result to entity type."""
        # Mock implementation - in real code, this would properly map to T
        return result  # type: ignore

# Decorated definition - dataclass
@dataclass
class User:
    """User entity with dataclass decoration."""
    id: int
    name: str
    email: str
    created_at: datetime = field(default_factory=datetime.now)
    is_active: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        """Post-initialization processing."""
        if not validate_email(self.email):
            raise ValueError(f"Invalid email: {self.email}")
            
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "created_at": self.created_at.isoformat(),
            "is_active": self.is_active,
            "metadata": self.metadata
        }
        
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'User':
        """Create from dictionary."""
        return cls(
            id=data["id"],
            name=data["name"],
            email=data["email"],
            created_at=datetime.fromisoformat(data["created_at"]),
            is_active=data.get("is_active", True),
            metadata=data.get("metadata", {})
        )

# Class definition - service class using repository
class UserService:
    """Service class for user operations."""
    
    def __init__(self, database: Database):
        self.database = database
        self.repository = Repository[User, int](database, "users")
        self.logger = Logger("UserService")
        
    async def get_user(self, user_id: int) -> Optional[User]:
        """Get user by ID."""
        try:
            return await self.repository.find_by_id(user_id)
        except Exception as e:
            self.logger.error(f"Error getting user {user_id}: {e}")
            return None
            
    async def create_user(self, name: str, email: str) -> Optional[User]:
        """Create new user."""
        try:
            user = User(id=0, name=name, email=email)  # ID will be assigned by database
            user_id = await self.repository.create(user)
            user.id = user_id
            
            self.logger.info(f"Created user: {user.name} ({user.email})")
            return user
            
        except ValueError as e:
            self.logger.error(f"Validation error creating user: {e}")
            return None
        except Exception as e:
            self.logger.error(f"Error creating user: {e}")
            return None
            
    async def update_user(self, user_id: int, updates: Dict[str, Any]) -> Optional[User]:
        """Update user."""
        try:
            # Validate email if being updated
            if "email" in updates and not validate_email(updates["email"]):
                raise ValueError(f"Invalid email: {updates['email']}")
                
            return await self.repository.update(user_id, updates)
            
        except ValueError as e:
            self.logger.error(f"Validation error updating user {user_id}: {e}")
            return None
        except Exception as e:
            self.logger.error(f"Error updating user {user_id}: {e}")
            return None
            
    async def delete_user(self, user_id: int) -> bool:
        """Delete user."""
        try:
            success = await self.repository.delete(user_id)
            if success:
                self.logger.info(f"Deleted user {user_id}")
            return success
            
        except Exception as e:
            self.logger.error(f"Error deleting user {user_id}: {e}")
            return False

# Function definition - decorator factory
def retry(max_attempts: int = 3, delay: float = 1.0, backoff: float = 2.0):
    """Decorator for retrying failed function calls."""
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            attempt = 1
            current_delay = delay
            
            while attempt <= max_attempts:
                try:
                    if asyncio.iscoroutinefunction(func):
                        return await func(*args, **kwargs)
                    else:
                        return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts:
                        raise e
                    
                    print(f"Attempt {attempt} failed: {e}. Retrying in {current_delay}s...")
                    await asyncio.sleep(current_delay)
                    
                    attempt += 1
                    current_delay *= backoff
            
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            attempt = 1
            current_delay = delay
            
            while attempt <= max_attempts:
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts:
                        raise e
                    
                    print(f"Attempt {attempt} failed: {e}. Retrying in {current_delay}s...")
                    time.sleep(current_delay)
                    
                    attempt += 1
                    current_delay *= backoff
        
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper
    return decorator

# Decorated definition - function with retry decorator
@retry(max_attempts=3, delay=0.5)
async def unreliable_api_call(endpoint: str) -> Dict[str, Any]:
    """Simulate an unreliable API call."""
    import random
    
    if random.random() < 0.7:  # 70% chance of failure
        raise Exception(f"API call to {endpoint} failed")
        
    return await fetch_data(endpoint)

# Function definition - main function for testing
async def main() -> None:
    """Main function to demonstrate all components."""
    # Test basic functions
    print(f"Factorial of 5: {calculate_factorial(5)}")
    print(f"Email valid: {validate_email('test@example.com')}")
    
    # Test expensive computation with caching/debouncing
    result1 = expensive_computation(100)
    result2 = expensive_computation(100)  # Should use cache
    print(f"Expensive computation results: {result1}, {result2}")
    
    # Test database and service
    db = MockDatabase("mock://localhost/test")
    db.connect()
    
    user_service = UserService(db)
    
    # Create user
    new_user = await user_service.create_user("John Doe", "john@example.com")
    if new_user:
        print(f"Created user: {new_user.to_dict()}")
    
    # Test batch fetching
    urls = ["http://api1.example.com", "http://api2.example.com"]
    batch_results = await batch_fetch(urls)
    print(f"Batch fetch results: {len(batch_results)} responses")
    
    # Test unreliable API with retry
    try:
        api_result = await unreliable_api_call("http://unreliable-api.com")
        print(f"API call succeeded: {api_result}")
    except Exception as e:
        print(f"API call failed after retries: {e}")
    
    db.disconnect()

# Function definition - entry point  
def run_main() -> None:
    """Synchronous entry point."""
    asyncio.run(main())

# Conditional execution
if __name__ == "__main__":
    run_main()