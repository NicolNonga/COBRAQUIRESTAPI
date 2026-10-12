import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { allowedOrigins, tokenFromCookie } from '@/modules/auth/presentation/session-cookie';
import { RealTimeNotifier } from '@/shared/application/real-time-notifier.port';

/**
 * Gateway Socket.IO autenticado.
 * O original aceitava `join-user-room` com qualquer userId → qualquer cliente
 * podia escutar as notificações de outro utilizador. Aqui o utilizador é
 * extraído do JWT no handshake e só entra na sua própria sala.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true }, transports: ['websocket', 'polling'] })
export class NotificationsGateway extends RealTimeNotifier implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);
  @WebSocketServer() private server?: Server;

  constructor(private readonly jwt: JwtService, private readonly cfg: ConfigService) {
    super();
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const raw = (client.handshake.auth?.token as string | undefined) ?? client.handshake.headers.authorization;
      let token = raw?.replace(/^Bearer\s+/i, '');
      if (!token) {
        // sessão por cookie HttpOnly: só aceita de origens autorizadas (evita sequestro de ligação entre sites)
        token = tokenFromCookie(client.handshake) ?? undefined;
        const allowed = allowedOrigins(this.cfg);
        if (token && allowed && !allowed.includes(String(client.handshake.headers.origin))) throw new Error('origin not allowed');
      }
      if (!token) throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<{ sub: number }>(token);
      client.data.userId = payload.sub;
      await client.join(`user-${payload.sub}`);
      this.logger.debug({ socketId: client.id, userId: payload.sub }, 'Socket ligado');
    } catch {
      this.logger.warn({ socketId: client.id }, 'Ligação socket recusada (token inválido)');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug({ socketId: client.id, userId: client.data?.userId }, 'Socket desligado');
  }

  emitToUser(userId: number, event: string, data: unknown): void {
    this.server?.to(`user-${userId}`).emit(event, data);
  }
}
