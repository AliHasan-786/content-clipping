import { Server as SocketIOServer, Socket } from 'socket.io';
import { prisma } from '../prisma';
import { RevenueAnalyticsService } from './revenue-analytics-service';

export class RealTimeAnalyticsService {
  private static instance: RealTimeAnalyticsService;
  private io: SocketIOServer | null = null;
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
  private userSubscriptions: Map<string, Set<string>> = new Map(); // userId -> socketIds

  static getInstance(): RealTimeAnalyticsService {
    if (!RealTimeAnalyticsService.instance) {
      RealTimeAnalyticsService.instance = new RealTimeAnalyticsService();
    }
    return RealTimeAnalyticsService.instance;
  }

  setSocketServer(io: SocketIOServer) {
    this.io = io;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    if (!this.io) return;

    this.io.on('connection', (socket: Socket) => {
      console.log('Client connected to analytics:', socket.id);

      socket.on('subscribe-analytics', (data: { userId: string, filters?: any }) => {
        this.handleAnalyticsSubscription(socket, data.userId, data.filters);
      });

      socket.on('unsubscribe-analytics', (data: { userId: string }) => {
        this.handleAnalyticsUnsubscription(socket, data.userId);
      });

      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }

  private async handleAnalyticsSubscription(
    socket: Socket, 
    userId: string, 
    filters?: any
  ) {
    try {
      // Add socket to user subscriptions
      if (!this.userSubscriptions.has(userId)) {
        this.userSubscriptions.set(userId, new Set());
      }
      this.userSubscriptions.get(userId)!.add(socket.id);

      // Send initial analytics data
      const analyticsData = await RevenueAnalyticsService.getRevenueAnalytics(
        userId,
        filters || { timeframe: 'month' }
      );

      socket.emit('analytics-update', {
        type: 'initial',
        data: analyticsData,
        timestamp: new Date().toISOString()
      });

      // Set up periodic updates for this user if not already active
      if (!this.updateIntervals.has(userId)) {
        this.startPeriodicUpdates(userId, filters);
      }

      socket.join(`analytics-${userId}`);
      console.log(`User ${userId} subscribed to analytics updates`);

    } catch (error) {
      console.error('Error handling analytics subscription:', error);
      socket.emit('analytics-error', {
        message: 'Failed to subscribe to analytics updates'
      });
    }
  }

  private handleAnalyticsUnsubscription(socket: Socket, userId: string) {
    const userSockets = this.userSubscriptions.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      
      // If no more sockets for this user, stop updates
      if (userSockets.size === 0) {
        this.userSubscriptions.delete(userId);
        this.stopPeriodicUpdates(userId);
      }
    }

    socket.leave(`analytics-${userId}`);
    console.log(`User ${userId} unsubscribed from analytics updates`);
  }

  private handleDisconnect(socket: Socket) {
    // Remove socket from all user subscriptions
    for (const [userId, socketIds] of this.userSubscriptions.entries()) {
      if (socketIds.has(socket.id)) {
        socketIds.delete(socket.id);
        
        if (socketIds.size === 0) {
          this.userSubscriptions.delete(userId);
          this.stopPeriodicUpdates(userId);
        }
        break;
      }
    }
    console.log('Client disconnected from analytics:', socket.id);
  }

  private startPeriodicUpdates(userId: string, filters?: any) {
    // Update analytics data every 5 minutes
    const interval = setInterval(async () => {
      try {
        await this.sendAnalyticsUpdate(userId, filters);
      } catch (error) {
        console.error('Error sending periodic analytics update:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    this.updateIntervals.set(userId, interval);
  }

  private stopPeriodicUpdates(userId: string) {
    const interval = this.updateIntervals.get(userId);
    if (interval) {
      clearInterval(interval);
      this.updateIntervals.delete(userId);
    }
  }

  private async sendAnalyticsUpdate(userId: string, filters?: any) {
    if (!this.io) return;

    try {
      const analyticsData = await RevenueAnalyticsService.getRevenueAnalytics(
        userId,
        filters || { timeframe: 'month' }
      );

      // Get real-time metrics
      const realtimeMetrics = await this.getRealtimeMetrics(userId);

      this.io.to(`analytics-${userId}`).emit('analytics-update', {
        type: 'periodic',
        data: analyticsData,
        realtimeMetrics,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error sending analytics update:', error);
    }
  }

  private async getRealtimeMetrics(userId: string) {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    try {
      // Get recent content analytics
      const recentAnalytics = await prisma.contentAnalytics.findMany({
        where: {
          content: {
            campaign: {
              userId
            }
          },
          recordedAt: {
            gte: oneHourAgo
          }
        },
        include: {
          content: {
            include: {
              campaign: {
                include: {
                  platform: true
                }
              }
            }
          }
        },
        orderBy: { recordedAt: 'desc' },
        take: 10
      });

      // Get active content (content being viewed in real-time)
      const activeContent = await this.getActiveContent(userId);

      // Calculate real-time metrics
      const realtimeViews = recentAnalytics.reduce(
        (sum, analytics) => sum + Number(analytics.views), 
        0
      );
      
      const realtimeRevenue = recentAnalytics.reduce(
        (sum, analytics) => sum + analytics.estimatedRevenue, 
        0
      );

      return {
        lastHour: {
          views: realtimeViews,
          revenue: realtimeRevenue,
          newContent: recentAnalytics.length
        },
        activeContent: activeContent,
        trending: await this.getTrendingContent(userId),
        alerts: await this.getRealtimeAlerts(userId)
      };

    } catch (error) {
      console.error('Error getting realtime metrics:', error);
      return {
        lastHour: { views: 0, revenue: 0, newContent: 0 },
        activeContent: [],
        trending: [],
        alerts: []
      };
    }
  }

  private async getActiveContent(userId: string) {
    // Get content published in the last 24 hours with recent activity
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return await prisma.publishedContent.findMany({
      where: {
        campaign: {
          userId
        },
        publishedAt: {
          gte: oneDayAgo
        }
      },
      include: {
        analytics: {
          orderBy: { recordedAt: 'desc' },
          take: 1
        },
        campaign: {
          include: {
            platform: true
          }
        }
      },
      orderBy: { publishedAt: 'desc' },
      take: 5
    });
  }

  private async getTrendingContent(userId: string) {
    // Get content with significant recent growth
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

    const recentAnalytics = await prisma.contentAnalytics.findMany({
      where: {
        content: {
          campaign: {
            userId
          }
        },
        recordedAt: {
          gte: sixHoursAgo
        }
      },
      include: {
        content: {
          include: {
            campaign: {
              include: {
                platform: true
              }
            }
          }
        }
      },
      orderBy: { views: 'desc' },
      take: 3
    });

    return recentAnalytics.map(analytics => ({
      id: analytics.content.id,
      title: analytics.content.title,
      platform: analytics.content.campaign.platform.name,
      views: Number(analytics.views),
      engagementRate: analytics.engagementRate,
      revenue: analytics.estimatedRevenue,
      trendScore: this.calculateTrendScore(analytics)
    }));
  }

  private calculateTrendScore(analytics: any): number {
    // Simple trend score based on views and engagement
    const views = Number(analytics.views);
    const engagement = analytics.engagementRate;
    
    return Math.min(100, (views / 1000) + (engagement * 10));
  }

  private async getRealtimeAlerts(userId: string) {
    const alerts = [];
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Check for viral content (high engagement in short time)
    const viralContent = await prisma.contentAnalytics.findMany({
      where: {
        content: {
          campaign: {
            userId
          }
        },
        recordedAt: {
          gte: oneHourAgo
        },
        engagementRate: {
          gte: 10.0 // High engagement threshold
        }
      },
      include: {
        content: true
      },
      take: 3
    });

    viralContent.forEach(content => {
      alerts.push({
        type: 'viral',
        title: 'Content Going Viral!',
        message: `"${content.content.title}" has ${content.engagementRate.toFixed(1)}% engagement`,
        contentId: content.content.id,
        severity: 'success'
      });
    });

    // Check for revenue spikes
    const recentRevenue = await prisma.contentAnalytics.aggregate({
      where: {
        content: {
          campaign: {
            userId
          }
        },
        recordedAt: {
          gte: oneHourAgo
        }
      },
      _sum: {
        estimatedRevenue: true
      }
    });

    if ((recentRevenue._sum.estimatedRevenue || 0) > 50) { // $50 in last hour
      alerts.push({
        type: 'revenue',
        title: 'Revenue Spike Detected!',
        message: `$${recentRevenue._sum.estimatedRevenue?.toFixed(2)} earned in the last hour`,
        severity: 'info'
      });
    }

    // Check for underperforming content
    const underperforming = await prisma.publishedContent.findMany({
      where: {
        campaign: {
          userId
        },
        publishedAt: {
          gte: new Date(Date.now() - 4 * 60 * 60 * 1000), // Last 4 hours
          lte: new Date(Date.now() - 2 * 60 * 60 * 1000)  // At least 2 hours old
        }
      },
      include: {
        analytics: {
          orderBy: { recordedAt: 'desc' },
          take: 1
        }
      }
    });

    underperforming.forEach(content => {
      const analytics = content.analytics[0];
      if (analytics && Number(analytics.views) < 100) {
        alerts.push({
          type: 'warning',
          title: 'Low Performance Alert',
          message: `"${content.title}" has only ${analytics.views} views after 2+ hours`,
          contentId: content.id,
          severity: 'warning'
        });
      }
    });

    return alerts;
  }

  // Public method to trigger manual updates
  async triggerAnalyticsUpdate(userId: string, filters?: any) {
    if (this.userSubscriptions.has(userId)) {
      await this.sendAnalyticsUpdate(userId, filters);
    }
  }

  // Public method to send custom analytics events
  async sendCustomAnalyticsEvent(userId: string, event: any) {
    if (!this.io) return;

    this.io.to(`analytics-${userId}`).emit('analytics-event', {
      ...event,
      timestamp: new Date().toISOString()
    });
  }

  // Cleanup method
  cleanup() {
    this.updateIntervals.forEach(interval => clearInterval(interval));
    this.updateIntervals.clear();
    this.userSubscriptions.clear();
  }
}

export default RealTimeAnalyticsService;