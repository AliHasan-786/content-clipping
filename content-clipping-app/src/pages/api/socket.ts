import { NextApiRequest } from 'next';
import { websocketService, NextApiResponseWithSocket } from '@/lib/websocket-service';

export default function handler(req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (res.socket.server.io) {
    console.log('Socket.IO already running');
  } else {
    console.log('Socket.IO starting');
    websocketService.initializeSocket(res);
  }
  res.end();
}

export const config = {
  api: {
    bodyParser: false,
  },
};
