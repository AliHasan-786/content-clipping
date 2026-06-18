import { prisma } from '../prisma';
import cron from 'node-cron';
import { publishingQueue } from './publishing-queue';

export interface OptimalTimingAnalysis {
  platform: string;
  accountId: string;
  bestTimes: {
    dayOfWeek: number; // 0 = Sunday, 6 = Saturday
    hour: number; // 0-23
    score: number; // 0-1, higher is better
    timezone: string;
  }[];
  averageEngagement: number;
  lastAnalyzed: Date;
  dataPoints: number; // Number of posts analyzed
}

export interface SchedulingRecommendation {
  recommendedTime: Date;
  score: number;
  reasoning: string[];
  alternatives: Array<{
    time: Date;
    score: number;
    reason: string;
  }>;
}

export interface SchedulingOptions {
  accountId?: string;
  platform?: string;
  timezone?: string;
  contentType?: 'video' | 'image' | 'story' | 'shorts';
  audienceRegion?: string;
  priority?: 'reach' | 'engagement' | 'conversions';
  blackoutPeriods?: Array<{
    start: Date;
    end: Date;
    reason?: string;
  }>;
  preferredDays?: number[]; // Array of day numbers (0-6)
  preferredHours?: number[]; // Array of hours (0-23)
}

export class SchedulingService {
  private analysisCache = new Map<string, OptimalTimingAnalysis>();
  private cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.initializeScheduler();
  }

  // Get optimal posting time for a specific account/platform
  async getOptimalPostingTime(
    options: SchedulingOptions
  ): Promise<SchedulingRecommendation> {
    try {
      // Get timing analysis for the account/platform
      const timingAnalysis = await this.getTimingAnalysis(options);
      
      // Calculate recommended time
      const now = new Date();
      const timezone = options.timezone || 'UTC';
      
      // Find next best time slot
      const bestTime = this.calculateNextBestTime(
        now,
        timingAnalysis.bestTimes,
        options,
        timezone
      );

      // Generate alternatives
      const alternatives = this.generateTimeAlternatives(
        bestTime.time,
        timingAnalysis.bestTimes,
        options,
        timezone
      );

      return {
        recommendedTime: bestTime.time,
        score: bestTime.score,
        reasoning: bestTime.reasoning,
        alternatives
      };

    } catch (error) {
      console.error('Error getting optimal posting time:', error);
      
      // Return fallback recommendation
      return this.getFallbackRecommendation(options);
    }
  }

  // Analyze posting patterns and update optimal times
  async analyzePostingPatterns(
    accountId: string,
    lookbackDays = 30
  ): Promise<OptimalTimingAnalysis> {
    try {
      const account = await prisma.platformAccount.findUnique({
        where: { id: accountId },
        include: { 
          platform: true,
          publishedContent: {
            where: {
              publishedAt: {
                gte: new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
              }
            },
            include: {
              analytics: true
            }
          }
        }
      });

      if (!account) {
        throw new Error('Account not found');
      }

      // Group posts by day of week and hour
      const timeSlots = new Map<string, {
        totalPosts: number;
        totalEngagement: number;
        totalViews: number;
        avgEngagement: number;
      }>();

      for (const content of account.publishedContent) {
        const publishedAt = new Date(content.publishedAt);
        const dayOfWeek = publishedAt.getUTCDay();
        const hour = publishedAt.getUTCHours();
        const key = `${dayOfWeek}-${hour}`;

        // Calculate engagement metrics
        const analytics = content.analytics[0]; // Most recent analytics
        const engagement = analytics ? 
          Number(analytics.likes) + Number(analytics.comments) + Number(analytics.shares) : 0;
        const views = analytics ? Number(analytics.views) : 0;

        if (!timeSlots.has(key)) {
          timeSlots.set(key, {
            totalPosts: 0,
            totalEngagement: 0,
            totalViews: 0,
            avgEngagement: 0
          });
        }

        const slot = timeSlots.get(key)!;
        slot.totalPosts += 1;
        slot.totalEngagement += engagement;
        slot.totalViews += views;
        slot.avgEngagement = slot.totalPosts > 0 ? 
          (slot.totalEngagement / slot.totalPosts) : 0;
      }

      // Convert to best times array
      const bestTimes = Array.from(timeSlots.entries())
        .map(([key, metrics]) => {
          const [dayOfWeek, hour] = key.split('-').map(Number);
          const engagementRate = metrics.totalViews > 0 ? 
            metrics.totalEngagement / metrics.totalViews : 0;
          
          return {
            dayOfWeek,
            hour,
            score: Math.min(1, engagementRate), // Normalize to 0-1
            timezone: 'UTC'
          };
        })
        .filter(time => time.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20); // Top 20 time slots

      // Calculate overall metrics
      const totalEngagement = Array.from(timeSlots.values())
        .reduce((sum, slot) => sum + slot.totalEngagement, 0);
      const totalPosts = account.publishedContent.length;
      const averageEngagement = totalPosts > 0 ? totalEngagement / totalPosts : 0;

      const analysis: OptimalTimingAnalysis = {
        platform: account.platform.name,
        accountId,
        bestTimes,
        averageEngagement,
        lastAnalyzed: new Date(),
        dataPoints: totalPosts
      };

      // Cache the analysis
      this.analysisCache.set(`${accountId}`, analysis);

      // Store in database for persistence
      await this.storeTimingAnalysis(analysis);

      return analysis;

    } catch (error) {
      console.error('Error analyzing posting patterns:', error);
      throw error;
    }
  }

  // Schedule content for optimal times
  async scheduleOptimalPosting(
    campaignId: string,
    options: SchedulingOptions & {
      numberOfPosts?: number;
      spreadOverDays?: number;
      startDate?: Date;
    }
  ): Promise<Date[]> {
    try {
      const recommendation = await this.getOptimalPostingTime(options);
      const numberOfPosts = options.numberOfPosts || 1;
      const spreadOverDays = options.spreadOverDays || 7;
      const startDate = options.startDate || new Date();

      const scheduledTimes: Date[] = [];

      if (numberOfPosts === 1) {
        // Single post - use the optimal time
        scheduledTimes.push(recommendation.recommendedTime);
      } else {
        // Multiple posts - spread them optimally
        const timingAnalysis = await this.getTimingAnalysis(options);
        const bestSlots = timingAnalysis.bestTimes.slice(0, numberOfPosts * 2);

        let currentDate = new Date(startDate);
        const endDate = new Date(currentDate.getTime() + spreadOverDays * 24 * 60 * 60 * 1000);

        for (let i = 0; i < numberOfPosts && currentDate <= endDate; i++) {
          const bestSlot = bestSlots[i % bestSlots.length];
          
          // Find next occurrence of this day/hour
          const nextTime = this.findNextOccurrence(
            currentDate,
            bestSlot.dayOfWeek,
            bestSlot.hour,
            options.timezone || 'UTC'
          );

          // Ensure minimum gap between posts (at least 2 hours)
          const lastScheduledTime = scheduledTimes[scheduledTimes.length - 1];
          if (lastScheduledTime) {
            const timeDiff = nextTime.getTime() - lastScheduledTime.getTime();
            if (timeDiff < 2 * 60 * 60 * 1000) { // Less than 2 hours
              nextTime.setTime(nextTime.getTime() + 2 * 60 * 60 * 1000);
            }
          }

          // Check blackout periods
          if (!this.isInBlackoutPeriod(nextTime, options.blackoutPeriods)) {
            scheduledTimes.push(nextTime);
            currentDate = new Date(nextTime.getTime() + 24 * 60 * 60 * 1000); // Move to next day
          } else {
            currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
            i--; // Retry this post on next iteration
          }
        }
      }

      // Schedule the jobs in the queue
      for (const scheduledTime of scheduledTimes) {
        await publishingQueue.addPublishingJob(
          {
            type: 'SCHEDULED_BATCH',
            campaignId,
            userId: '', // Will be filled from campaign data
          },
          {
            scheduledFor: scheduledTime,
            priority: 5
          }
        );
      }

      return scheduledTimes;

    } catch (error) {
      console.error('Error scheduling optimal posting:', error);
      throw error;
    }
  }

  // Get bulk recommendations for multiple accounts
  async getBulkRecommendations(
    requests: Array<{
      accountId: string;
      options: SchedulingOptions;
    }>
  ): Promise<Array<{
    accountId: string;
    recommendation: SchedulingRecommendation;
    error?: string;
  }>> {
    const results = await Promise.allSettled(
      requests.map(async request => {
        const recommendation = await this.getOptimalPostingTime({
          ...request.options,
          accountId: request.accountId
        });
        
        return {
          accountId: request.accountId,
          recommendation
        };
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          accountId: requests[index].accountId,
          recommendation: this.getFallbackRecommendation(requests[index].options),
          error: result.reason.message
        };
      }
    });
  }

  // Update optimal posting times for all accounts
  async updateAllOptimalTimes(): Promise<void> {
    try {
      console.log('Starting optimal times update for all accounts...');

      const accounts = await prisma.platformAccount.findMany({
        where: { isActive: true },
        select: { id: true }
      });

      // Process accounts in batches to avoid overwhelming the system
      const batchSize = 5;
      for (let i = 0; i < accounts.length; i += batchSize) {
        const batch = accounts.slice(i, i + batchSize);
        
        await Promise.allSettled(
          batch.map(account => this.analyzePostingPatterns(account.id))
        );

        // Small delay between batches
        if (i + batchSize < accounts.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`Updated optimal times for ${accounts.length} accounts`);

    } catch (error) {
      console.error('Error updating all optimal times:', error);
    }
  }

  // Private helper methods
  private async getTimingAnalysis(options: SchedulingOptions): Promise<OptimalTimingAnalysis> {
    const cacheKey = `${options.accountId || 'global'}-${options.platform || 'all'}`;
    
    // Check cache first
    const cached = this.analysisCache.get(cacheKey);
    if (cached && (Date.now() - cached.lastAnalyzed.getTime()) < this.cacheExpiry) {
      return cached;
    }

    // If account ID provided, analyze specific account
    if (options.accountId) {
      return await this.analyzePostingPatterns(options.accountId);
    }

    // Otherwise, get platform defaults
    return this.getPlatformDefaults(options.platform || 'youtube');
  }

  private calculateNextBestTime(
    from: Date,
    bestTimes: OptimalTimingAnalysis['bestTimes'],
    options: SchedulingOptions,
    timezone: string
  ): {
    time: Date;
    score: number;
    reasoning: string[];
  } {
    const reasoning: string[] = [];
    
    // Filter times based on preferences
    let filteredTimes = bestTimes;

    if (options.preferredDays?.length) {
      filteredTimes = filteredTimes.filter(time => 
        options.preferredDays!.includes(time.dayOfWeek)
      );
      reasoning.push(`Filtered to preferred days: ${options.preferredDays.map(d => this.getDayName(d)).join(', ')}`);
    }

    if (options.preferredHours?.length) {
      filteredTimes = filteredTimes.filter(time => 
        options.preferredHours!.includes(time.hour)
      );
      reasoning.push(`Filtered to preferred hours: ${options.preferredHours.join(', ')}`);
    }

    // If no times left after filtering, use original list
    if (filteredTimes.length === 0) {
      filteredTimes = bestTimes;
      reasoning.push('No times matched preferences, using all available times');
    }

    // Find next occurrence of best time
    const bestTime = filteredTimes[0];
    const nextTime = this.findNextOccurrence(
      from,
      bestTime.dayOfWeek,
      bestTime.hour,
      timezone
    );

    reasoning.push(`Selected based on highest engagement score: ${(bestTime.score * 100).toFixed(1)}%`);
    reasoning.push(`Day: ${this.getDayName(bestTime.dayOfWeek)}, Hour: ${bestTime.hour}:00`);

    return {
      time: nextTime,
      score: bestTime.score,
      reasoning
    };
  }

  private generateTimeAlternatives(
    primaryTime: Date,
    bestTimes: OptimalTimingAnalysis['bestTimes'],
    options: SchedulingOptions,
    timezone: string
  ): Array<{ time: Date; score: number; reason: string }> {
    const alternatives: Array<{ time: Date; score: number; reason: string }> = [];
    
    // Get next 3 best times after the primary
    for (let i = 1; i < Math.min(4, bestTimes.length); i++) {
      const timeSlot = bestTimes[i];
      const nextTime = this.findNextOccurrence(
        primaryTime,
        timeSlot.dayOfWeek,
        timeSlot.hour,
        timezone
      );

      alternatives.push({
        time: nextTime,
        score: timeSlot.score,
        reason: `Alternative ${i}: ${this.getDayName(timeSlot.dayOfWeek)} at ${timeSlot.hour}:00`
      });
    }

    // Add same day alternative (different hour)
    const sameDay = bestTimes.find(time => 
      time.dayOfWeek === primaryTime.getDay() && 
      time.hour !== primaryTime.getHours()
    );

    if (sameDay) {
      const sameDayTime = new Date(primaryTime);
      sameDayTime.setHours(sameDay.hour, 0, 0, 0);
      
      if (sameDayTime > primaryTime) {
        alternatives.push({
          time: sameDayTime,
          score: sameDay.score,
          reason: `Same day alternative: ${sameDay.hour}:00`
        });
      }
    }

    return alternatives.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  private findNextOccurrence(
    from: Date,
    targetDayOfWeek: number,
    targetHour: number,
    timezone: string
  ): Date {
    const result = new Date(from);
    
    // Adjust for timezone (simplified - in production, use proper timezone library)
    // For now, assume UTC
    
    // Set target hour
    result.setUTCHours(targetHour, 0, 0, 0);
    
    // If target time is in the past today, or we need a different day
    if (result <= from || result.getUTCDay() !== targetDayOfWeek) {
      // Calculate days to add
      const currentDay = result.getUTCDay();
      const daysToAdd = targetDayOfWeek >= currentDay 
        ? targetDayOfWeek - currentDay
        : 7 - currentDay + targetDayOfWeek;
      
      result.setUTCDate(result.getUTCDate() + daysToAdd);
      result.setUTCHours(targetHour, 0, 0, 0);
    }

    return result;
  }

  private isInBlackoutPeriod(
    time: Date,
    blackoutPeriods?: SchedulingOptions['blackoutPeriods']
  ): boolean {
    if (!blackoutPeriods) return false;
    
    return blackoutPeriods.some(period => 
      time >= period.start && time <= period.end
    );
  }

  private getPlatformDefaults(platform: string): OptimalTimingAnalysis {
    const defaults = {
      youtube: {
        bestTimes: [
          { dayOfWeek: 1, hour: 14, score: 0.9, timezone: 'UTC' }, // Monday 2 PM
          { dayOfWeek: 2, hour: 15, score: 0.85, timezone: 'UTC' }, // Tuesday 3 PM
          { dayOfWeek: 3, hour: 14, score: 0.8, timezone: 'UTC' }, // Wednesday 2 PM
          { dayOfWeek: 4, hour: 15, score: 0.85, timezone: 'UTC' }, // Thursday 3 PM
          { dayOfWeek: 5, hour: 16, score: 0.75, timezone: 'UTC' }, // Friday 4 PM
        ],
        averageEngagement: 0.05
      },
      tiktok: {
        bestTimes: [
          { dayOfWeek: 2, hour: 18, score: 0.95, timezone: 'UTC' }, // Tuesday 6 PM
          { dayOfWeek: 4, hour: 19, score: 0.9, timezone: 'UTC' }, // Thursday 7 PM
          { dayOfWeek: 0, hour: 19, score: 0.85, timezone: 'UTC' }, // Sunday 7 PM
          { dayOfWeek: 1, hour: 18, score: 0.8, timezone: 'UTC' }, // Monday 6 PM
          { dayOfWeek: 5, hour: 17, score: 0.85, timezone: 'UTC' }, // Friday 5 PM
        ],
        averageEngagement: 0.08
      },
      instagram: {
        bestTimes: [
          { dayOfWeek: 2, hour: 11, score: 0.9, timezone: 'UTC' }, // Tuesday 11 AM
          { dayOfWeek: 2, hour: 13, score: 0.85, timezone: 'UTC' }, // Tuesday 1 PM
          { dayOfWeek: 3, hour: 11, score: 0.8, timezone: 'UTC' }, // Wednesday 11 AM
          { dayOfWeek: 4, hour: 11, score: 0.85, timezone: 'UTC' }, // Thursday 11 AM
          { dayOfWeek: 5, hour: 13, score: 0.75, timezone: 'UTC' }, // Friday 1 PM
        ],
        averageEngagement: 0.06
      },
      twitter: {
        bestTimes: [
          { dayOfWeek: 2, hour: 9, score: 0.85, timezone: 'UTC' }, // Tuesday 9 AM
          { dayOfWeek: 3, hour: 9, score: 0.8, timezone: 'UTC' }, // Wednesday 9 AM
          { dayOfWeek: 1, hour: 8, score: 0.75, timezone: 'UTC' }, // Monday 8 AM
          { dayOfWeek: 4, hour: 10, score: 0.8, timezone: 'UTC' }, // Thursday 10 AM
          { dayOfWeek: 5, hour: 8, score: 0.7, timezone: 'UTC' }, // Friday 8 AM
        ],
        averageEngagement: 0.04
      }
    };

    const platformData = defaults[platform] || defaults.youtube;
    
    return {
      platform,
      accountId: 'default',
      bestTimes: platformData.bestTimes,
      averageEngagement: platformData.averageEngagement,
      lastAnalyzed: new Date(),
      dataPoints: 0
    };
  }

  private getFallbackRecommendation(options: SchedulingOptions): SchedulingRecommendation {
    const now = new Date();
    const fallbackTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
    
    return {
      recommendedTime: fallbackTime,
      score: 0.5,
      reasoning: ['Using fallback recommendation due to insufficient data'],
      alternatives: []
    };
  }

  private getDayName(dayOfWeek: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayOfWeek] || 'Unknown';
  }

  private async storeTimingAnalysis(analysis: OptimalTimingAnalysis): Promise<void> {
    try {
      // Store timing analysis in OptimalPostingTime table
      await Promise.all(
        analysis.bestTimes.map(timeSlot =>
          prisma.optimalPostingTime.upsert({
            where: {
              accountId_dayOfWeek_hour: {
                accountId: analysis.accountId,
                dayOfWeek: timeSlot.dayOfWeek,
                hour: timeSlot.hour
              }
            },
            update: {
              timezone: timeSlot.timezone,
              engagementScore: timeSlot.score,
              lastCalculated: analysis.lastAnalyzed
            },
            create: {
              accountId: analysis.accountId,
              dayOfWeek: timeSlot.dayOfWeek,
              hour: timeSlot.hour,
              timezone: timeSlot.timezone,
              engagementScore: timeSlot.score,
              lastCalculated: analysis.lastAnalyzed
            }
          })
        )
      );
    } catch (error) {
      console.error('Error storing timing analysis:', error);
    }
  }

  private initializeScheduler(): void {
    // Schedule analysis updates
    // Run every day at 2 AM UTC
    cron.schedule('0 2 * * *', () => {
      console.log('Running scheduled optimal times update...');
      this.updateAllOptimalTimes().catch(error => {
        console.error('Scheduled analysis failed:', error);
      });
    });

    console.log('Scheduling service initialized with cron jobs');
  }
}