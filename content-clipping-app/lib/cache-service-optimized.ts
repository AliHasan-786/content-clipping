import Redis from 'ioredis';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';

// Compression utilities
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.npm_lifecycle_event === 'build'
  );
}

// Cache configuration interfaces
export interface CacheConfig {
  host?: string;
  port?: number;
  password?: string;
  keyPrefix?: string;
  maxMemory?: string;
  compression?: boolean;
  serialization?: 'json' | 'msgpack';
  enableMetrics?: boolean;
}

export interface CacheItem<T> {
  data: T;
  timestamp: number;
  ttl?: number;
  hits?: number;
  size?: number;
  compressed?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
  totalKeys: number;
  memoryUsage: number;
  averageKeySize: number;
  compression: {
    enabled: boolean;
    ratio: number;
    savedBytes: number;
  };
}

export interface CachePattern {
  pattern: string;
  ttl: number;
  priority: 'high' | 'medium' | 'low';
  compression?: boolean;
}

// Enhanced cache manager with advanced features
export class OptimizedCacheService extends EventEmitter {
  private redis: Redis;
  private config: CacheConfig;
  private metrics: CacheStats;
  private patterns: Map<string, CachePattern> = new Map();
  private compressionThreshold = 1024; // Compress items larger than 1KB
  
  constructor(config: CacheConfig = {}) {
    super();
    
    this.config = {
      host: config.host || process.env.REDIS_HOST || 'localhost',
      port: config.port || parseInt(process.env.REDIS_PORT || '6379'),
      password: config.password || process.env.REDIS_PASSWORD,
      keyPrefix: config.keyPrefix || 'clipmaster:cache:',
      maxMemory: config.maxMemory || '512mb',
      compression: config.compression !== false,
      serialization: config.serialization || 'json',
      enableMetrics: config.enableMetrics !== false,
    };

    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
      totalKeys: 0,
      memoryUsage: 0,
      averageKeySize: 0,
      compression: {
        enabled: this.config.compression!,
        ratio: 0,
        savedBytes: 0,
      },
    };

    this.initializeRedis();
    this.setupCachePatterns();
    this.startMetricsCollection();
  }

  private initializeRedis() {
    const redisConfig = {
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      keyPrefix: this.config.keyPrefix,
      retryDelayOnFailover: 100,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      // Memory optimization
      maxMemoryPolicy: 'allkeys-lru',
      keepAlive: true,
      connectTimeout: 10000,
      commandTimeout: 5000,
      // Compression and serialization
      enableAutoPipelining: true,
    };

    this.redis = new Redis(redisConfig);

    // Event handlers
    this.redis.on('connect', () => {
      this.emit('connected');
      console.log('Cache service connected to Redis');

      if (!isBuildPhase()) {
        this.redis.config('SET', 'maxmemory', this.config.maxMemory!).catch(() => undefined);
        this.redis.config('SET', 'maxmemory-policy', 'allkeys-lru').catch(() => undefined);
      }
    });

    this.redis.on('error', (error) => {
      this.emit('error', error);
      console.error('Cache service Redis error:', error);
    });

    this.redis.on('reconnecting', () => {
      this.emit('reconnecting');
      console.log('Cache service reconnecting to Redis');
    });
  }

  private setupCachePatterns() {
    const patterns: CachePattern[] = [
      // Video processing patterns
      { pattern: 'video:metadata:*', ttl: 24 * 60 * 60, priority: 'high', compression: false },
      { pattern: 'video:thumbnail:*', ttl: 7 * 24 * 60 * 60, priority: 'medium', compression: true },
      { pattern: 'transcription:*', ttl: 7 * 24 * 60 * 60, priority: 'high', compression: true },
      { pattern: 'clips:*', ttl: 3 * 24 * 60 * 60, priority: 'medium', compression: true },
      
      // API and processing patterns
      { pattern: 'api:response:*', ttl: 5 * 60, priority: 'low', compression: false },
      { pattern: 'processing:status:*', ttl: 10 * 60, priority: 'high', compression: false },
      { pattern: 'user:session:*', ttl: 60 * 60, priority: 'medium', compression: false },
      
      // File and media patterns
      { pattern: 'file:metadata:*', ttl: 60 * 60, priority: 'medium', compression: false },
      { pattern: 'media:optimized:*', ttl: 24 * 60 * 60, priority: 'low', compression: true },
      
      // Analytics and metrics
      { pattern: 'analytics:*', ttl: 60 * 60, priority: 'low', compression: true },
      { pattern: 'metrics:*', ttl: 5 * 60, priority: 'low', compression: false },
    ];

    patterns.forEach(pattern => {
      this.patterns.set(pattern.pattern, pattern);
    });
  }

  private startMetricsCollection() {
    if (isBuildPhase()) return;
    if (!this.config.enableMetrics) return;

    setInterval(async () => {
      await this.updateMetrics();
      this.emit('metrics', this.metrics);
    }, 30000); // Update every 30 seconds
  }

  /**
   * Get item from cache with automatic decompression and metrics
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const fullKey = this.buildKey(key);
      const rawData = await this.redis.get(fullKey);
      
      if (!rawData) {
        this.metrics.misses++;
        return null;
      }

      this.metrics.hits++;
      
      // Parse the cached item
      const item: CacheItem<any> = JSON.parse(rawData);
      
      let data = item.data;
      
      // Decompress if needed
      if (item.compressed && typeof data === 'string') {
        const buffer = Buffer.from(data, 'base64');
        const decompressed = await gunzip(buffer);
        data = JSON.parse(decompressed.toString());
      }
      
      // Update hit count
      if (typeof item.hits === 'number') {
        item.hits++;
        await this.redis.set(fullKey, JSON.stringify(item), 'KEEPTTL');
      }
      
      return data as T;
    } catch (error) {
      console.error('Cache get error:', error);
      this.metrics.misses++;
      return null;
    }
  }

  /**
   * Set item in cache with automatic compression and TTL
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const fullKey = this.buildKey(key);
      const pattern = this.getPatternForKey(key);
      const finalTtl = ttl || pattern?.ttl || 3600; // Default 1 hour
      
      let data = value;
      let compressed = false;
      let originalSize = 0;
      let finalSize = 0;
      
      // Serialize the data
      const serialized = JSON.stringify(value);
      originalSize = Buffer.byteLength(serialized, 'utf8');
      
      // Compress if beneficial and enabled
      if (this.config.compression && 
          (pattern?.compression !== false) &&
          originalSize > this.compressionThreshold) {
        
        try {
          const buffer = await gzip(serialized);
          const compressedData = buffer.toString('base64');
          finalSize = Buffer.byteLength(compressedData, 'utf8');
          
          // Only use compression if it actually saves space
          if (finalSize < originalSize * 0.8) {
            data = compressedData as any;
            compressed = true;
            this.metrics.compression.savedBytes += (originalSize - finalSize);
          }
        } catch (compressionError) {
          console.warn('Compression failed, storing uncompressed:', compressionError);
        }
      }
      
      if (!compressed) {
        finalSize = originalSize;
      }
      
      const item: CacheItem<T> = {
        data,
        timestamp: Date.now(),
        ttl: finalTtl,
        hits: 0,
        size: finalSize,
        compressed,
      };
      
      await this.redis.setex(fullKey, finalTtl, JSON.stringify(item));
      this.metrics.sets++;
      
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  /**
   * Delete item from cache
   */
  async delete(key: string): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key);
      const result = await this.redis.del(fullKey);
      
      if (result > 0) {
        this.metrics.deletes++;
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  /**
   * Get multiple items efficiently
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    
    try {
      const fullKeys = keys.map(key => this.buildKey(key));
      const pipeline = this.redis.pipeline();
      
      fullKeys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      
      if (!results) return keys.map(() => null);
      
      return Promise.all(results.map(async (result, index) => {
        if (result && result[1]) {
          this.metrics.hits++;
          const item: CacheItem<any> = JSON.parse(result[1] as string);
          
          let data = item.data;
          if (item.compressed && typeof data === 'string') {
            const buffer = Buffer.from(data, 'base64');
            const decompressed = await gunzip(buffer);
            data = JSON.parse(decompressed.toString());
          }
          
          return data as T;
        } else {
          this.metrics.misses++;
          return null;
        }
      }));
    } catch (error) {
      console.error('Cache mget error:', error);
      this.metrics.misses += keys.length;
      return keys.map(() => null);
    }
  }

  /**
   * Set multiple items efficiently
   */
  async mset<T>(items: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    if (items.length === 0) return;
    
    try {
      const pipeline = this.redis.pipeline();
      
      for (const item of items) {
        const fullKey = this.buildKey(item.key);
        const pattern = this.getPatternForKey(item.key);
        const finalTtl = item.ttl || pattern?.ttl || 3600;
        
        let data = item.value;
        let compressed = false;
        
        // Handle compression for batch operations
        const serialized = JSON.stringify(item.value);
        const originalSize = Buffer.byteLength(serialized, 'utf8');
        
        if (this.config.compression && 
            (pattern?.compression !== false) &&
            originalSize > this.compressionThreshold) {
          
          try {
            const buffer = await gzip(serialized);
            const compressedData = buffer.toString('base64');
            const finalSize = Buffer.byteLength(compressedData, 'utf8');
            
            if (finalSize < originalSize * 0.8) {
              data = compressedData as any;
              compressed = true;
            }
          } catch (compressionError) {
            // Continue with uncompressed data
          }
        }
        
        const cacheItem: CacheItem<T> = {
          data,
          timestamp: Date.now(),
          ttl: finalTtl,
          hits: 0,
          size: Buffer.byteLength(JSON.stringify(data), 'utf8'),
          compressed,
        };
        
        pipeline.setex(fullKey, finalTtl, JSON.stringify(cacheItem));
      }
      
      await pipeline.exec();
      this.metrics.sets += items.length;
      
    } catch (error) {
      console.error('Cache mset error:', error);
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key);
      const result = await this.redis.exists(fullKey);
      return result === 1;
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  }

  /**
   * Get TTL for a key
   */
  async ttl(key: string): Promise<number> {
    try {
      const fullKey = this.buildKey(key);
      return await this.redis.ttl(fullKey);
    } catch (error) {
      console.error('Cache TTL error:', error);
      return -1;
    }
  }

  /**
   * Extend TTL for a key
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key);
      const result = await this.redis.expire(fullKey, ttl);
      return result === 1;
    } catch (error) {
      console.error('Cache expire error:', error);
      return false;
    }
  }

  /**
   * Get keys matching pattern
   */
  async keys(pattern: string): Promise<string[]> {
    try {
      const fullPattern = this.buildKey(pattern);
      const keys = await this.redis.keys(fullPattern);
      return keys.map(key => key.replace(this.config.keyPrefix!, ''));
    } catch (error) {
      console.error('Cache keys error:', error);
      return [];
    }
  }

  /**
   * Delete keys matching pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    try {
      const keys = await this.keys(pattern);
      if (keys.length === 0) return 0;
      
      const fullKeys = keys.map(key => this.buildKey(key));
      const result = await this.redis.del(...fullKeys);
      
      this.metrics.deletes += result;
      return result;
    } catch (error) {
      console.error('Cache deletePattern error:', error);
      return 0;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    let totalDeleted = 0;
    
    for (const tag of tags) {
      const pattern = `*:${tag}:*`;
      const deleted = await this.deletePattern(pattern);
      totalDeleted += deleted;
    }
    
    return totalDeleted;
  }

  /**
   * Cache warming for frequently accessed data
   */
  async warmCache(warmupData: Array<{ key: string; loader: () => Promise<any>; ttl?: number }>): Promise<void> {
    const pipeline = this.redis.pipeline();
    const loadPromises: Promise<any>[] = [];
    
    for (const item of warmupData) {
      const exists = await this.exists(item.key);
      if (!exists) {
        loadPromises.push(
          item.loader().then(data => {
            return { key: item.key, value: data, ttl: item.ttl };
          }).catch(error => {
            console.warn(`Cache warmup failed for ${item.key}:`, error);
            return null;
          })
        );
      }
    }
    
    const results = await Promise.allSettled(loadPromises);
    const successfulWarmups = results
      .filter((result): result is PromiseFulfilledResult<any> => 
        result.status === 'fulfilled' && result.value !== null
      )
      .map(result => result.value);
    
    if (successfulWarmups.length > 0) {
      await this.mset(successfulWarmups);
      console.log(`Cache warmed with ${successfulWarmups.length} items`);
    }
  }

  /**
   * Get comprehensive cache statistics
   */
  async getStats(): Promise<CacheStats> {
    if (!isBuildPhase()) {
      await this.updateMetrics();
    }
    return { ...this.metrics };
  }

  /**
   * Get cache health information
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'warning' | 'error';
    uptime: number;
    memoryUsage: number;
    hitRate: number;
    keyCount: number;
    issues: string[];
  }> {
    if (isBuildPhase()) {
      return {
        status: 'warning',
        uptime: 0,
        memoryUsage: 0,
        hitRate: this.metrics.hitRate,
        keyCount: this.metrics.totalKeys,
        issues: ['Redis health checks are skipped during build'],
      };
    }

    const issues: string[] = [];
    let status: 'healthy' | 'warning' | 'error' = 'healthy';
    
    try {
      const info = await this.redis.info();
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const uptimeMatch = info.match(/uptime_in_seconds:(\d+)/);
      
      const memoryUsage = memoryMatch ? parseInt(memoryMatch[1], 10) : 0;
      const uptime = uptimeMatch ? parseInt(uptimeMatch[1], 10) : 0;
      
      // Check memory usage
      if (memoryUsage > 1024 * 1024 * 500) { // 500MB
        issues.push('High memory usage detected');
        status = 'warning';
      }
      
      // Check hit rate
      if (this.metrics.hitRate < 0.7) {
        issues.push('Low cache hit rate');
        if (status !== 'error') status = 'warning';
      }
      
      // Check connectivity
      const ping = await this.redis.ping();
      if (ping !== 'PONG') {
        issues.push('Redis connectivity issues');
        status = 'error';
      }
      
      return {
        status,
        uptime,
        memoryUsage,
        hitRate: this.metrics.hitRate,
        keyCount: this.metrics.totalKeys,
        issues,
      };
      
    } catch (error) {
      return {
        status: 'error',
        uptime: 0,
        memoryUsage: 0,
        hitRate: 0,
        keyCount: 0,
        issues: [`Cache service error: ${error.message}`],
      };
    }
  }

  /**
   * Optimize cache by removing least used items
   */
  async optimize(): Promise<{ removedKeys: number; freedMemory: number }> {
    try {
      // Get memory info
      const info = await this.redis.info('memory');
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const initialMemory = memoryMatch ? parseInt(memoryMatch[1], 10) : 0;
      
      // Clean up expired keys
      await this.redis.eval(`
        local keys = redis.call('KEYS', ARGV[1])
        local removed = 0
        for i=1,#keys do
          if redis.call('TTL', keys[i]) == -1 then
            redis.call('DEL', keys[i])
            removed = removed + 1
          end
        end
        return removed
      `, 0, `${this.config.keyPrefix}*`);
      
      // Get final memory usage
      const finalInfo = await this.redis.info('memory');
      const finalMemoryMatch = finalInfo.match(/used_memory:(\d+)/);
      const finalMemory = finalMemoryMatch ? parseInt(finalMemoryMatch[1], 10) : 0;
      
      const freedMemory = initialMemory - finalMemory;
      
      return {
        removedKeys: 0, // Would need more complex tracking for exact count
        freedMemory,
      };
      
    } catch (error) {
      console.error('Cache optimization error:', error);
      return { removedKeys: 0, freedMemory: 0 };
    }
  }

  /**
   * Flush all cache data
   */
  async flush(): Promise<void> {
    try {
      await this.redis.flushdb();
      this.resetMetrics();
    } catch (error) {
      console.error('Cache flush error:', error);
    }
  }

  /**
   * Close the cache connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }

  // Private helper methods

  private buildKey(key: string): string {
    return `${this.config.keyPrefix}${key}`;
  }

  private getPatternForKey(key: string): CachePattern | undefined {
    for (const [pattern, config] of this.patterns) {
      const regex = new RegExp(pattern.replace('*', '.*'));
      if (regex.test(key)) {
        return config;
      }
    }
    return undefined;
  }

  private async updateMetrics(): Promise<void> {
    if (isBuildPhase()) return;

    try {
      const info = await this.redis.info('stats');
      const keyspaceInfo = await this.redis.info('keyspace');
      
      // Parse keyspace info for total keys
      const keyspaceMatch = keyspaceInfo.match(/keys=(\d+)/);
      this.metrics.totalKeys = keyspaceMatch ? parseInt(keyspaceMatch[1], 10) : 0;
      
      // Calculate hit rate
      const totalRequests = this.metrics.hits + this.metrics.misses;
      this.metrics.hitRate = totalRequests > 0 ? this.metrics.hits / totalRequests : 0;
      
      // Get memory usage
      const memoryInfo = await this.redis.info('memory');
      const memoryMatch = memoryInfo.match(/used_memory:(\d+)/);
      this.metrics.memoryUsage = memoryMatch ? parseInt(memoryMatch[1], 10) : 0;
      
      // Calculate average key size
      if (this.metrics.totalKeys > 0) {
        this.metrics.averageKeySize = this.metrics.memoryUsage / this.metrics.totalKeys;
      }
      
      // Update compression ratio
      if (this.metrics.compression.savedBytes > 0) {
        // This is a simplified calculation
        this.metrics.compression.ratio = this.metrics.compression.savedBytes / this.metrics.memoryUsage;
      }
      
    } catch (error) {
      console.error('Error updating cache metrics:', error);
    }
  }

  private resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
      totalKeys: 0,
      memoryUsage: 0,
      averageKeySize: 0,
      compression: {
        enabled: this.config.compression!,
        ratio: 0,
        savedBytes: 0,
      },
    };
  }
}

// Cache middleware for frequently accessed data
export class CacheMiddleware {
  constructor(private cache: OptimizedCacheService) {}

  /**
   * Wrap a function with caching
   */
  wrap<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: {
      keyGenerator: (...args: Parameters<T>) => string;
      ttl?: number;
      compression?: boolean;
    }
  ): T {
    return (async (...args: Parameters<T>) => {
      const key = options.keyGenerator(...args);
      
      // Try to get from cache first
      let result = await this.cache.get(key);
      
      if (result === null) {
        // Execute the original function
        result = await fn(...args);
        
        // Cache the result
        await this.cache.set(key, result, options.ttl);
      }
      
      return result;
    }) as T;
  }

  /**
   * Cache with automatic invalidation on data changes
   */
  async cacheWithInvalidation<T>(
    key: string,
    loader: () => Promise<T>,
    dependencies: string[],
    ttl?: number
  ): Promise<T> {
    // Check if any dependencies have changed
    const dependencyKeys = dependencies.map(dep => `dependency:${dep}`);
    const dependencyTimestamps = await this.cache.mget<number>(dependencyKeys);
    
    let result = await this.cache.get<{ data: T; dependencies: number[] }>(key);
    
    // Check if cache is valid
    const isValid = result && 
      dependencyTimestamps.every((timestamp, index) => 
        timestamp === null || result!.dependencies[index] >= timestamp
      );
    
    if (!isValid) {
      const data = await loader();
      const currentTime = Date.now();
      
      result = {
        data,
        dependencies: dependencyTimestamps.map(ts => ts || currentTime),
      };
      
      await this.cache.set(key, result, ttl);
    }
    
    return result.data;
  }

  /**
   * Invalidate cache by marking dependencies as changed
   */
  async invalidateDependency(dependency: string): Promise<void> {
    const key = `dependency:${dependency}`;
    await this.cache.set(key, Date.now(), 24 * 60 * 60); // 24 hours TTL
  }
}

// Default cache instance
export const optimizedCache = new OptimizedCacheService();
export const cacheMiddleware = new CacheMiddleware(optimizedCache);
