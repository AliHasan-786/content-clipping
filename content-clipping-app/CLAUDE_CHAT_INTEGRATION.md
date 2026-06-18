# Claude Chat Integration for Natural Language Video Editing

This document outlines the complete implementation of Claude AI chat integration that enables natural language video editing capabilities.

## 🌟 Features Implemented

### 1. **Claude API Integration**
- ✅ Anthropic Claude SDK integration (`@anthropic-ai/sdk`)
- ✅ Context-aware conversation management
- ✅ Memory persistence across chat sessions
- ✅ Intelligent response generation with action parsing

### 2. **Chat Interface Components**
- ✅ Beautiful, responsive chat interface with real-time messaging
- ✅ Message history with proper threading
- ✅ Typing indicators and message status
- ✅ File/clip context sharing in chat
- ✅ Collapsible floating chat window
- ✅ Action result badges and status indicators

### 3. **Natural Language Processing**
- ✅ Parse commands like "Find clips with strong hooks"
- ✅ "Make this clip more engaging with better captions"
- ✅ "Regenerate clips focusing on comedy content"
- ✅ "Export these 3 clips to TikTok format"
- ✅ Intent recognition and entity extraction

### 4. **Context-Aware Actions**
- ✅ Claude knows current video being worked on
- ✅ Access to all generated clips and metadata
- ✅ Can trigger video processing actions
- ✅ Updates UI based on chat commands
- ✅ Maintains conversation context across sessions

### 5. **Chat-to-Action Pipeline**
- ✅ Parse natural language into actionable commands
- ✅ Execute video processing operations
- ✅ Return results back to chat
- ✅ Update UI elements in real-time

### 6. **API Endpoints**
- ✅ `/api/chat` - Main chat endpoint (POST/GET)
- ✅ `/api/chat/context` - Context management (PUT/GET)
- ✅ `/api/chat/actions` - Command execution (POST/GET)

## 🗃️ Database Schema

Added chat-related models to Prisma schema:

```prisma
model ChatConversation {
  id         String       @id @default(cuid())
  title      String?
  userId     String
  videoId    String?
  context    Json         // Stores ChatContext as JSON
  isActive   Boolean      @default(true)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt

  user     User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  video    Video?        @relation(fields: [videoId], references: [id], onDelete: SetNull)
  messages ChatMessage[]
}

model ChatMessage {
  id             String   @id @default(cuid())
  content        String   @db.Text
  role           String   // 'user' | 'assistant'
  conversationId String
  metadata       Json?    // Stores metadata like commands, actions, context
  createdAt      DateTime @default(now())

  conversation ChatConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
}
```

## 🔧 Core Services

### 1. **ClaudeService** (`/lib/claude-service.ts`)
- Handles communication with Anthropic's Claude API
- Context-aware response generation
- Natural language command parsing
- Conversation title generation

### 2. **ChatConversationService** (`/lib/chat-conversation-service.ts`)
- Manages chat conversations and messages
- Context persistence and updates
- Message history and pagination
- Search and filtering capabilities

### 3. **ChatActionExecutor** (`/lib/chat-action-executor.ts`)
- Executes video processing actions from natural language commands
- Supports 9 action types: find_clips, generate_clips, edit_clip, export_clips, analyze_video, suggest_improvements, create_highlights, adjust_captions, change_format
- Results integration back to chat

### 4. **ChatIntegrationService** (`/lib/chat-integration-service.ts`)
- Orchestrates the complete chat-to-action pipeline
- Smart suggestions based on context
- Query parsing and filtering
- Contextual help generation

## 🎨 UI Components

### 1. **ChatInterface** (`/components/ui/chat-interface.tsx`)
- Modern chat interface with floating/embedded modes
- Message bubbles with action results
- Typing indicators and real-time updates
- Context-aware suggestions

### 2. **ChatContextManager** (`/components/ui/chat-context-manager.tsx`)
- React Context provider for chat state management
- Video and clip selection integration
- Preference management

### 3. **EnhancedProcessingDashboard** (`/components/ui/enhanced-processing-dashboard.tsx`)
- Integrated chat tab in video processing dashboard
- Smart suggestions banner when processing completes
- Real-time context updates

## 🚀 Installation & Setup

### 1. Install Dependencies
```bash
npm install @anthropic-ai/sdk
```

### 2. Environment Configuration
Add to your `.env` file:
```env
ANTHROPIC_API_KEY=your_claude_api_key_here
```

### 3. Database Migration
```bash
npm run db:migrate
```

### 4. Validation
The environment validator now includes Claude API validation.

## 💬 Supported Natural Language Commands

### Clip Discovery
- "Find clips with strong hooks"
- "Show me the most engaging moments"
- "Find funny clips"
- "Get clips longer than 30 seconds"

### Clip Generation
- "Generate 5 clips from this video"
- "Create clips focusing on key insights"
- "Make clips perfect for TikTok"
- "Generate highlights from this content"

### Clip Editing
- "Make this clip more engaging"
- "Adjust the timing of clip 1"
- "Add better captions to these clips"
- "Improve the title and description"

### Export & Formatting
- "Export these 3 clips to TikTok format"
- "Convert clips to vertical orientation"
- "Export in 720p for Instagram"
- "Create YouTube Shorts from highlights"

### Analysis & Suggestions
- "Analyze this video for engagement"
- "What makes this content successful?"
- "Suggest improvements for social media"
- "How can I make this more viral?"

## 🔄 Chat-to-Action Flow

1. **User Input**: Natural language message
2. **Claude Processing**: Intent recognition and response generation
3. **Action Parsing**: Extract actionable commands from Claude's response
4. **Execution**: Run video processing operations
5. **Results**: Update chat with action results and UI state
6. **Context Update**: Maintain conversation context for future interactions

## 📊 Context Awareness

The system maintains rich context including:
- Current video metadata (title, duration, processing stage)
- Available clips with scores and metadata
- Selected clips for operations
- User preferences (format, resolution, aspect ratio)
- Conversation history and past actions

## 🛠️ Testing

Run the integration test:
```bash
node test-claude-integration.js
```

This validates:
- TypeScript interfaces
- Database schema
- API endpoint structure
- UI component integration
- Sample interaction patterns

## 🎯 Usage Examples

### Starting a Conversation
```typescript
import { ChatInterface } from '@/components/ui/chat-interface';
import { ChatContextManager } from '@/components/ui/chat-context-manager';

<ChatContextManager videoId="video-123">
  <ChatInterface />
</ChatContextManager>
```

### Processing Dashboard Integration
```typescript
import { EnhancedProcessingDashboard } from '@/components/ui/enhanced-processing-dashboard';

<EnhancedProcessingDashboard 
  videoId="video-123" 
  initialVideoData={videoData} 
/>
```

## 🚀 Next Steps

1. **Set API Key**: Configure `ANTHROPIC_API_KEY` in environment
2. **Run Migration**: Execute database schema migration
3. **Test Integration**: Start development server and test chat interactions
4. **Customize**: Adapt UI components and action handlers for your needs

## 📝 Key Files Created

### Core Services
- `/lib/claude-service.ts` - Claude API integration
- `/lib/chat-conversation-service.ts` - Conversation management
- `/lib/chat-action-executor.ts` - Action execution engine
- `/lib/chat-integration-service.ts` - Integration orchestrator

### API Endpoints
- `/src/app/api/chat/route.ts` - Main chat API
- `/src/app/api/chat/context/route.ts` - Context management
- `/src/app/api/chat/actions/route.ts` - Action execution API

### UI Components
- `/components/ui/chat-interface.tsx` - Chat interface
- `/components/ui/chat-context-manager.tsx` - Context management
- `/components/ui/enhanced-processing-dashboard.tsx` - Integrated dashboard

### Configuration
- Updated `/types/index.ts` - TypeScript interfaces
- Updated `/prisma/schema.prisma` - Database schema
- Updated `/lib/env-validation.ts` - Environment validation
- Updated `/package.json` - Dependencies

The implementation enables users to have natural conversations with Claude about their video editing needs, with Claude understanding the context and executing appropriate video processing actions seamlessly.