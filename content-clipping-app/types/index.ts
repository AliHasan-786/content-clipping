import { type LucideIcon } from "lucide-react"

export interface User {
  id: string
  email: string
  name?: string | null
  image?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Video {
  id: string
  title: string
  description?: string | null
  url: string
  thumbnail?: string | null
  duration: number
  fileSize: number
  uploadedAt: Date
  userId: string
  clips: Clip[]
  status: VideoStatus
  processingStage?: ProcessingStage
  processingProgress?: number
  errorMessage?: string | null
  metadataExtracted?: boolean
  thumbnailGenerated?: boolean
  audioExtracted?: boolean
  transcriptionCompleted?: boolean
  clipsGenerated?: boolean
  width?: number | null
  height?: number | null
  fps?: number | null
  bitrate?: number | null
  codec?: string | null
  transcription?: Transcription
}

export interface Clip {
  id: string
  title: string
  description?: string | null
  startTime: number
  endTime: number
  videoId: string
  createdAt: Date
  tags: string[]
  exported: boolean
  exportUrl?: string | null
  score?: number | null
  confidence?: number | null
  reason?: string | null
  approved?: boolean
}

export type VideoStatus = "UPLOADING" | "PROCESSING" | "READY" | "ERROR"

export type ProcessingStage = 
  | "UPLOADED"
  | "EXTRACTING_METADATA"
  | "GENERATING_THUMBNAIL"
  | "EXTRACTING_AUDIO"
  | "TRANSCRIBING"
  | "DETECTING_CLIPS"
  | "GENERATING_CLIPS"
  | "COMPLETED"
  | "FAILED"

export interface Transcription {
  id: string
  text: string
  language?: string | null
  videoId: string
  createdAt: Date
  segments?: TranscriptionSegment[]
}

export interface TranscriptionSegment {
  id: string
  text: string
  startTime: number
  endTime: number
  confidence?: number | null
  speakerLabel?: string | null
  transcriptionId: string
}

export interface NavigationItem {
  title: string
  href: string
  icon: LucideIcon
  description?: string
}

export interface UploadProgress {
  progress: number
  phase: "uploading" | "processing" | "complete" | "error"
  message: string
}

export interface ClipCreateData {
  title: string
  startTime: number
  endTime: number
  description?: string
  tags?: string[]
}

export interface VideoUploadData {
  file: File
  title: string
  description?: string
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// Chat and AI Integration Types
export interface ChatMessage {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: Date
  conversationId: string
  metadata?: {
    command?: string
    actions?: ChatAction[]
    context?: ChatContext
    thinking?: string
  }
}

export interface ChatConversation {
  id: string
  title?: string | null
  userId: string
  videoId?: string | null
  createdAt: Date
  updatedAt: Date
  messages: ChatMessage[]
  context: ChatContext
  isActive: boolean
}

export interface ChatContext {
  currentVideo?: {
    id: string
    title: string
    duration: number
    processingStage: ProcessingStage
    clips?: Clip[]
    transcription?: string
  }
  selectedClips?: string[]
  lastAction?: ChatAction
  preferences?: {
    exportFormat?: 'mp4' | 'mov' | 'webm'
    resolution?: '1080p' | '720p' | '480p'
    aspectRatio?: '16:9' | '9:16' | '1:1'
  }
}

export type ChatActionType = 
  | 'find_clips'
  | 'generate_clips'
  | 'edit_clip'
  | 'export_clips'
  | 'analyze_video'
  | 'suggest_improvements'
  | 'create_highlights'
  | 'adjust_captions'
  | 'change_format'

export interface ChatAction {
  type: ChatActionType
  parameters: Record<string, any>
  description: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  result?: any
  error?: string
}

export interface NLCommand {
  intent: ChatActionType
  entities: Record<string, any>
  confidence: number
  originalText: string
}

export interface ChatContextUpdate {
  videoId?: string
  selectedClips?: string[]
  preferences?: Partial<ChatContext['preferences']>
}

// Chat API Request/Response Types
export interface ChatRequest {
  message: string
  conversationId?: string
  context?: ChatContextUpdate
}

export interface ChatResponse {
  message: ChatMessage
  actions?: ChatAction[]
  contextUpdate?: ChatContextUpdate
}

export interface ChatActionRequest {
  conversationId: string
  action: ChatAction
}

export interface ChatActionResponse {
  success: boolean
  result?: any
  error?: string
  updatedContext?: ChatContext
}