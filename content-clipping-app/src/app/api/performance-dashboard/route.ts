import { NextRequest, NextResponse } from 'next/server';
import { optimizedCache, cacheMiddleware } from '@/lib/cache-service-optimized';
import { monitoringService, PerfHooks } from '@/lib/monitoring-service';
import { memoryManager } from '@/lib/memory-management-service';
import { OptimizedJobQueueManager } from '@/lib/enhanced-job-queue-optimized';
import { OptimizedFFmpegService } from '@/lib/ffmpeg-service-optimized';
import { prisma } from '@/lib/prisma';

// Performance dashboard API endpoint
export async function GET(request: NextRequest) {
  const handler = PerfHooks.monitorAPIEndpoint(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const timeRange = searchParams.get('timeRange') || 'hour';
      const includeDetails = searchParams.get('details') === 'true';

      // Cache key for the dashboard data
      const cacheKey = `performance:dashboard:${timeRange}:${includeDetails}`;
      
      // Try to get from cache first
      let dashboardData = await optimizedCache.get(cacheKey);
      
      if (!dashboardData) {
        dashboardData = await generateDashboardData(timeRange, includeDetails);
        // Cache for 30 seconds to 5 minutes depending on detail level
        const ttl = includeDetails ? 30 : 300;
        await optimizedCache.set(cacheKey, dashboardData, ttl);
      }

      return NextResponse.json({
        success: true,
        data: dashboardData,
        timestamp: new Date().toISOString(),
        cached: !!dashboardData,
      });

    } catch (error) {
      console.error('Performance dashboard error:', error);
      return NextResponse.json({
        success: false,
        error: 'Failed to fetch performance data',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, { status: 500 });
    }
  }, 'performance-dashboard');

  return handler();
}

// Generate comprehensive dashboard data
async function generateDashboardData(timeRange: string, includeDetails: boolean) {
  const [
    systemMetrics,
    queueStats,
    cacheStats,
    memoryStats,
    processingStats,
    ffmpegStats,
    performanceSummary
  ] = await Promise.all([
    monitoringService.getSystemMetricsHistory(timeRange as any),
    OptimizedJobQueueManager.getDetailedQueueStats(),
    optimizedCache.getStats(),
    memoryManager.getStats(),
    getProcessingStats(timeRange),
    getFFmpegStats(),
    monitoringService.getPerformanceSummary(),
  ]);

  const dashboardData = {
    overview: {
      status: determineOverallStatus(systemMetrics, queueStats, cacheStats),
      timestamp: new Date(),
      uptime: process.uptime(),
      version: process.version,
    },
    system: {
      current: systemMetrics[systemMetrics.length - 1] || null,
      history: includeDetails ? systemMetrics : systemMetrics.slice(-10),
      trends: calculateTrends(systemMetrics),
    },
    queues: {
      stats: queueStats,
      performance: {
        totalThroughput: calculateTotalThroughput(queueStats),
        averageWaitTime: calculateAverageWaitTime(queueStats),
        errorRates: calculateErrorRates(queueStats),
      },
    },
    cache: {
      stats: cacheStats,
      health: await optimizedCache.getHealth(),
      optimization: await getOptimizationRecommendations(cacheStats),
    },
    memory: {
      stats: memoryStats,
      recommendations: getMemoryRecommendations(memoryStats),
    },
    processing: {
      stats: processingStats,
      performance: performanceSummary.processing,
    },
    ffmpeg: ffmpegStats,
    alerts: monitoringService.getAlerts({ resolved: false }),
    recommendations: await generateOptimizationRecommendations({
      system: systemMetrics,
      queues: queueStats,
      cache: cacheStats,
      memory: memoryStats,
    }),
  };

  // Add detailed breakdown if requested
  if (includeDetails) {
    dashboardData.details = await getDetailedMetrics(timeRange);
  }

  return dashboardData;
}

// Get processing statistics from database
async function getProcessingStats(timeRange: string) {
  const timeThreshold = getTimeThreshold(timeRange);
  
  const stats = await prisma.processingMetrics.groupBy({
    by: ['stage'],
    where: {
      timestamp: {
        gte: timeThreshold,
      },
    },
    _count: {
      id: true,
    },
    _avg: {
      duration: true,
      memoryUsage: true,
      cpuUsage: true,
    },
    _max: {
      duration: true,
    },
    _min: {
      duration: true,
    },
  });

  const totalProcessed = await prisma.video.count({
    where: {
      lastProcessedAt: {
        gte: timeThreshold,
      },
    },
  });

  const successfullyProcessed = await prisma.video.count({
    where: {
      status: 'READY',
      lastProcessedAt: {
        gte: timeThreshold,
      },
    },
  });

  return {
    byStage: stats.map(stat => ({
      stage: stat.stage,
      count: stat._count.id,
      avgDuration: stat._avg.duration,
      avgMemory: stat._avg.memoryUsage,
      avgCpu: stat._avg.cpuUsage,
      maxDuration: stat._max.duration,
      minDuration: stat._min.duration,
    })),
    totals: {
      processed: totalProcessed,
      successful: successfullyProcessed,
      successRate: totalProcessed > 0 ? successfullyProcessed / totalProcessed : 0,
    },
  };
}

// Get FFmpeg processing statistics
async function getFFmpegStats() {
  const processingStats = OptimizedFFmpegService.getProcessingStats();
  const isValid = await OptimizedFFmpegService.validateInstallation();
  
  return {
    installation: isValid,
    processing: processingStats,
    performance: {
      averageJobTime: processingStats.activeJobs > 0 ? 
        Math.random() * 60000 : 0, // Placeholder calculation
      concurrencyUtilization: processingStats.activeJobs / processingStats.concurrency,
      queueEfficiency: processingStats.queueLength > 0 ? 
        processingStats.activeJobs / processingStats.queueLength : 1,
    },
  };
}

// Calculate trends from system metrics
function calculateTrends(metrics: any[]) {
  if (metrics.length < 2) return null;

  const latest = metrics[metrics.length - 1];
  const previous = metrics[metrics.length - 2];

  return {
    cpu: {
      current: latest.cpu.usage,
      change: latest.cpu.usage - previous.cpu.usage,
      trend: latest.cpu.usage > previous.cpu.usage ? 'up' : 'down',
    },
    memory: {
      current: latest.memory.usagePercent,
      change: latest.memory.usagePercent - previous.memory.usagePercent,
      trend: latest.memory.usagePercent > previous.memory.usagePercent ? 'up' : 'down',
    },
    disk: {
      current: latest.disk.usagePercent,
      change: latest.disk.usagePercent - previous.disk.usagePercent,
      trend: latest.disk.usagePercent > previous.disk.usagePercent ? 'up' : 'down',
    },
  };
}

// Calculate queue performance metrics
function calculateTotalThroughput(queueStats: any) {
  return Object.values(queueStats.queues).reduce((total: number, queue: any) => 
    total + (queue.completed || 0), 0);
}

function calculateAverageWaitTime(queueStats: any) {
  const queues = Object.values(queueStats.queues);
  const totalWaitTime = queues.reduce((total: number, queue: any) => 
    total + (queue.waiting || 0), 0);
  return queues.length > 0 ? totalWaitTime / queues.length : 0;
}

function calculateErrorRates(queueStats: any) {
  return Object.entries(queueStats.queues).map(([name, queue]: [string, any]) => ({
    queue: name,
    errorRate: queue.completed > 0 ? queue.failed / queue.completed : 0,
    errors: queue.failed || 0,
  }));
}

// Generate cache optimization recommendations
async function getOptimizationRecommendations(cacheStats: any) {
  const recommendations = [];

  if (cacheStats.hitRate < 0.7) {
    recommendations.push({
      type: 'hitRate',
      message: 'Cache hit rate is below 70%. Consider increasing TTL for frequently accessed data.',
      priority: 'medium',
    });
  }

  if (cacheStats.totalKeys > 10000) {
    recommendations.push({
      type: 'keyCount',
      message: 'High number of cache keys detected. Consider implementing key namespacing and cleanup.',
      priority: 'low',
    });
  }

  const cacheSize = await optimizedCache.getCacheStats();
  if (cacheSize.sizeMB && parseInt(cacheSize.sizeMB) > 100) {
    recommendations.push({
      type: 'memory',
      message: 'Cache memory usage is high. Consider enabling compression or reducing TTL.',
      priority: 'high',
    });
  }

  return recommendations;
}

// Generate memory optimization recommendations
function getMemoryRecommendations(memoryStats: any) {
  const recommendations = [];

  if (memoryStats.memory.usagePercent > 80) {
    recommendations.push({
      type: 'usage',
      message: 'Memory usage is above 80%. Consider triggering garbage collection or reducing concurrent jobs.',
      priority: 'high',
    });
  }

  if (memoryStats.fileHandles.total > 50) {
    recommendations.push({
      type: 'fileHandles',
      message: 'High number of file handles. Consider implementing more aggressive cleanup policies.',
      priority: 'medium',
    });
  }

  if (memoryStats.memoryPool.utilizationPercent > 90) {
    recommendations.push({
      type: 'pool',
      message: 'Memory pool utilization is very high. Consider increasing pool size or reducing chunk sizes.',
      priority: 'high',
    });
  }

  return recommendations;
}

// Generate comprehensive optimization recommendations
async function generateOptimizationRecommendations(metrics: {
  system: any[];
  queues: any;
  cache: any;
  memory: any;
}) {
  const recommendations = [];

  // System-level recommendations
  const latestSystem = metrics.system[metrics.system.length - 1];
  if (latestSystem) {
    if (latestSystem.cpu.usage > 80) {
      recommendations.push({
        category: 'system',
        type: 'cpu',
        message: 'High CPU usage detected. Consider reducing concurrent processing or upgrading hardware.',
        priority: 'high',
        actions: [
          'Reduce concurrent job limits',
          'Optimize video processing algorithms',
          'Consider horizontal scaling',
        ],
      });
    }

    if (latestSystem.memory.usagePercent > 85) {
      recommendations.push({
        category: 'system',
        type: 'memory',
        message: 'Memory pressure detected. Implement more aggressive memory management.',
        priority: 'critical',
        actions: [
          'Enable automatic garbage collection',
          'Reduce video file cache sizes',
          'Implement streaming processing',
        ],
      });
    }
  }

  // Queue-level recommendations
  const totalQueueSize = Object.values(metrics.queues.queues).reduce((total: number, queue: any) => 
    total + (queue.waiting || 0), 0);
  
  if (totalQueueSize > 100) {
    recommendations.push({
      category: 'queues',
      type: 'backlog',
      message: 'Large queue backlog detected. Scale processing or optimize job prioritization.',
      priority: 'high',
      actions: [
        'Increase worker concurrency',
        'Implement job prioritization',
        'Add more processing nodes',
      ],
    });
  }

  // Cache-level recommendations
  if (metrics.cache.hitRate < 0.6) {
    recommendations.push({
      category: 'cache',
      type: 'efficiency',
      message: 'Cache hit rate is suboptimal. Review caching strategy.',
      priority: 'medium',
      actions: [
        'Increase TTL for stable data',
        'Implement cache warming',
        'Review cache key patterns',
      ],
    });
  }

  return recommendations;
}

// Get detailed metrics for deep analysis
async function getDetailedMetrics(timeRange: string) {
  const timeThreshold = getTimeThreshold(timeRange);
  
  const [
    detailedProcessingMetrics,
    errorAnalysis,
    performanceBreakdown,
    resourceUtilization
  ] = await Promise.all([
    getDetailedProcessingMetrics(timeThreshold),
    getErrorAnalysis(timeThreshold),
    getPerformanceBreakdown(timeThreshold),
    getResourceUtilization(),
  ]);

  return {
    processing: detailedProcessingMetrics,
    errors: errorAnalysis,
    performance: performanceBreakdown,
    resources: resourceUtilization,
  };
}

async function getDetailedProcessingMetrics(timeThreshold: Date) {
  return await prisma.processingMetrics.findMany({
    where: {
      timestamp: {
        gte: timeThreshold,
      },
    },
    orderBy: {
      timestamp: 'desc',
    },
    take: 100,
    include: {
      video: {
        select: {
          id: true,
          title: true,
          fileSize: true,
          duration: true,
        },
      },
    },
  });
}

async function getErrorAnalysis(timeThreshold: Date) {
  const errors = await prisma.processingMetrics.findMany({
    where: {
      timestamp: {
        gte: timeThreshold,
      },
      errorMessage: {
        not: null,
      },
    },
    select: {
      stage: true,
      errorMessage: true,
      timestamp: true,
      videoId: true,
    },
  });

  // Group errors by type and stage
  const errorsByStage: Record<string, any[]> = {};
  const errorsByType: Record<string, number> = {};

  errors.forEach(error => {
    if (!errorsByStage[error.stage]) {
      errorsByStage[error.stage] = [];
    }
    errorsByStage[error.stage].push(error);

    const errorType = error.errorMessage?.split(':')[0] || 'Unknown';
    errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
  });

  return {
    byStage: errorsByStage,
    byType: errorsByType,
    recent: errors.slice(0, 10),
    trends: calculateErrorTrends(errors),
  };
}

function calculateErrorTrends(errors: any[]) {
  // Simple trend calculation
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const recentErrors = errors.filter(e => new Date(e.timestamp).getTime() > hourAgo).length;
  const dayErrors = errors.filter(e => new Date(e.timestamp).getTime() > dayAgo).length;

  return {
    lastHour: recentErrors,
    lastDay: dayErrors,
    trend: recentErrors > dayErrors / 24 ? 'increasing' : 'decreasing',
  };
}

async function getPerformanceBreakdown(timeThreshold: Date) {
  // Get aggregated performance data
  const stageDurations = await prisma.processingMetrics.groupBy({
    by: ['stage'],
    where: {
      timestamp: {
        gte: timeThreshold,
      },
    },
    _avg: {
      duration: true,
    },
    _count: {
      id: true,
    },
  });

  return {
    stageDurations: stageDurations.map(stage => ({
      stage: stage.stage,
      avgDuration: stage._avg.duration,
      count: stage._count.id,
      percentage: 0, // Would calculate based on total
    })),
    bottlenecks: identifyBottlenecks(stageDurations),
  };
}

function identifyBottlenecks(stageDurations: any[]) {
  const sorted = stageDurations.sort((a, b) => (b._avg.duration || 0) - (a._avg.duration || 0));
  return sorted.slice(0, 3).map(stage => ({
    stage: stage.stage,
    avgDuration: stage._avg.duration,
    impact: 'high', // Would calculate based on frequency and duration
  }));
}

async function getResourceUtilization() {
  return {
    cpu: {
      cores: require('os').cpus().length,
      usage: process.cpuUsage(),
      loadAverage: require('os').loadavg(),
    },
    memory: process.memoryUsage(),
    disk: {
      // Would implement actual disk usage monitoring
      usage: 'Not implemented',
    },
    network: {
      // Would implement network monitoring
      usage: 'Not implemented',
    },
  };
}

// Determine overall system status
function determineOverallStatus(systemMetrics: any[], queueStats: any, cacheStats: any) {
  const latest = systemMetrics[systemMetrics.length - 1];
  if (!latest) return 'unknown';

  const issues = [];

  if (latest.cpu.usage > 90) issues.push('critical-cpu');
  else if (latest.cpu.usage > 80) issues.push('warning-cpu');

  if (latest.memory.usagePercent > 95) issues.push('critical-memory');
  else if (latest.memory.usagePercent > 85) issues.push('warning-memory');

  if (cacheStats.hitRate < 0.5) issues.push('warning-cache');

  const totalQueueSize = Object.values(queueStats.queues || {}).reduce((total: number, queue: any) => 
    total + (queue.waiting || 0), 0);
  
  if (totalQueueSize > 500) issues.push('critical-queue');
  else if (totalQueueSize > 100) issues.push('warning-queue');

  if (issues.some(i => i.startsWith('critical'))) return 'critical';
  if (issues.some(i => i.startsWith('warning'))) return 'warning';
  return 'healthy';
}

// Helper function to get time threshold
function getTimeThreshold(timeRange: string): Date {
  const now = new Date();
  switch (timeRange) {
    case 'hour':
      return new Date(now.getTime() - 60 * 60 * 1000);
    case 'day':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 60 * 60 * 1000);
  }
}

// Health check endpoint
export async function HEAD() {
  try {
    const cacheHealth = await optimizedCache.getHealth();
    const memoryStats = memoryManager.getStats();
    const queueStats = await OptimizedJobQueueManager.getDetailedQueueStats();

    const isHealthy = cacheHealth.status === 'healthy' && 
                     memoryStats.memory.usagePercent < 90 &&
                     queueStats.system.memoryUsage < 0.9;

    return new NextResponse(null, { 
      status: isHealthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-cache',
        'X-Health-Status': isHealthy ? 'healthy' : 'degraded',
      }
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}

// Performance optimization endpoint
export async function POST(request: NextRequest) {
  const handler = PerfHooks.monitorAPIEndpoint(async () => {
    try {
      const body = await request.json();
      const { action, parameters } = body;

      let result;

      switch (action) {
        case 'optimize-cache':
          result = await optimizedCache.optimize();
          break;
        case 'trigger-gc':
          result = await memoryManager.triggerGarbageCollection();
          break;
        case 'clear-failed-jobs':
          await OptimizedJobQueueManager.clearFailedJobs();
          result = { success: true, message: 'Failed jobs cleared' };
          break;
        case 'resize-memory-pool':
          const newSize = parameters?.size || 100 * 1024 * 1024;
          result = memoryManager.resizeMemoryPool(newSize);
          break;
        default:
          return NextResponse.json({
            success: false,
            error: 'Unknown optimization action',
          }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        action,
        result,
        timestamp: new Date(),
      });

    } catch (error) {
      console.error('Performance optimization error:', error);
      return NextResponse.json({
        success: false,
        error: 'Optimization failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, { status: 500 });
    }
  }, 'performance-optimization');

  return handler();
}
