export interface CaptionOptimizationOptions {
  platform: string;
  contentType?: 'shorts' | 'reels' | 'story' | 'post' | 'tweet' | 'thread';
  tone?: 'professional' | 'casual' | 'engaging' | 'humorous' | 'inspirational';
  includeHashtags?: boolean;
  includeMentions?: boolean;
  includeCallToAction?: boolean;
  targetAudience?: string;
  maxLength?: number;
  language?: string;
}

export interface OptimizedCaption {
  title: string;
  description?: string;
  hashtags: string[];
  mentions: string[];
  callToAction?: string;
  totalLength: number;
  platform: string;
  variations?: OptimizedCaption[];
}

export class CaptionOptimizationService {
  private platformLimits = {
    youtube: { title: 100, description: 5000, hashtags: 30 },
    tiktok: { title: 2200, description: 2200, hashtags: 100 },
    instagram: { title: 2200, description: 2200, hashtags: 30 },
    twitter: { title: 280, description: 280, hashtags: 10 }
  };

  // Main caption optimization method
  async optimizeCaption(
    originalTitle: string,
    originalDescription?: string,
    options: CaptionOptimizationOptions = { platform: 'youtube' }
  ): Promise<OptimizedCaption> {
    const limits = this.platformLimits[options.platform] || this.platformLimits.youtube;
    
    // Optimize title
    const optimizedTitle = await this.optimizeTitle(originalTitle, options, limits);
    
    // Optimize description
    const optimizedDescription = originalDescription 
      ? await this.optimizeDescription(originalDescription, options, limits)
      : undefined;

    // Generate hashtags
    const hashtags = options.includeHashtags 
      ? await this.generateOptimizedHashtags(
          originalTitle + ' ' + (originalDescription || ''),
          options
        )
      : [];

    // Generate mentions
    const mentions = options.includeMentions 
      ? await this.generateRelevantMentions(
          originalTitle + ' ' + (originalDescription || ''),
          options
        )
      : [];

    // Generate call to action
    const callToAction = options.includeCallToAction 
      ? this.generateCallToAction(options)
      : undefined;

    // Calculate total length
    const totalContent = [
      optimizedTitle,
      optimizedDescription,
      hashtags.join(' '),
      mentions.join(' '),
      callToAction
    ].filter(Boolean).join(' ');

    const result: OptimizedCaption = {
      title: optimizedTitle,
      description: optimizedDescription,
      hashtags,
      mentions,
      callToAction,
      totalLength: totalContent.length,
      platform: options.platform
    };

    // Generate variations if needed
    if (options.tone !== 'professional') {
      result.variations = await this.generateCaptionVariations(result, options);
    }

    return result;
  }

  // Platform-specific optimization
  async optimizeForMultiplePlatforms(
    originalTitle: string,
    originalDescription?: string,
    platforms: string[] = ['youtube', 'tiktok', 'instagram', 'twitter']
  ): Promise<{ [platform: string]: OptimizedCaption }> {
    const results: { [platform: string]: OptimizedCaption } = {};

    for (const platform of platforms) {
      const options: CaptionOptimizationOptions = {
        platform,
        tone: 'engaging',
        includeHashtags: true,
        includeCallToAction: true
      };

      results[platform] = await this.optimizeCaption(
        originalTitle,
        originalDescription,
        options
      );
    }

    return results;
  }

  private async optimizeTitle(
    title: string,
    options: CaptionOptimizationOptions,
    limits: any
  ): Promise<string> {
    let optimizedTitle = title.trim();

    // Platform-specific title optimization
    switch (options.platform) {
      case 'youtube':
        optimizedTitle = this.optimizeYouTubeTitle(optimizedTitle, options);
        break;
      case 'tiktok':
        optimizedTitle = this.optimizeTikTokTitle(optimizedTitle, options);
        break;
      case 'instagram':
        optimizedTitle = this.optimizeInstagramTitle(optimizedTitle, options);
        break;
      case 'twitter':
        optimizedTitle = this.optimizeTwitterTitle(optimizedTitle, options);
        break;
    }

    // Apply tone adjustments
    optimizedTitle = this.applyTone(optimizedTitle, options.tone || 'engaging');

    // Ensure it fits within platform limits
    if (optimizedTitle.length > limits.title) {
      optimizedTitle = this.truncateWithEllipsis(optimizedTitle, limits.title);
    }

    return optimizedTitle;
  }

  private optimizeYouTubeTitle(title: string, options: CaptionOptimizationOptions): string {
    // YouTube title optimization strategies
    let optimized = title;

    // Add keywords for discoverability
    if (!optimized.toLowerCase().includes('how to') && this.isHowToContent(title)) {
      optimized = 'How to ' + optimized;
    }

    // Add numbers for better click-through
    if (this.shouldAddNumber(optimized)) {
      optimized = this.addEngagingNumber(optimized);
    }

    // Add year if relevant
    const currentYear = new Date().getFullYear();
    if (!optimized.includes(currentYear.toString()) && this.isTimeRelevant(optimized)) {
      optimized += ` (${currentYear})`;
    }

    return optimized;
  }

  private optimizeTikTokTitle(title: string, options: CaptionOptimizationOptions): string {
    let optimized = title;

    // TikTok prefers short, punchy titles
    if (optimized.length > 50) {
      optimized = this.makePunchy(optimized);
    }

    // Add engaging hooks
    const hooks = ['POV:', 'Wait for it...', 'This is crazy!', 'You won\'t believe...'];
    if (!this.hasEngagingHook(optimized)) {
      const randomHook = hooks[Math.floor(Math.random() * hooks.length)];
      optimized = `${randomHook} ${optimized}`;
    }

    return optimized;
  }

  private optimizeInstagramTitle(title: string, options: CaptionOptimizationOptions): string {
    let optimized = title;

    // Instagram likes emojis and line breaks for readability
    optimized = this.addRelevantEmojis(optimized);

    // Make it more conversational
    if (!this.isConversational(optimized)) {
      optimized = this.makeConversational(optimized);
    }

    return optimized;
  }

  private optimizeTwitterTitle(title: string, options: CaptionOptimizationOptions): string {
    let optimized = title;

    // Twitter needs to be concise
    if (optimized.length > 200) {
      optimized = this.makeTwitterFriendly(optimized);
    }

    // Add thread indicator if it's part of a thread
    if (options.contentType === 'thread') {
      optimized += ' 🧵';
    }

    return optimized;
  }

  private async optimizeDescription(
    description: string,
    options: CaptionOptimizationOptions,
    limits: any
  ): Promise<string> {
    let optimized = description.trim();

    // Platform-specific description optimization
    switch (options.platform) {
      case 'youtube':
        optimized = this.optimizeYouTubeDescription(optimized);
        break;
      case 'tiktok':
        optimized = this.optimizeTikTokDescription(optimized);
        break;
      case 'instagram':
        optimized = this.optimizeInstagramDescription(optimized);
        break;
      case 'twitter':
        // Twitter doesn't really have descriptions, merge with title
        return '';
    }

    // Ensure it fits within limits
    if (optimized.length > limits.description) {
      optimized = this.truncateWithEllipsis(optimized, limits.description);
    }

    return optimized;
  }

  private async generateOptimizedHashtags(
    content: string,
    options: CaptionOptimizationOptions
  ): Promise<string[]> {
    const hashtags: string[] = [];
    const limits = this.platformLimits[options.platform];

    // Extract topic keywords from content
    const keywords = this.extractKeywords(content);
    
    // Add platform-specific hashtags
    const platformHashtags = this.getPlatformSpecificHashtags(options.platform, options.contentType);
    hashtags.push(...platformHashtags);

    // Add topic-based hashtags
    for (const keyword of keywords) {
      if (hashtags.length >= Math.min(limits.hashtags, 10)) break;
      hashtags.push(`#${this.normalizeHashtag(keyword)}`);
    }

    // Add trending hashtags
    const trending = await this.getTrendingHashtagsForPlatform(options.platform);
    for (const tag of trending) {
      if (hashtags.length >= limits.hashtags) break;
      if (!hashtags.includes(tag)) {
        hashtags.push(tag);
      }
    }

    return hashtags.slice(0, limits.hashtags);
  }

  private async generateRelevantMentions(
    content: string,
    options: CaptionOptimizationOptions
  ): Promise<string[]> {
    // This would typically connect to a database of relevant accounts
    // For now, return empty array
    return [];
  }

  private generateCallToAction(options: CaptionOptimizationOptions): string {
    const ctas = {
      youtube: [
        'Don\'t forget to like and subscribe!',
        'What do you think? Let me know in the comments!',
        'Subscribe for more videos like this!',
        'Hit the notification bell to never miss a video!'
      ],
      tiktok: [
        'Follow for more! 🔥',
        'Double tap if you agree! ❤️',
        'Save this for later! 💾',
        'Share with your friends! 📱'
      ],
      instagram: [
        'Save this post for later! 💾',
        'Tag someone who needs to see this! 👇',
        'Follow for more content like this! ✨',
        'What\'s your experience? Share in the comments! 💬'
      ],
      twitter: [
        'Retweet if you found this helpful! 🔄',
        'What are your thoughts? Reply below! 💭',
        'Follow me for more insights! 🚀',
        'Share your experience in the replies! 📝'
      ]
    };

    const platformCTAs = ctas[options.platform] || ctas.youtube;
    return platformCTAs[Math.floor(Math.random() * platformCTAs.length)];
  }

  private async generateCaptionVariations(
    baseCaption: OptimizedCaption,
    options: CaptionOptimizationOptions
  ): Promise<OptimizedCaption[]> {
    const variations: OptimizedCaption[] = [];
    const tones = ['professional', 'casual', 'humorous', 'inspirational'];

    for (const tone of tones) {
      if (tone === options.tone) continue;

      const variationOptions = { ...options, tone };
      const variation = await this.optimizeCaption(
        baseCaption.title,
        baseCaption.description,
        variationOptions
      );
      variations.push(variation);
    }

    return variations;
  }

  // Utility methods
  private applyTone(text: string, tone: string): string {
    switch (tone) {
      case 'professional':
        return this.makeProfessional(text);
      case 'casual':
        return this.makeCasual(text);
      case 'humorous':
        return this.makeHumorous(text);
      case 'inspirational':
        return this.makeInspirational(text);
      default:
        return text;
    }
  }

  private makeProfessional(text: string): string {
    return text
      .replace(/!/g, '.')
      .replace(/\bemojis?\b/gi, '')
      .replace(/\bawesome\b/gi, 'excellent')
      .replace(/\bcool\b/gi, 'impressive');
  }

  private makeCasual(text: string): string {
    return text
      .replace(/\bexcellent\b/gi, 'awesome')
      .replace(/\bimpressive\b/gi, 'cool')
      + (text.includes('!') ? '' : '!');
  }

  private makeHumorous(text: string): string {
    const funnyWords = ['epic', 'hilarious', 'mind-blowing', 'incredible'];
    const randomWord = funnyWords[Math.floor(Math.random() * funnyWords.length)];
    return `${randomWord} ${text.toLowerCase()}`;
  }

  private makeInspirational(text: string): string {
    const inspirationalWords = ['Transform', 'Discover', 'Achieve', 'Master'];
    const randomWord = inspirationalWords[Math.floor(Math.random() * inspirationalWords.length)];
    return `${randomWord} ${text}`;
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction - would be enhanced with NLP
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !this.isStopWord(word));

    return [...new Set(words)].slice(0, 10);
  }

  private isStopWord(word: string): boolean {
    const stopWords = ['that', 'with', 'have', 'this', 'will', 'your', 'from', 'they', 'know', 'want', 'been', 'good', 'much', 'some', 'time', 'very', 'when', 'come', 'here', 'just', 'like', 'long', 'make', 'many', 'over', 'such', 'take', 'than', 'them', 'well', 'were'];
    return stopWords.includes(word.toLowerCase());
  }

  private getPlatformSpecificHashtags(platform: string, contentType?: string): string[] {
    const baseHashtags = {
      youtube: ['#YouTube', '#Video', '#Content'],
      tiktok: ['#TikTok', '#Viral', '#ForYou'],
      instagram: ['#Instagram', '#Reels', '#Content'],
      twitter: ['#Twitter', '#Thread', '#Content']
    };

    const contentHashtags = {
      shorts: ['#Shorts', '#Short'],
      reels: ['#Reels', '#Reel'],
      story: ['#Story', '#Stories'],
      post: ['#Post'],
      tweet: ['#Tweet'],
      thread: ['#Thread']
    };

    const result = baseHashtags[platform] || [];
    if (contentType && contentHashtags[contentType]) {
      result.push(...contentHashtags[contentType]);
    }

    return result;
  }

  private async getTrendingHashtagsForPlatform(platform: string): Promise<string[]> {
    // This would connect to trending APIs
    // For now, return some common trending hashtags
    const trending = {
      youtube: ['#Trending', '#Viral', '#MustWatch'],
      tiktok: ['#FYP', '#Viral', '#Trending'],
      instagram: ['#Explore', '#Viral', '#Trending'],
      twitter: ['#Trending', '#Viral', '#Breaking']
    };

    return trending[platform] || [];
  }

  private normalizeHashtag(word: string): string {
    return word.replace(/[^\w]/g, '').toLowerCase();
  }

  private truncateWithEllipsis(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  private isHowToContent(title: string): boolean {
    const howToIndicators = ['step', 'guide', 'tutorial', 'learn', 'method', 'way to'];
    return howToIndicators.some(indicator => 
      title.toLowerCase().includes(indicator)
    );
  }

  private shouldAddNumber(title: string): boolean {
    return !(/\d/.test(title)) && title.length < 70;
  }

  private addEngagingNumber(title: string): string {
    const numbers = ['5 Ways to', '10 Tips for', '3 Simple Steps to', '7 Secrets to'];
    const randomNumber = numbers[Math.floor(Math.random() * numbers.length)];
    return `${randomNumber} ${title}`;
  }

  private isTimeRelevant(title: string): boolean {
    const timeRelevant = ['guide', 'tips', 'best', 'new', 'latest', 'update'];
    return timeRelevant.some(word => title.toLowerCase().includes(word));
  }

  private makePunchy(title: string): string {
    const sentences = title.split(/[.!?]+/);
    return sentences[0].trim() + (sentences[0].includes('!') ? '' : '!');
  }

  private hasEngagingHook(title: string): boolean {
    const hooks = ['pov', 'wait', 'this is', 'you won', 'watch', 'see'];
    return hooks.some(hook => title.toLowerCase().includes(hook));
  }

  private addRelevantEmojis(text: string): string {
    const emojiMap = {
      'video': '🎥',
      'music': '🎵',
      'food': '🍕',
      'travel': '✈️',
      'fitness': '💪',
      'love': '❤️',
      'happy': '😊',
      'fire': '🔥',
      'amazing': '✨'
    };

    let result = text;
    for (const [word, emoji] of Object.entries(emojiMap)) {
      if (text.toLowerCase().includes(word) && !text.includes(emoji)) {
        result = result.replace(new RegExp(word, 'gi'), `${word} ${emoji}`);
        break; // Add only one emoji to avoid clutter
      }
    }

    return result;
  }

  private isConversational(text: string): boolean {
    const conversationalWords = ['you', 'your', 'we', 'us', 'our', 'what', 'how', 'why'];
    return conversationalWords.some(word => text.toLowerCase().includes(word));
  }

  private makeConversational(text: string): string {
    const starters = ['Have you ever', 'What if', 'Imagine if', 'Did you know'];
    const randomStarter = starters[Math.floor(Math.random() * starters.length)];
    return `${randomStarter} ${text.toLowerCase()}?`;
  }

  private makeTwitterFriendly(text: string): string {
    const sentences = text.split(/[.!?]+/);
    return sentences[0].trim();
  }

  private optimizeYouTubeDescription(description: string): string {
    // Add timestamps, links, and other YouTube-specific elements
    return description + '\n\n⏰ Timestamps:\n0:00 Introduction\n\n🔗 Links:\n• Subscribe for more content';
  }

  private optimizeTikTokDescription(description: string): string {
    // Keep it short and engaging for TikTok
    return description.split('.')[0] + '! 🔥';
  }

  private optimizeInstagramDescription(description: string): string {
    // Add line breaks and structure for Instagram
    return description.replace(/\. /g, '.\n\n') + '\n\n💭 What do you think?';
  }
}