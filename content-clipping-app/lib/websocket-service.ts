import { Server as SocketIOServer } from 'socket.io';
import { NextApiResponse } from 'next';
import { Server as NetServer } from 'http';
import { Socket as NetSocket } from 'net';

interface SocketServer extends NetServer {
  io?: SocketIOServer;
}

interface SocketWithIO extends NetSocket {
  server: SocketServer;
}

interface NextApiResponseWithSocket extends NextApiResponse {
  socket: SocketWithIO;
}

// Progress update event types
export interface ProcessingProgressUpdate {
  videoId: string;
  stage: string;
  progress: number;
  message?: string;
  errorMessage?: string;
}

export interface ClipGenerationUpdate {
  videoId: string;
  clipsGenerated: number;
  totalClips: number;
  currentClip?: {
    title: string;
    score: number;
    duration: number;
  };
}

export interface TranscriptionUpdate {
  videoId: string;
  progress: number;
  segmentsProcessed: number;
  currentSegment?: {
    text: string;
    startTime: number;
    endTime: number;
  };
}

// WebSocket Service Class
export class WebSocketService {
  private static instance: WebSocketService;
  private io: SocketIOServer | null = null;

  private constructor() {}

  public static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  /**
   * Initialize Socket.IO server
   */
  public initializeSocket(res: NextApiResponseWithSocket): SocketIOServer {
    if (!res.socket.server.io) {
      console.log('Initializing Socket.IO server...');
      
      const io = new SocketIOServer(res.socket.server, {
        path: '/api/socket',
        addTrailingSlash: false,
        cors: {
          origin: process.env.NODE_ENV === 'production' 
            ? process.env.NEXTAUTH_URL 
            : ['http://localhost:3000'],
          methods: ['GET', 'POST'],
        },
      });

      // Connection handling
      io.on('connection', (socket) => {
        console.log(`Client connected: ${socket.id}`);

        // Join video-specific rooms
        socket.on('join-video', (videoId: string) => {
          socket.join(`video-${videoId}`);
          console.log(`Client ${socket.id} joined room video-${videoId}`);
        });

        // Leave video-specific rooms
        socket.on('leave-video', (videoId: string) => {
          socket.leave(`video-${videoId}`);
          console.log(`Client ${socket.id} left room video-${videoId}`);
        });

        // Handle disconnection
        socket.on('disconnect', () => {
          console.log(`Client disconnected: ${socket.id}`);
        });
      });

      res.socket.server.io = io;
      this.io = io;
    } else {
      this.io = res.socket.server.io;
    }

    return this.io;
  }

  /**
   * Get Socket.IO instance
   */
  public getIO(): SocketIOServer | null {
    return this.io;
  }

  /**
   * Emit processing progress update
   */
  public emitProcessingProgress(update: ProcessingProgressUpdate): void {
    if (this.io) {
      this.io.to(`video-${update.videoId}`).emit('processing-progress', update);
      console.log(`Emitted processing progress for video ${update.videoId}: ${update.stage} (${update.progress}%)`);
    }
  }

  /**
   * Emit transcription progress update
   */
  public emitTranscriptionProgress(update: TranscriptionUpdate): void {
    if (this.io) {
      this.io.to(`video-${update.videoId}`).emit('transcription-progress', update);
      console.log(`Emitted transcription progress for video ${update.videoId}: ${update.progress}%`);
    }
  }

  /**
   * Emit clip generation update
   */
  public emitClipGenerationProgress(update: ClipGenerationUpdate): void {
    if (this.io) {
      this.io.to(`video-${update.videoId}`).emit('clip-generation-progress', update);
      console.log(`Emitted clip generation progress for video ${update.videoId}: ${update.clipsGenerated}/${update.totalClips}`);
    }
  }

  /**
   * Emit processing completion
   */
  public emitProcessingComplete(videoId: string, result: any): void {
    if (this.io) {
      this.io.to(`video-${videoId}`).emit('processing-complete', { videoId, result });
      console.log(`Emitted processing completion for video ${videoId}`);
    }
  }

  /**
   * Emit processing error
   */
  public emitProcessingError(videoId: string, error: string): void {
    if (this.io) {
      this.io.to(`video-${videoId}`).emit('processing-error', { videoId, error });
      console.log(`Emitted processing error for video ${videoId}: ${error}`);
    }
  }

  /**
   * Emit clip approval update
   */
  public emitClipApproval(videoId: string, clipId: string, approved: boolean): void {
    if (this.io) {
      this.io.to(`video-${videoId}`).emit('clip-approval', { videoId, clipId, approved });
      console.log(`Emitted clip approval for video ${videoId}, clip ${clipId}: ${approved}`);
    }
  }

  /**
   * Emit clip export update
   */
  public emitClipExport(videoId: string, clipId: string, exportUrl: string): void {
    if (this.io) {
      this.io.to(`video-${videoId}`).emit('clip-export', { videoId, clipId, exportUrl });
      console.log(`Emitted clip export for video ${videoId}, clip ${clipId}`);
    }
  }

  /**
   * Get room statistics
   */
  public async getRoomStats(): Promise<{ [roomName: string]: number }> {
    if (!this.io) return {};

    const rooms = this.io.sockets.adapter.rooms;
    const stats: { [roomName: string]: number } = {};

    rooms.forEach((socketIds, roomName) => {
      if (roomName.startsWith('video-')) {
        stats[roomName] = socketIds.size;
      }
    });

    return stats;
  }

  /**
   * Broadcast system message to all connected clients
   */
  public broadcastSystemMessage(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
    if (this.io) {
      this.io.emit('system-message', { message, type, timestamp: new Date().toISOString() });
      console.log(`Broadcasted system message: ${message}`);
    }
  }
}

// Export singleton instance
export const websocketService = WebSocketService.getInstance();

// Types for client-side usage
export type {
  ProcessingProgressUpdate,
  ClipGenerationUpdate,
  TranscriptionUpdate,
  NextApiResponseWithSocket,
};