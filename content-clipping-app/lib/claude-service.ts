import Anthropic from '@anthropic-ai/sdk';
import { 
  ChatContext, 
  ChatMessage, 
  ChatAction, 
  ChatActionType, 
  NLCommand,
  Video,
  Clip 
} from '../types';

export interface ClaudeConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export class ClaudeService {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: ClaudeConfig = {}) {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    
    if (!apiKey) {
      throw new Error('Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable.');
    }

    this.client = new Anthropic({
      apiKey: apiKey,
    });

    this.model = config.model || 'claude-3-5-sonnet-20241022';
    this.maxTokens = config.maxTokens || 2048;
    this.temperature = config.temperature || 0.7;
  }

  /**
   * Generate a response to a user message with context awareness
   */
  async generateResponse(
    userMessage: string,
    context: ChatContext,
    conversationHistory: ChatMessage[] = []
  ): Promise<{
    response: string;
    actions: ChatAction[];
    thinking?: string;
  }> {
    try {
      const systemPrompt = this.buildSystemPrompt(context);
      const messages = this.buildMessageHistory(conversationHistory, userMessage);

      console.log('Sending request to Claude with context:', {
        currentVideo: context.currentVideo?.title,
        selectedClips: context.selectedClips?.length,
        messageCount: messages.length
      });

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        system: systemPrompt,
        messages: messages
      });

      const content = response.content[0];
      
      if (content.type !== 'text') {
        throw new Error('Expected text response from Claude');
      }

      const responseText = content.text;
      
      // Parse the response to extract actions and thinking
      const parsed = this.parseClaudeResponse(responseText);
      
      return {
        response: parsed.message,
        actions: parsed.actions,
        thinking: parsed.thinking
      };

    } catch (error) {
      console.error('Error generating Claude response:', error);
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  /**
   * Parse natural language into actionable commands
   */
  async parseNaturalLanguageCommand(
    userMessage: string,
    context: ChatContext
  ): Promise<NLCommand[]> {
    try {
      const systemPrompt = `You are an expert at parsing natural language commands for video editing tasks.

AVAILABLE ACTIONS:
- find_clips: Search for clips based on criteria
- generate_clips: Create new clips from video
- edit_clip: Modify existing clips
- export_clips: Export clips in specific formats
- analyze_video: Analyze video content
- suggest_improvements: Provide optimization suggestions
- create_highlights: Generate highlight reels
- adjust_captions: Modify captions or text
- change_format: Convert video formats

Parse the user's message and extract the intent and entities. Return a JSON response with this format:
{
  "commands": [
    {
      "intent": "action_name",
      "entities": { "key": "value" },
      "confidence": 0.95,
      "originalText": "user message"
    }
  ]
}

Current context:
${context.currentVideo ? `- Working on video: "${context.currentVideo.title}" (${context.currentVideo.duration}s)` : '- No video selected'}
${context.selectedClips?.length ? `- Selected clips: ${context.selectedClips.length}` : '- No clips selected'}
${context.currentVideo?.clips?.length ? `- Available clips: ${context.currentVideo.clips.length}` : '- No clips generated yet'}

Examples:
"Find clips with strong hooks" → {"intent": "find_clips", "entities": {"criteria": "strong hooks"}}
"Export these 3 clips to TikTok format" → {"intent": "export_clips", "entities": {"count": 3, "format": "TikTok"}}
"Make this clip more engaging" → {"intent": "suggest_improvements", "entities": {"target": "engagement"}}`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: userMessage
        }]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Expected text response from Claude');
      }

      const parsed = JSON.parse(content.text);
      return parsed.commands || [];

    } catch (error) {
      console.error('Error parsing natural language command:', error);
      return [{
        intent: 'analyze_video' as ChatActionType,
        entities: { query: userMessage },
        confidence: 0.5,
        originalText: userMessage
      }];
    }
  }

  /**
   * Build system prompt with current context
   */
  private buildSystemPrompt(context: ChatContext): string {
    let prompt = `You are Claude, an AI assistant specializing in video editing and content creation. You help users edit videos, create clips, and optimize content for social media platforms.

CAPABILITIES:
- Analyze videos and suggest improvements
- Find and generate video clips based on criteria
- Edit clips (timing, captions, format)
- Export content for different platforms (TikTok, Instagram, YouTube)
- Provide creative suggestions for engagement

CURRENT CONTEXT:`;

    if (context.currentVideo) {
      prompt += `
- Video: "${context.currentVideo.title}"
- Duration: ${context.currentVideo.duration} seconds
- Processing Stage: ${context.currentVideo.processingStage}`;
      
      if (context.currentVideo.clips && context.currentVideo.clips.length > 0) {
        prompt += `
- Available Clips: ${context.currentVideo.clips.length}`;
        context.currentVideo.clips.forEach((clip, index) => {
          prompt += `
  ${index + 1}. "${clip.title}" (${clip.startTime}s - ${clip.endTime}s)`;
          if (clip.score) {
            prompt += ` - Score: ${clip.score.toFixed(2)}`;
          }
        });
      }
      
      if (context.currentVideo.transcription) {
        prompt += `
- Transcription available: ${context.currentVideo.transcription.substring(0, 200)}...`;
      }
    } else {
      prompt += `
- No video currently loaded`;
    }

    if (context.selectedClips && context.selectedClips.length > 0) {
      prompt += `
- Selected Clips: ${context.selectedClips.length}`;
    }

    if (context.preferences) {
      prompt += `
- User Preferences: ${JSON.stringify(context.preferences)}`;
    }

    prompt += `

RESPONSE FORMAT:
Always respond in a helpful, friendly manner. When you identify actions to take, format your response like this:

<thinking>
Your analysis of what the user wants and how to help them
</thinking>

Your conversational response to the user.

<actions>
[
  {
    "type": "action_name",
    "parameters": {"key": "value"},
    "description": "What this action will do"
  }
]
</actions>

GUIDELINES:
- Be conversational and helpful
- Always explain what you're going to do
- Ask for clarification if the request is ambiguous
- Provide specific, actionable suggestions
- Consider the user's context and preferences
- Keep responses concise but informative`;

    return prompt;
  }

  /**
   * Build message history for Claude API
   */
  private buildMessageHistory(
    history: ChatMessage[],
    currentMessage: string
  ): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];
    
    // Add recent conversation history (last 10 messages to stay within token limits)
    const recentHistory = history.slice(-10);
    
    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      });
    }
    
    // Add current message
    messages.push({
      role: 'user',
      content: currentMessage
    });
    
    return messages;
  }

  /**
   * Parse Claude's response to extract actions and thinking
   */
  private parseClaudeResponse(responseText: string): {
    message: string;
    actions: ChatAction[];
    thinking?: string;
  } {
    let message = responseText;
    let actions: ChatAction[] = [];
    let thinking: string | undefined;

    // Extract thinking section
    const thinkingMatch = responseText.match(/<thinking>([\s\S]*?)<\/thinking>/);
    if (thinkingMatch) {
      thinking = thinkingMatch[1].trim();
      message = message.replace(thinkingMatch[0], '').trim();
    }

    // Extract actions section
    const actionsMatch = responseText.match(/<actions>([\s\S]*?)<\/actions>/);
    if (actionsMatch) {
      try {
        const actionsJson = JSON.parse(actionsMatch[1].trim());
        actions = actionsJson.map((action: any) => ({
          ...action,
          status: 'pending' as const
        }));
        message = message.replace(actionsMatch[0], '').trim();
      } catch (error) {
        console.error('Error parsing actions from Claude response:', error);
      }
    }

    return { message, actions, thinking };
  }

  /**
   * Generate a title for a conversation based on the first message
   */
  async generateConversationTitle(firstMessage: string): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 50,
        temperature: 0.3,
        system: 'Generate a short, descriptive title (3-6 words) for a video editing conversation based on the user\'s first message. Return only the title, no quotes or extra text.',
        messages: [{
          role: 'user',
          content: firstMessage
        }]
      });

      const content = response.content[0];
      if (content.type === 'text') {
        return content.text.trim().replace(/^["']|["']$/g, ''); // Remove quotes if present
      }
      
      return 'Video Editing Chat';
    } catch (error) {
      console.error('Error generating conversation title:', error);
      return 'Video Editing Chat';
    }
  }

  /**
   * Validate Claude API configuration
   */
  async validateConfiguration(): Promise<boolean> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: 'Test'
        }]
      });
      
      return response.content.length > 0;
    } catch (error) {
      console.error('Claude API validation failed:', error);
      return false;
    }
  }
}

// Singleton instance
let claudeServiceInstance: ClaudeService | null = null;

export function getClaudeService(config?: ClaudeConfig): ClaudeService {
  if (!claudeServiceInstance) {
    claudeServiceInstance = new ClaudeService(config);
  }
  return claudeServiceInstance;
}