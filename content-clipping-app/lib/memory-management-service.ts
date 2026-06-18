import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { optimizedCache } from './cache-service-optimized';

// Memory management interfaces
export interface MemoryStats {
  total: number;
  free: number;
  used: number;
  usagePercent: number;
  threshold: number;
  available: number;
}

export interface FileHandle {
  id: string;
  path: string;
  size: number;
  lastAccessed: Date;
  locked: boolean;
  priority: 'low' | 'medium' | 'high' | 'critical';
  references: number;
  metadata?: any;
}

export interface StreamConfig {
  highWaterMark: number;
  chunkSize: number;
  maxConcurrentStreams: number;
  enableCache: boolean;
  compressionLevel?: number;
}

export interface MemoryPool {
  size: number;
  used: number;
  available: number;
  chunks: Map<string, Buffer>;
  maxChunkSize: number;
}

export interface GarbageCollectionStats {
  runs: number;
  freedMemory: number;
  filesReleased: number;
  lastRun: Date;
  averageRunTime: number;
}

// Memory management service for large video files
export class MemoryManagementService extends EventEmitter {
  private memoryThreshold = 0.85; // 85% memory usage threshold
  private maxFileHandles = 100;
  private fileHandles = new Map<string, FileHandle>();
  private activeStreams = new Map<string, NodeJS.ReadableStream>();
  private memoryPool: MemoryPool;
  private gcStats: GarbageCollectionStats;
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private streamConfig: StreamConfig;

  constructor(options: {
    memoryThreshold?: number;
    maxFileHandles?: number;
    poolSize?: number;
    streamConfig?: Partial<StreamConfig>;
  } = {}) {
    super();

    this.memoryThreshold = options.memoryThreshold || 0.85;
    this.maxFileHandles = options.maxFileHandles || 100;

    this.streamConfig = {
      highWaterMark: 64 * 1024, // 64KB
      chunkSize: 1024 * 1024,   // 1MB
      maxConcurrentStreams: Math.max(2, Math.floor(os.cpus().length / 2)),
      enableCache: true,
      compressionLevel: 6,
      ...options.streamConfig,
    };

    this.memoryPool = {
      size: options.poolSize || 100 * 1024 * 1024, // 100MB default
      used: 0,
      available: options.poolSize || 100 * 1024 * 1024,
      chunks: new Map(),
      maxChunkSize: 10 * 1024 * 1024, // 10MB max chunk
    };

    this.gcStats = {
      runs: 0,
      freedMemory: 0,
      filesReleased: 0,
      lastRun: new Date(),
      averageRunTime: 0,
    };

    this.startMemoryMonitoring();
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring() {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(async () => {
      const memStats = this.getMemoryStats();
      this.emit('memoryStats', memStats);

      if (memStats.usagePercent > this.memoryThreshold) {
        this.emit('memoryThresholdExceeded', memStats);
        await this.triggerGarbageCollection();
      }

      // Clean up stale file handles
      await this.cleanupStaleHandles();
      
      // Optimize memory pool
      this.optimizeMemoryPool();

    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop memory monitoring
   */
  stopMemoryMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.isMonitoring = false;
    }
  }

  /**
   * Get current memory statistics
   */
  getMemoryStats(): MemoryStats {
    const processMemory = process.memoryUsage();
    const systemTotal = os.totalmem();
    const systemFree = os.freemem();
    const systemUsed = systemTotal - systemFree;

    return {
      total: systemTotal,
      free: systemFree,
      used: systemUsed,
      usagePercent: (systemUsed / systemTotal) * 100,
      threshold: this.memoryThreshold * 100,
      available: systemFree - (processMemory.heapUsed + processMemory.external),
    };
  }

  /**
   * Create a memory-efficient file stream for large video files
   */
  async createVideoStream(filePath: string, options: {
    priority?: 'low' | 'medium' | 'high' | 'critical';
    enableCache?: boolean;
    chunkSize?: number;
  } = {}): Promise<{
    stream: NodeJS.ReadableStream;
    handle: FileHandle;
    cleanup: () => Promise<void>;
  }> {
    const fileId = this.generateFileId(filePath);
    const fileStats = await fs.stat(filePath);

    // Check if file is too large for current memory state
    const memStats = this.getMemoryStats();
    if (fileStats.size > memStats.available) {
      throw new Error(`File too large for available memory: ${fileStats.size} bytes, available: ${memStats.available} bytes`);
    }

    // Create file handle
    const handle: FileHandle = {
      id: fileId,
      path: filePath,
      size: fileStats.size,
      lastAccessed: new Date(),
      locked: true,
      priority: options.priority || 'medium',
      references: 1,
      metadata: {
        mimeType: this.getMimeType(filePath),
        isVideo: this.isVideoFile(filePath),
        createdAt: new Date(),
      },
    };

    this.fileHandles.set(fileId, handle);

    // Create optimized readable stream
    const stream = await this.createOptimizedStream(filePath, {
      chunkSize: options.chunkSize || this.streamConfig.chunkSize,
      enableCache: options.enableCache !== false,
      priority: handle.priority,
    });

    this.activeStreams.set(fileId, stream);

    // Cleanup function
    const cleanup = async () => {
      await this.releaseFileHandle(fileId);
    };

    this.emit('streamCreated', { fileId, filePath, size: fileStats.size });

    return { stream, handle, cleanup };
  }

  /**
   * Create an optimized stream with memory management
   */
  private async createOptimizedStream(filePath: string, options: {
    chunkSize: number;
    enableCache: boolean;
    priority: string;
  }): Promise<NodeJS.ReadableStream> {
    const fs = require('fs');
    const { Readable } = require('stream');

    return new Promise((resolve, reject) => {
      try {
        const stream = fs.createReadStream(filePath, {
          highWaterMark: this.streamConfig.highWaterMark,
        });

        // Add memory monitoring to stream
        let bytesRead = 0;
        const originalRead = stream._read;
        
        stream._read = (size: number) => {
          // Check memory before reading
          const memStats = this.getMemoryStats();
          if (memStats.usagePercent > this.memoryThreshold) {
            this.emit('memoryWarning', 'Stream paused due to high memory usage');
            stream.pause();
            
            // Resume after garbage collection
            this.triggerGarbageCollection().then(() => {
              stream.resume();
            });
          }

          return originalRead.call(stream, size);
        };

        stream.on('data', (chunk: Buffer) => {
          bytesRead += chunk.length;
          
          // Cache chunks if enabled and within limits
          if (options.enableCache && chunk.length <= this.memoryPool.maxChunkSize) {
            this.cacheChunk(filePath, bytesRead, chunk);
          }
          
          this.emit('streamProgress', { filePath, bytesRead, total: bytesRead });
        });

        stream.on('error', (error: Error) => {
          this.emit('streamError', { filePath, error: error.message });
          reject(error);
        });

        stream.on('end', () => {
          this.emit('streamComplete', { filePath, totalBytes: bytesRead });
        });

        resolve(stream);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Cache a chunk in memory pool
   */
  private cacheChunk(filePath: string, offset: number, chunk: Buffer): boolean {
    const chunkKey = `${this.generateFileId(filePath)}:${offset}`;
    
    if (this.memoryPool.used + chunk.length > this.memoryPool.size) {
      // Evict least recently used chunks
      this.evictLRUChunks(chunk.length);
    }

    if (this.memoryPool.available >= chunk.length) {
      this.memoryPool.chunks.set(chunkKey, chunk);
      this.memoryPool.used += chunk.length;
      this.memoryPool.available -= chunk.length;
      return true;
    }

    return false;
  }

  /**
   * Evict least recently used chunks from memory pool
   */
  private evictLRUChunks(requiredSpace: number): number {
    let freedSpace = 0;
    const chunks = Array.from(this.memoryPool.chunks.entries())
      .sort(([a], [b]) => {
        const fileA = this.fileHandles.get(a.split(':')[0]);
        const fileB = this.fileHandles.get(b.split(':')[0]);
        
        if (!fileA || !fileB) return 0;
        
        return fileA.lastAccessed.getTime() - fileB.lastAccessed.getTime();
      });

    for (const [chunkKey, chunk] of chunks) {
      if (freedSpace >= requiredSpace) break;

      this.memoryPool.chunks.delete(chunkKey);
      this.memoryPool.used -= chunk.length;
      this.memoryPool.available += chunk.length;
      freedSpace += chunk.length;
    }

    return freedSpace;
  }

  /**
   * Release a file handle
   */
  async releaseFileHandle(fileId: string): Promise<boolean> {
    const handle = this.fileHandles.get(fileId);
    if (!handle) return false;

    handle.references--;
    
    if (handle.references <= 0) {
      // Remove from active streams
      const stream = this.activeStreams.get(fileId);
      if (stream && typeof (stream as any).destroy === 'function') {
        (stream as any).destroy();
      }
      this.activeStreams.delete(fileId);

      // Remove file handle
      this.fileHandles.delete(fileId);

      // Remove cached chunks for this file
      const prefix = `${fileId}:`;
      for (const chunkKey of this.memoryPool.chunks.keys()) {
        if (chunkKey.startsWith(prefix)) {
          const chunk = this.memoryPool.chunks.get(chunkKey)!;
          this.memoryPool.chunks.delete(chunkKey);
          this.memoryPool.used -= chunk.length;
          this.memoryPool.available += chunk.length;
        }
      }

      this.emit('handleReleased', { fileId, path: handle.path });
      return true;
    }

    return false;
  }

  /**
   * Trigger garbage collection
   */
  async triggerGarbageCollection(): Promise<GarbageCollectionStats> {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage().heapUsed;
    let filesReleased = 0;

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    // Release low priority and stale handles
    const handlesToRelease: string[] = [];
    
    for (const [fileId, handle] of this.fileHandles) {
      const timeSinceAccess = Date.now() - handle.lastAccessed.getTime();
      const isStale = timeSinceAccess > 5 * 60 * 1000; // 5 minutes
      const isLowPriority = handle.priority === 'low';
      
      if ((isStale && !handle.locked) || isLowPriority) {
        handlesToRelease.push(fileId);
      }
    }

    for (const fileId of handlesToRelease) {
      const released = await this.releaseFileHandle(fileId);
      if (released) filesReleased++;
    }

    // Clean memory pool
    this.optimizeMemoryPool();

    const endTime = Date.now();
    const finalMemory = process.memoryUsage().heapUsed;
    const freedMemory = Math.max(0, initialMemory - finalMemory);
    const runTime = endTime - startTime;

    // Update GC stats
    this.gcStats.runs++;
    this.gcStats.freedMemory += freedMemory;
    this.gcStats.filesReleased += filesReleased;
    this.gcStats.lastRun = new Date();
    this.gcStats.averageRunTime = ((this.gcStats.averageRunTime * (this.gcStats.runs - 1)) + runTime) / this.gcStats.runs;

    this.emit('garbageCollectionComplete', {
      filesReleased,
      freedMemory,
      runTime,
    });

    return {
      runs: 1,
      freedMemory,
      filesReleased,
      lastRun: new Date(),
      averageRunTime: runTime,
    };
  }

  /**
   * Clean up stale file handles
   */
  private async cleanupStaleHandles(): Promise<void> {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes

    for (const [fileId, handle] of this.fileHandles) {
      if (!handle.locked && 
          (now - handle.lastAccessed.getTime()) > staleThreshold) {
        await this.releaseFileHandle(fileId);
      }
    }
  }

  /**
   * Optimize memory pool
   */
  private optimizeMemoryPool(): void {
    // Remove empty or corrupted chunks
    for (const [chunkKey, chunk] of this.memoryPool.chunks) {
      if (!chunk || chunk.length === 0) {
        this.memoryPool.chunks.delete(chunkKey);
      }
    }

    // Recalculate pool usage
    let totalUsed = 0;
    for (const chunk of this.memoryPool.chunks.values()) {
      totalUsed += chunk.length;
    }
    
    this.memoryPool.used = totalUsed;
    this.memoryPool.available = this.memoryPool.size - totalUsed;
  }

  /**
   * Get file handle by ID
   */
  getFileHandle(fileId: string): FileHandle | undefined {
    const handle = this.fileHandles.get(fileId);
    if (handle) {
      handle.lastAccessed = new Date();
    }
    return handle;
  }

  /**
   * Lock a file handle to prevent cleanup
   */
  lockFileHandle(fileId: string): boolean {
    const handle = this.fileHandles.get(fileId);
    if (handle) {
      handle.locked = true;
      handle.lastAccessed = new Date();
      return true;
    }
    return false;
  }

  /**
   * Unlock a file handle
   */
  unlockFileHandle(fileId: string): boolean {
    const handle = this.fileHandles.get(fileId);
    if (handle) {
      handle.locked = false;
      return true;
    }
    return false;
  }

  /**
   * Get memory management statistics
   */
  getStats(): {
    memory: MemoryStats;
    fileHandles: {
      total: number;
      active: number;
      locked: number;
      byPriority: Record<string, number>;
    };
    memoryPool: {
      size: number;
      used: number;
      available: number;
      chunkCount: number;
      utilizationPercent: number;
    };
    garbageCollection: GarbageCollectionStats;
    activeStreams: number;
  } {
    const memStats = this.getMemoryStats();
    
    const handleStats = {
      total: this.fileHandles.size,
      active: Array.from(this.fileHandles.values()).filter(h => h.references > 0).length,
      locked: Array.from(this.fileHandles.values()).filter(h => h.locked).length,
      byPriority: {} as Record<string, number>,
    };

    // Count by priority
    for (const handle of this.fileHandles.values()) {
      handleStats.byPriority[handle.priority] = (handleStats.byPriority[handle.priority] || 0) + 1;
    }

    return {
      memory: memStats,
      fileHandles: handleStats,
      memoryPool: {
        size: this.memoryPool.size,
        used: this.memoryPool.used,
        available: this.memoryPool.available,
        chunkCount: this.memoryPool.chunks.size,
        utilizationPercent: (this.memoryPool.used / this.memoryPool.size) * 100,
      },
      garbageCollection: this.gcStats,
      activeStreams: this.activeStreams.size,
    };
  }

  /**
   * Resize memory pool
   */
  resizeMemoryPool(newSize: number): boolean {
    if (newSize < this.memoryPool.used) {
      // Need to evict chunks first
      const requiredEviction = this.memoryPool.used - newSize;
      const evicted = this.evictLRUChunks(requiredEviction);
      
      if (evicted < requiredEviction) {
        return false; // Couldn't free enough space
      }
    }

    this.memoryPool.size = newSize;
    this.memoryPool.available = newSize - this.memoryPool.used;
    
    this.emit('memoryPoolResized', { newSize, used: this.memoryPool.used });
    return true;
  }

  /**
   * Preload frequently accessed video chunks
   */
  async preloadVideo(filePath: string, priority: 'low' | 'medium' | 'high' = 'medium'): Promise<boolean> {
    try {
      const fileStats = await fs.stat(filePath);
      const maxPreloadSize = Math.min(fileStats.size, 50 * 1024 * 1024); // 50MB max preload
      
      if (maxPreloadSize > this.memoryPool.available) {
        return false;
      }

      const { stream, cleanup } = await this.createVideoStream(filePath, {
        priority,
        enableCache: true,
        chunkSize: 1024 * 1024, // 1MB chunks
      });

      let bytesPreloaded = 0;
      
      stream.on('data', (chunk) => {
        bytesPreloaded += chunk.length;
        if (bytesPreloaded >= maxPreloadSize) {
          stream.destroy();
        }
      });

      stream.on('end', cleanup);
      stream.on('error', cleanup);

      return true;
    } catch (error) {
      this.emit('preloadError', { filePath, error: error.message });
      return false;
    }
  }

  /**
   * Clear all caches and reset
   */
  async reset(): Promise<void> {
    // Clear all active streams
    for (const [fileId, stream] of this.activeStreams) {
      if (typeof (stream as any).destroy === 'function') {
        (stream as any).destroy();
      }
    }
    this.activeStreams.clear();

    // Clear all file handles
    this.fileHandles.clear();

    // Clear memory pool
    this.memoryPool.chunks.clear();
    this.memoryPool.used = 0;
    this.memoryPool.available = this.memoryPool.size;

    // Reset GC stats
    this.gcStats = {
      runs: 0,
      freedMemory: 0,
      filesReleased: 0,
      lastRun: new Date(),
      averageRunTime: 0,
    };

    // Force garbage collection
    if (global.gc) {
      global.gc();
    }

    this.emit('reset');
  }

  /**
   * Helper methods
   */
  private generateFileId(filePath: string): string {
    return crypto.createHash('md5').update(filePath).digest('hex');
  }

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.avi': 'video/avi',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
      '.m4v': 'video/x-m4v',
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private isVideoFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v'];
    return videoExtensions.includes(ext);
  }

  /**
   * Cleanup on process exit
   */
  async cleanup(): Promise<void> {
    this.stopMemoryMonitoring();
    await this.reset();
  }
}

// Singleton instance for global use
export const memoryManager = new MemoryManagementService();

// Memory optimization utilities
export class MemoryOptimizer {
  /**
   * Wrap a function with memory monitoring
   */
  static withMemoryMonitoring<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: {
      maxMemoryMB?: number;
      cleanupOnComplete?: boolean;
    } = {}
  ): T {
    return (async (...args: Parameters<T>) => {
      const initialMemory = process.memoryUsage().heapUsed;
      const maxMemory = (options.maxMemoryMB || 500) * 1024 * 1024;
      
      try {
        const result = await fn(...args);
        
        const currentMemory = process.memoryUsage().heapUsed;
        if (currentMemory > maxMemory) {
          console.warn(`Function ${fn.name} exceeded memory limit: ${(currentMemory / 1024 / 1024).toFixed(2)}MB`);
          
          if (options.cleanupOnComplete) {
            await memoryManager.triggerGarbageCollection();
          }
        }
        
        return result;
      } catch (error) {
        if (options.cleanupOnComplete) {
          await memoryManager.triggerGarbageCollection();
        }
        throw error;
      }
    }) as T;
  }

  /**
   * Process large video file in chunks
   */
  static async processVideoInChunks<T>(
    filePath: string,
    processor: (chunk: Buffer, offset: number) => Promise<T>,
    options: {
      chunkSize?: number;
      concurrency?: number;
      priority?: 'low' | 'medium' | 'high';
    } = {}
  ): Promise<T[]> {
    const {
      chunkSize = 5 * 1024 * 1024, // 5MB chunks
      concurrency = 2,
      priority = 'medium'
    } = options;

    const { stream, cleanup } = await memoryManager.createVideoStream(filePath, {
      priority,
      chunkSize,
    });

    const results: T[] = [];
    const processingQueue: Promise<T>[] = [];
    let offset = 0;

    return new Promise((resolve, reject) => {
      stream.on('data', async (chunk: Buffer) => {
        const currentOffset = offset;
        offset += chunk.length;

        // Limit concurrency
        while (processingQueue.length >= concurrency) {
          await Promise.race(processingQueue);
          processingQueue.splice(processingQueue.findIndex(p => p === Promise.race(processingQueue)), 1);
        }

        const processingPromise = processor(chunk, currentOffset)
          .then(result => {
            results.push(result);
            return result;
          })
          .catch(error => {
            reject(error);
            throw error;
          });

        processingQueue.push(processingPromise);
      });

      stream.on('end', async () => {
        try {
          await Promise.all(processingQueue);
          await cleanup();
          resolve(results);
        } catch (error) {
          await cleanup();
          reject(error);
        }
      });

      stream.on('error', async (error) => {
        await cleanup();
        reject(error);
      });
    });
  }
}

// Process exit cleanup
process.on('exit', () => {
  memoryManager.cleanup();
});

process.on('SIGINT', async () => {
  await memoryManager.cleanup();
  process.exit();
});

process.on('SIGTERM', async () => {
  await memoryManager.cleanup();
  process.exit();
});

export { MemoryOptimizer };