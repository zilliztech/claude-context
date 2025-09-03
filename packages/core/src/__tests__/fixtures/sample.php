<?php

namespace App\TestSuite\Database;

use Exception;
use InvalidArgumentException;

/**
 * Sample PHP file with all AST splitter features
 * This file contains all node types that the AST splitter recognizes for PHP:
 * - class_declaration
 * - method_declaration  
 * - function_definition
 * - interface_declaration
 * - trait_declaration
 * - namespace_definition
 * - enum_declaration
 */

// Standalone function definition
function calculateSum(array $numbers): int 
{
    $sum = 0;
    foreach ($numbers as $number) {
        $sum += $number;
    }
    return $sum;
}

// Another standalone function with different signature
function validateEmail(string $email): bool
{
    return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

// Interface declaration
interface DatabaseConnectionInterface
{
    public function connect(): bool;
    public function disconnect(): void;
    public function query(string $sql, array $params = []): array;
    public function beginTransaction(): bool;
    public function commit(): bool;
    public function rollback(): bool;
}

// Another interface declaration
interface CacheInterface 
{
    public function get(string $key): mixed;
    public function set(string $key, mixed $value, int $ttl = 3600): bool;
    public function delete(string $key): bool;
    public function clear(): bool;
}

// Trait declaration
trait LoggableTrait
{
    private array $logs = [];

    protected function log(string $message, string $level = 'info'): void
    {
        $this->logs[] = [
            'timestamp' => date('Y-m-d H:i:s'),
            'level' => $level,
            'message' => $message
        ];
    }

    protected function getLogs(): array
    {
        return $this->logs;
    }

    protected function clearLogs(): void
    {
        $this->logs = [];
    }
}

// Another trait declaration
trait ValidatorTrait
{
    protected function validateRequired(mixed $value, string $fieldName): void
    {
        if (empty($value)) {
            throw new InvalidArgumentException("Field '{$fieldName}' is required");
        }
    }

    protected function validateLength(string $value, int $minLength, int $maxLength, string $fieldName): void
    {
        $length = strlen($value);
        if ($length < $minLength || $length > $maxLength) {
            throw new InvalidArgumentException("Field '{$fieldName}' length must be between {$minLength} and {$maxLength}");
        }
    }
}

// Enum declaration (PHP 8.1+)
enum DatabaseType: string
{
    case MYSQL = 'mysql';
    case POSTGRESQL = 'postgresql';
    case SQLITE = 'sqlite';
    case MONGODB = 'mongodb';

    public function getDefaultPort(): int
    {
        return match($this) {
            self::MYSQL => 3306,
            self::POSTGRESQL => 5432,
            self::SQLITE => 0, // File-based
            self::MONGODB => 27017,
        };
    }

    public function requiresCredentials(): bool
    {
        return $this !== self::SQLITE;
    }
}

// Another enum declaration
enum UserStatus: int
{
    case INACTIVE = 0;
    case ACTIVE = 1;
    case SUSPENDED = 2;
    case BANNED = 3;

    public function getLabel(): string
    {
        return match($this) {
            self::INACTIVE => 'Inactive',
            self::ACTIVE => 'Active', 
            self::SUSPENDED => 'Suspended',
            self::BANNED => 'Banned',
        };
    }
}

// Class declaration implementing interface and using traits
class DatabaseManager implements DatabaseConnectionInterface
{
    use LoggableTrait, ValidatorTrait;

    private string $host;
    private int $port;
    private string $database;
    private string $username;
    private string $password;
    private DatabaseType $type;
    private ?object $connection = null;

    // Constructor method
    public function __construct(
        string $host,
        string $database,
        string $username,
        string $password,
        DatabaseType $type,
        ?int $port = null
    ) {
        $this->validateRequired($host, 'host');
        $this->validateRequired($database, 'database');
        $this->validateRequired($username, 'username');
        
        $this->host = $host;
        $this->database = $database;
        $this->username = $username;
        $this->password = $password;
        $this->type = $type;
        $this->port = $port ?? $type->getDefaultPort();
        
        $this->log("DatabaseManager initialized for {$type->value}", 'info');
    }

    // Public method declaration
    public function connect(): bool
    {
        try {
            $this->log("Attempting to connect to {$this->type->value} database", 'info');
            
            // Simulate connection logic
            $dsn = $this->buildDsn();
            $this->connection = new \stdClass(); // Mock connection
            
            $this->log("Successfully connected to database", 'info');
            return true;
        } catch (Exception $e) {
            $this->log("Connection failed: " . $e->getMessage(), 'error');
            return false;
        }
    }

    // Public method declaration
    public function disconnect(): void
    {
        if ($this->connection) {
            $this->connection = null;
            $this->log("Disconnected from database", 'info');
        }
    }

    // Public method declaration with complex signature
    public function query(string $sql, array $params = []): array
    {
        $this->validateRequired($sql, 'sql');
        
        if (!$this->connection) {
            throw new Exception("Not connected to database");
        }

        $this->log("Executing query: {$sql}", 'debug');
        
        // Mock query execution
        return [
            'query' => $sql,
            'params' => $params,
            'results' => [],
            'affected_rows' => 0
        ];
    }

    // Public method declaration
    public function beginTransaction(): bool
    {
        $this->log("Starting transaction", 'debug');
        return true;
    }

    // Public method declaration  
    public function commit(): bool
    {
        $this->log("Committing transaction", 'debug');
        return true;
    }

    // Public method declaration
    public function rollback(): bool
    {
        $this->log("Rolling back transaction", 'debug');
        return true;
    }

    // Private method declaration
    private function buildDsn(): string
    {
        return match($this->type) {
            DatabaseType::MYSQL => "mysql:host={$this->host};port={$this->port};dbname={$this->database}",
            DatabaseType::POSTGRESQL => "pgsql:host={$this->host};port={$this->port};dbname={$this->database}",
            DatabaseType::SQLITE => "sqlite:{$this->database}",
            DatabaseType::MONGODB => "mongodb://{$this->host}:{$this->port}/{$this->database}",
        };
    }

    // Protected method declaration
    protected function validateConnection(): void
    {
        if (!$this->connection) {
            throw new Exception("Database connection not established");
        }
    }

    // Static method declaration
    public static function createFromConfig(array $config): self
    {
        $type = DatabaseType::from($config['type'] ?? 'mysql');
        
        return new self(
            $config['host'] ?? 'localhost',
            $config['database'] ?? '',
            $config['username'] ?? '',
            $config['password'] ?? '',
            $type,
            $config['port'] ?? null
        );
    }

    // Getter method declarations
    public function getHost(): string { return $this->host; }
    public function getPort(): int { return $this->port; }
    public function getDatabase(): string { return $this->database; }
    public function getType(): DatabaseType { return $this->type; }
    public function isConnected(): bool { return $this->connection !== null; }
}

// Another class declaration extending previous class
class AdvancedDatabaseManager extends DatabaseManager
{
    private array $queryCache = [];
    private int $cacheSize = 100;

    // Method declaration overriding parent
    public function query(string $sql, array $params = []): array
    {
        $cacheKey = $this->generateCacheKey($sql, $params);
        
        // Check cache first
        if (isset($this->queryCache[$cacheKey])) {
            $this->log("Cache hit for query: {$sql}", 'debug');
            return $this->queryCache[$cacheKey];
        }

        // Execute query via parent
        $result = parent::query($sql, $params);
        
        // Cache result
        $this->cacheResult($cacheKey, $result);
        
        return $result;
    }

    // Private method declaration for caching
    private function generateCacheKey(string $sql, array $params): string
    {
        return md5($sql . serialize($params));
    }

    // Private method declaration for cache management  
    private function cacheResult(string $key, array $result): void
    {
        if (count($this->queryCache) >= $this->cacheSize) {
            // Remove oldest entry
            array_shift($this->queryCache);
        }
        
        $this->queryCache[$key] = $result;
        $this->log("Cached query result", 'debug');
    }

    // Public method declaration
    public function clearCache(): void
    {
        $count = count($this->queryCache);
        $this->queryCache = [];
        $this->log("Cleared {$count} cached queries", 'info');
    }
}

// Final class declaration with static methods
final class DatabaseFactory
{
    private static array $instances = [];

    // Private constructor to prevent instantiation
    private function __construct() {}

    // Static factory method declaration
    public static function create(string $name, array $config): DatabaseManager
    {
        if (isset(self::$instances[$name])) {
            return self::$instances[$name];
        }

        $manager = DatabaseManager::createFromConfig($config);
        self::$instances[$name] = $manager;
        
        return $manager;
    }

    // Static method declaration  
    public static function get(string $name): ?DatabaseManager
    {
        return self::$instances[$name] ?? null;
    }

    // Static method declaration
    public static function remove(string $name): bool
    {
        if (isset(self::$instances[$name])) {
            self::$instances[$name]->disconnect();
            unset(self::$instances[$name]);
            return true;
        }
        
        return false;
    }

    // Static method declaration
    public static function getActiveConnections(): array
    {
        return array_keys(self::$instances);
    }
}

// Abstract class declaration
abstract class BaseRepository
{
    protected DatabaseManager $db;
    protected string $tableName;

    public function __construct(DatabaseManager $db, string $tableName)
    {
        $this->db = $db;
        $this->tableName = $tableName;
    }

    // Abstract method declaration
    abstract public function findById(int $id): ?array;
    abstract public function create(array $data): int;
    abstract public function update(int $id, array $data): bool;
    abstract public function delete(int $id): bool;

    // Concrete method declaration
    protected function buildSelectQuery(array $conditions = []): string
    {
        $sql = "SELECT * FROM {$this->tableName}";
        
        if (!empty($conditions)) {
            $where = [];
            foreach ($conditions as $field => $value) {
                $where[] = "{$field} = ?";
            }
            $sql .= " WHERE " . implode(" AND ", $where);
        }
        
        return $sql;
    }
}

namespace App\TestSuite\Models;

// Class declaration in different namespace
class UserModel extends \App\TestSuite\Database\BaseRepository
{
    public function __construct(\App\TestSuite\Database\DatabaseManager $db)
    {
        parent::__construct($db, 'users');
    }

    // Implementation of abstract method
    public function findById(int $id): ?array
    {
        $sql = $this->buildSelectQuery(['id' => $id]);
        $result = $this->db->query($sql, [$id]);
        return $result['results'][0] ?? null;
    }

    // Implementation of abstract method
    public function create(array $data): int
    {
        $fields = array_keys($data);
        $placeholders = array_fill(0, count($fields), '?');
        
        $sql = "INSERT INTO {$this->tableName} (" . implode(', ', $fields) . ") VALUES (" . implode(', ', $placeholders) . ")";
        $this->db->query($sql, array_values($data));
        
        return 1; // Mock ID
    }

    // Implementation of abstract method
    public function update(int $id, array $data): bool
    {
        $sets = [];
        foreach ($data as $field => $value) {
            $sets[] = "{$field} = ?";
        }
        
        $sql = "UPDATE {$this->tableName} SET " . implode(', ', $sets) . " WHERE id = ?";
        $params = array_merge(array_values($data), [$id]);
        
        $this->db->query($sql, $params);
        return true;
    }

    // Implementation of abstract method
    public function delete(int $id): bool
    {
        $sql = "DELETE FROM {$this->tableName} WHERE id = ?";
        $this->db->query($sql, [$id]);
        return true;
    }

    // Additional method specific to user model
    public function findByEmail(string $email): ?array
    {
        $sql = $this->buildSelectQuery(['email' => $email]);
        $result = $this->db->query($sql, [$email]);
        return $result['results'][0] ?? null;
    }
}

// Final standalone function
function main(): void 
{
    // Test all the components
    $config = [
        'type' => 'mysql',
        'host' => 'localhost',
        'database' => 'test_db',
        'username' => 'user',
        'password' => 'pass'
    ];
    
    $db = DatabaseFactory::create('main', $config);
    $db->connect();
    
    $userModel = new \App\TestSuite\Models\UserModel($db);
    $userData = [
        'name' => 'John Doe',
        'email' => 'john@example.com',
        'status' => UserStatus::ACTIVE->value
    ];
    
    $userId = $userModel->create($userData);
    echo "Created user with ID: {$userId}\n";
    
    $db->disconnect();
}