import { EventEmitter } from 'events';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from './prisma';
import { optimizedCache } from './cache-service-optimized';

// Monitoring interfaces
export interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    loadAverage: number[];
    cores: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
    heapTotal: number;
    heapUsed: number;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    usagePercent: number;
  };
  network: {
    bytesReceived: number;
    bytesSent: number;
  };
}

export interface ProcessingMetrics {
  videoId: string;
  stage: string;
  duration: number;
  memoryUsage: number;
  cpuUsage: number;
  queueWaitTime: number;
  throughput: number;
  errors: string[];
  retries: number;
}

export interface QueueMetrics {
  name: string;
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  delayed: number;
  throughput: number;
  avgProcessingTime: number;
  errorRate: number;
}

export interface CacheMetrics {
  hitRate: number;
  totalHits: number;
  totalMisses: number;
  totalKeys: number;
  memoryUsage: number;
  compressionRatio: number;
  evictions: number;
}

export interface PerformanceAlert {
  id: string;
  type: 'cpu' | 'memory' | 'disk' | 'queue' | 'processing' | 'error';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  metrics?: any;
  resolved?: boolean;
  resolvedAt?: Date;
}

export interface PerformanceThresholds {
  cpu: { warning: number; critical: number };
  memory: { warning: number; critical: number };
  disk: { warning: number; critical: number };
  queueSize: { warning: number; critical: number };
  processingTime: { warning: number; critical: number };
  errorRate: { warning: number; critical: number };
}

// Performance monitoring service
export class MonitoringService extends EventEmitter {
  private isMonitoring = false;
  private systemMetricsInterval?: NodeJS.Timeout;
  private queueMetricsInterval?: NodeJS.Timeout;
  private alertsCleanupInterval?: NodeJS.Timeout;
  private metrics: SystemMetrics[] = [];
  private alerts: PerformanceAlert[] = [];
  private thresholds: PerformanceThresholds;
  
  private lastNetworkStats = { bytesReceived: 0, bytesSent: 0 };
  private processingTimes: Map<string, number> = new Map();
  private queueThroughput: Map<string, number[]> = new Map();

  constructor() {
    super();
    
    this.thresholds = {
      cpu: { warning: 70, critical: 90 },
      memory: { warning: 80, critical: 95 },
      disk: { warning: 85, critical: 95 },
      queueSize: { warning: 100, critical: 500 },
      processingTime: { warning: 5 * 60 * 1000, critical: 15 * 60 * 1000 }, // 5min warning, 15min critical
      errorRate: { warning: 0.05, critical: 0.15 }, // 5% warning, 15% critical
    };
  }

  /**
   * Start monitoring system and application metrics
   */
  startMonitoring(options: {
    systemMetricsInterval?: number;
    queueMetricsInterval?: number;
    maxHistorySize?: number;
  } = {}) {
    if (this.isMonitoring) {
      console.warn('Monitoring is already running');
      return;
    }

    const {
      systemMetricsInterval = 10000, // 10 seconds
      queueMetricsInterval = 30000,  // 30 seconds
      maxHistorySize = 1000
    } = options;

    this.isMonitoring = true;
    
    // System metrics collection
    this.systemMetricsInterval = setInterval(async () => {
      try {
        const metrics = await this.collectSystemMetrics();
        this.metrics.push(metrics);
        
        // Keep only recent metrics
        if (this.metrics.length > maxHistorySize) {
          this.metrics = this.metrics.slice(-maxHistorySize);
        }
        
        this.emit('systemMetrics', metrics);
        await this.checkSystemAlerts(metrics);
      } catch (error) {
        console.error('Error collecting system metrics:', error);
      }
    }, systemMetricsInterval);

    // Queue metrics collection
    this.queueMetricsInterval = setInterval(async () => {
      try {
        await this.collectQueueMetrics();
      } catch (error) {
        console.error('Error collecting queue metrics:', error);
      }
    }, queueMetricsInterval);

    // Clean up old alerts
    this.alertsCleanupInterval = setInterval(() => {
      this.cleanupOldAlerts();
    }, 60 * 60 * 1000); // Every hour

    console.log('Performance monitoring started');
    this.emit('monitoringStarted');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;

    if (this.systemMetricsInterval) {
      clearInterval(this.systemMetricsInterval);
    }
    if (this.queueMetricsInterval) {
      clearInterval(this.queueMetricsInterval);
    }
    if (this.alertsCleanupInterval) {
      clearInterval(this.alertsCleanupInterval);
    }

    console.log('Performance monitoring stopped');
    this.emit('monitoringStopped');
  }

  /**
   * Collect comprehensive system metrics
   */
  private async collectSystemMetrics(): Promise<SystemMetrics> {
    const cpuUsage = await this.getCpuUsage();
    const memoryStats = this.getMemoryStats();
    const diskStats = await this.getDiskStats();
    const networkStats = await this.getNetworkStats();

    const metrics: SystemMetrics = {
      timestamp: new Date(),
      cpu: {
        usage: cpuUsage,
        loadAverage: os.loadavg(),
        cores: os.cpus().length,
      },
      memory: memoryStats,
      disk: diskStats,
      network: networkStats,
    };

    // Store metrics in cache for API access
    await optimizedCache.set('metrics:system:latest', metrics, 60);
    
    return metrics;
  }

  /**
   * Get CPU usage percentage
   */
  private async getCpuUsage(): Promise<number> {
    return new Promise((resolve) => {
      const startTime = process.hrtime();
      const startUsage = process.cpuUsage();

      setTimeout(() => {
        const endTime = process.hrtime(startTime);
        const endUsage = process.cpuUsage(startUsage);

        const totalTime = endTime[0] * 1000000 + endTime[1] / 1000; // microseconds
        const totalUsage = endUsage.user + endUsage.system;
        const usage = (totalUsage / totalTime) * 100;

        resolve(Math.min(100, usage));
      }, 100);
    });
  }

  /**
   * Get memory statistics
   */
  private getMemoryStats() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const processMemory = process.memoryUsage();

    return {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      usagePercent: (usedMem / totalMem) * 100,
      heapTotal: processMemory.heapTotal,
      heapUsed: processMemory.heapUsed,
    };
  }

  /**
   * Get disk statistics
   */
  private async getDiskStats() {
    try {
      const stats = await fs.stat(process.cwd());
      // This is a simplified implementation
      // In production, you'd want to use platform-specific tools
      return {
        total: 100 * 1024 * 1024 * 1024, // 100GB placeholder
        free: 50 * 1024 * 1024 * 1024,   // 50GB placeholder
        used: 50 * 1024 * 1024 * 1024,   // 50GB placeholder
        usagePercent: 50,
      };
    } catch (error) {
      return {
        total: 0,
        free: 0,
        used: 0,
        usagePercent: 0,
      };
    }
  }

  /**
   * Get network statistics
   */
  private async getNetworkStats() {
    // This is a simplified implementation
    // In production, you'd want to track actual network usage
    const current = {
      bytesReceived: this.lastNetworkStats.bytesReceived + Math.random() * 1000,
      bytesSent: this.lastNetworkStats.bytesSent + Math.random() * 1000,
    };
    
    this.lastNetworkStats = current;
    return current;
  }

  /**
   * Collect queue metrics from job queues
   */
  private async collectQueueMetrics() {
    try {
      // This would integrate with your actual job queues
      const queueNames = ['video-processing', 'transcription', 'clip-generation'];
      
      for (const queueName of queueNames) {
        const metrics = await this.getQueueMetrics(queueName);
        this.emit('queueMetrics', queueName, metrics);
        await optimizedCache.set(`metrics:queue:${queueName}`, metrics, 60);
      }
    } catch (error) {
      console.error('Error collecting queue metrics:', error);
    }
  }

  /**
   * Get metrics for a specific queue
   */
  private async getQueueMetrics(queueName: string): Promise<QueueMetrics> {
    // This is a placeholder implementation
    // You'd integrate with your actual Bull queue instances
    const mockMetrics: QueueMetrics = {
      name: queueName,
      active: Math.floor(Math.random() * 10),
      waiting: Math.floor(Math.random() * 50),
      completed: Math.floor(Math.random() * 1000),
      failed: Math.floor(Math.random() * 10),
      delayed: Math.floor(Math.random() * 5),
      throughput: Math.floor(Math.random() * 100),
      avgProcessingTime: 30000 + Math.random() * 120000, // 30s to 2.5min
      errorRate: Math.random() * 0.1, // 0-10% error rate
    };

    await this.checkQueueAlerts(mockMetrics);
    return mockMetrics;
  }

  /**
   * Track processing performance for a video
   */
  async trackProcessingStart(videoId: string, stage: string): Promise<string> {
    const trackingId = `${videoId}:${stage}:${Date.now()}`;
    this.processingTimes.set(trackingId, Date.now());
    
    await optimizedCache.set(`processing:start:${trackingId}`, {
      videoId,
      stage,
      startTime: Date.now(),
    }, 3600); // 1 hour TTL
    
    return trackingId;
  }

  /**
   * Track processing completion
   */
  async trackProcessingEnd(trackingId: string, success: boolean, error?: string): Promise<ProcessingMetrics | null> {
    const startTime = this.processingTimes.get(trackingId);
    if (!startTime) return null;

    const duration = Date.now() - startTime;
    this.processingTimes.delete(trackingId);

    const [videoId, stage] = trackingId.split(':');
    const systemMetrics = await this.collectSystemMetrics();
    
    const metrics: ProcessingMetrics = {
      videoId,
      stage,
      duration,
      memoryUsage: systemMetrics.memory.heapUsed,
      cpuUsage: systemMetrics.cpu.usage,
      queueWaitTime: 0, // Would need to be tracked from job queue
      throughput: 1000 / duration, // videos per second
      errors: error ? [error] : [],
      retries: 0, // Would need to be tracked
    };

    // Store metrics in database for long-term analysis
    try {
      await prisma.processingMetrics.create({
        data: {
          videoId,
          stage,
          duration,
          memoryUsage: BigInt(metrics.memoryUsage),
          cpuUsage: metrics.cpuUsage,
          queueWaitTime: metrics.queueWaitTime,
          concurrentJobs: 0, // Would need actual tracking
          errorMessage: error,
          metadata: {
            trackingId,
            success,
            throughput: metrics.throughput,
          },
        },
      });
    } catch (dbError) {
      console.error('Error storing processing metrics:', dbError);
    }

    this.emit('processingCompleted', metrics);
    await this.checkProcessingAlerts(metrics);
    
    return metrics;
  }

  /**
   * Check for system-level alerts
   */
  private async checkSystemAlerts(metrics: SystemMetrics) {
    const alerts: PerformanceAlert[] = [];

    // CPU alerts
    if (metrics.cpu.usage > this.thresholds.cpu.critical) {
      alerts.push(this.createAlert('cpu', 'critical', `CPU usage critical: ${metrics.cpu.usage.toFixed(2)}%`, metrics));
    } else if (metrics.cpu.usage > this.thresholds.cpu.warning) {
      alerts.push(this.createAlert('cpu', 'medium', `CPU usage high: ${metrics.cpu.usage.toFixed(2)}%`, metrics));
    }

    // Memory alerts
    if (metrics.memory.usagePercent > this.thresholds.memory.critical) {
      alerts.push(this.createAlert('memory', 'critical', `Memory usage critical: ${metrics.memory.usagePercent.toFixed(2)}%`, metrics));
    } else if (metrics.memory.usagePercent > this.thresholds.memory.warning) {
      alerts.push(this.createAlert('memory', 'medium', `Memory usage high: ${metrics.memory.usagePercent.toFixed(2)}%`, metrics));
    }

    // Disk alerts
    if (metrics.disk.usagePercent > this.thresholds.disk.critical) {
      alerts.push(this.createAlert('disk', 'critical', `Disk usage critical: ${metrics.disk.usagePercent.toFixed(2)}%`, metrics));
    } else if (metrics.disk.usagePercent > this.thresholds.disk.warning) {
      alerts.push(this.createAlert('disk', 'medium', `Disk usage high: ${metrics.disk.usagePercent.toFixed(2)}%`, metrics));
    }

    for (const alert of alerts) {
      await this.addAlert(alert);
    }
  }

  /**
   * Check for queue-level alerts
   */
  private async checkQueueAlerts(metrics: QueueMetrics) {
    const alerts: PerformanceAlert[] = [];

    // Queue size alerts
    const queueSize = metrics.active + metrics.waiting;
    if (queueSize > this.thresholds.queueSize.critical) {
      alerts.push(this.createAlert('queue', 'critical', `Queue ${metrics.name} size critical: ${queueSize}`, metrics));
    } else if (queueSize > this.thresholds.queueSize.warning) {
      alerts.push(this.createAlert('queue', 'medium', `Queue ${metrics.name} size high: ${queueSize}`, metrics));
    }

    // Error rate alerts
    if (metrics.errorRate > this.thresholds.errorRate.critical) {
      alerts.push(this.createAlert('queue', 'critical', `Queue ${metrics.name} error rate critical: ${(metrics.errorRate * 100).toFixed(2)}%`, metrics));
    } else if (metrics.errorRate > this.thresholds.errorRate.warning) {
      alerts.push(this.createAlert('queue', 'medium', `Queue ${metrics.name} error rate high: ${(metrics.errorRate * 100).toFixed(2)}%`, metrics));
    }

    for (const alert of alerts) {
      await this.addAlert(alert);
    }
  }

  /**
   * Check for processing-level alerts
   */
  private async checkProcessingAlerts(metrics: ProcessingMetrics) {
    const alerts: PerformanceAlert[] = [];

    // Processing time alerts
    if (metrics.duration > this.thresholds.processingTime.critical) {
      alerts.push(this.createAlert('processing', 'critical', `Processing time critical for ${metrics.stage}: ${(metrics.duration / 1000).toFixed(2)}s`, metrics));
    } else if (metrics.duration > this.thresholds.processingTime.warning) {
      alerts.push(this.createAlert('processing', 'medium', `Processing time high for ${metrics.stage}: ${(metrics.duration / 1000).toFixed(2)}s`, metrics));
    }

    // Error alerts
    if (metrics.errors.length > 0) {
      alerts.push(this.createAlert('error', 'high', `Processing errors in ${metrics.stage}: ${metrics.errors.join(', ')}`, metrics));
    }

    for (const alert of alerts) {
      await this.addAlert(alert);
    }
  }

  /**
   * Create a new alert
   */
  private createAlert(
    type: PerformanceAlert['type'],
    severity: PerformanceAlert['severity'],
    message: string,
    metrics?: any
  ): PerformanceAlert {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity,
      message,
      timestamp: new Date(),
      metrics,
      resolved: false,
    };
  }

  /**
   * Add an alert to the system
   */
  private async addAlert(alert: PerformanceAlert) {
    this.alerts.push(alert);
    this.emit('alert', alert);
    
    // Store in cache for API access
    await optimizedCache.set(`alert:${alert.id}`, alert, 24 * 60 * 60); // 24 hours
    
    // Log based on severity
    const logMethod = {
      low: console.info,
      medium: console.warn,
      high: console.error,
      critical: console.error,
    }[alert.severity];
    
    logMethod(`[${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message}`);
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string): Promise<boolean> {
    const alertIndex = this.alerts.findIndex(a => a.id === alertId);
    if (alertIndex === -1) return false;

    this.alerts[alertIndex].resolved = true;
    this.alerts[alertIndex].resolvedAt = new Date();
    
    await optimizedCache.set(`alert:${alertId}`, this.alerts[alertIndex], 24 * 60 * 60);
    this.emit('alertResolved', this.alerts[alertIndex]);
    
    return true;
  }

  /**
   * Get current alerts
   */
  getAlerts(filters: {
    type?: PerformanceAlert['type'];
    severity?: PerformanceAlert['severity'];
    resolved?: boolean;
  } = {}): PerformanceAlert[] {
    return this.alerts.filter(alert => {
      if (filters.type && alert.type !== filters.type) return false;
      if (filters.severity && alert.severity !== filters.severity) return false;
      if (filters.resolved !== undefined && alert.resolved !== filters.resolved) return false;
      return true;
    });
  }

  /**
   * Get system metrics history
   */
  getSystemMetricsHistory(duration: 'hour' | 'day' | 'week' = 'hour'): SystemMetrics[] {
    const now = Date.now();
    const timeThresholds = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
    };
    
    const threshold = now - timeThresholds[duration];
    
    return this.metrics.filter(metric => 
      metric.timestamp.getTime() > threshold
    );
  }

  /**
   * Get performance summary
   */
  async getPerformanceSummary(): Promise<{
    system: SystemMetrics;
    processing: {
      totalVideos: number;
      avgProcessingTime: number;
      successRate: number;
      currentQueue: number;
    };
    cache: CacheMetrics;
    alerts: {
      total: number;
      critical: number;
      unresolved: number;
    };
  }> {
    const latestSystemMetrics = this.metrics[this.metrics.length - 1] || await this.collectSystemMetrics();
    
    // Get processing stats from database
    const processingStats = await prisma.processingMetrics.aggregate({
      where: {
        timestamp: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
      _count: {
        id: true,
      },
      _avg: {
        duration: true,
      },
    });

    const cacheStats = await optimizedCache.getStats();
    const alerts = this.getAlerts({ resolved: false });

    return {
      system: latestSystemMetrics,
      processing: {
        totalVideos: processingStats._count.id,
        avgProcessingTime: processingStats._avg.duration || 0,
        successRate: 0.95, // Would calculate from actual data
        currentQueue: 0, // Would get from actual queue
      },
      cache: cacheStats,
      alerts: {
        total: this.alerts.length,
        critical: this.getAlerts({ severity: 'critical' }).length,
        unresolved: alerts.length,
      },
    };
  }

  /**
   * Clean up old alerts
   */
  private cleanupOldAlerts() {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
    const initialCount = this.alerts.length;
    
    this.alerts = this.alerts.filter(alert => 
      alert.timestamp.getTime() > cutoff || !alert.resolved
    );
    
    const cleaned = initialCount - this.alerts.length;
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} old alerts`);
    }
  }

  /**
   * Update monitoring thresholds
   */
  updateThresholds(newThresholds: Partial<PerformanceThresholds>) {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    this.emit('thresholdsUpdated', this.thresholds);
  }

  /**
   * Export metrics for external analysis
   */
  async exportMetrics(format: 'json' | 'csv' = 'json'): Promise<string> {
    const data = {
      systemMetrics: this.getSystemMetricsHistory('week'),
      alerts: this.alerts,
      summary: await this.getPerformanceSummary(),
      exportedAt: new Date(),
    };

    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    }
    
    // CSV export would be more complex, implementing basic version
    return `timestamp,cpu_usage,memory_percent,alerts_count\n${
      data.systemMetrics.map(m => 
        `${m.timestamp.toISOString()},${m.cpu.usage},${m.memory.usagePercent},${this.alerts.filter(a => a.timestamp <= m.timestamp).length}`
      ).join('\n')
    }`;
  }
}

// Singleton instance
export const monitoringService = new MonitoringService();

// Performance hooks for easy integration
export class PerformanceHooks {
  /**
   * Measure function execution time
   */
  static measureAsync<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    name: string
  ): T {
    return (async (...args: Parameters<T>) => {
      const start = Date.now();
      try {
        const result = await fn(...args);
        const duration = Date.now() - start;
        
        monitoringService.emit('functionExecuted', {
          name,
          duration,
          success: true,
          timestamp: new Date(),
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        
        monitoringService.emit('functionExecuted', {
          name,
          duration,
          success: false,
          error: error.message,
          timestamp: new Date(),
        });
        
        throw error;
      }
    }) as T;
  }

  /**
   * Track video processing pipeline
   */
  static async trackVideoProcessing<T>(
    videoId: string,
    stage: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const trackingId = await monitoringService.trackProcessingStart(videoId, stage);
    
    try {
      const result = await operation();
      await monitoringService.trackProcessingEnd(trackingId, true);
      return result;
    } catch (error) {
      await monitoringService.trackProcessingEnd(trackingId, false, error.message);
      throw error;
    }
  }

  /**
   * Monitor database queries
   */
  static monitorDatabaseQuery<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    queryName: string
  ): T {
    return this.measureAsync(fn, `db:${queryName}`);
  }

  /**
   * Monitor API endpoints
   */
  static monitorAPIEndpoint<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    endpoint: string
  ): T {
    return this.measureAsync(fn, `api:${endpoint}`);
  }
}

export { PerformanceHooks as PerfHooks };