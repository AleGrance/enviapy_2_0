import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',
})
export class WhatsAppGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(WhatsAppGateway.name);

  constructor(private jwtService: JwtService) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];
      if (token) {
        const payload = this.jwtService.verify(token, { secret: process.env.JWT_SECRET || 'supersecret' });
        client.data.user = payload;
        if (payload.role === 'SUPER_ADMIN') {
          client.join('role:super-admin');
        } else {
          client.join(`tenant:${payload.tenantId}`);
        }
        this.logger.log(`Client connected: ${client.id} (tenant: ${payload.tenantId})`);
      }
    } catch (e) {
      this.logger.warn(`Unauthorized WS connection: ${e.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  emitQR(tenantId: string, numberId: string, qr: string) {
    this.server.to(`tenant:${tenantId}`).emit('qr', { numberId, qr });
    this.server.to('role:super-admin').emit('qr', { numberId, qr });
  }

  emitStatus(tenantId: string, numberId: string, status: string) {
    this.server.to(`tenant:${tenantId}`).emit('number:status', { numberId, status });
    this.server.to('role:super-admin').emit('number:status', { numberId, status });
  }

  emitLinked(tenantId: string, numberId: string) {
    this.server.to(`tenant:${tenantId}`).emit('number:linked', { numberId });
    this.server.to('role:super-admin').emit('number:linked', { numberId });
  }

  emitMessage(tenantId: string, message: any) {
    this.server.to(`tenant:${tenantId}`).emit('message:new', message);
    this.server.to('role:super-admin').emit('message:new', message);
  }

  emitMessageUpdate(tenantId: string, message: any) {
    this.server.to(`tenant:${tenantId}`).emit('message:update', message);
    this.server.to('role:super-admin').emit('message:update', message);
  }

  emitConversationUpdate(tenantId: string, conversation: any) {
    this.server.to(`tenant:${tenantId}`).emit('conversation:update', conversation);
    this.server.to('role:super-admin').emit('conversation:update', conversation);
  }
}
