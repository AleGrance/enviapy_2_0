import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { WhatsAppGateway } from './whatsapp.gateway';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs';
import { MessageDeliveryStatus } from '@prisma/client';

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const MAX_ACTIVE_CLIENTS = 50;
const DEFAULT_INBOUND_LOG_MAX_LENGTH = 20000;
const DEFAULT_INBOUND_LOG_FILE_NAME = 'wa-inbound.log';
const SINGLETON_LOCK_RETRY_DELAY_MS = 3000;
const MAX_SINGLETON_LOCK_RETRIES = 5;
const DEFAULT_WA_AUTH_TIMEOUT_MS = 120000;
const DEFAULT_WA_PROTOCOL_TIMEOUT_MS = 120000;

@Injectable()
export class WhatsAppManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppManagerService.name);
  private clients = new Map<string, any>();
  private latestQrByNumber = new Map<string, string>();
  private reconnectTimeouts = new Map<string, NodeJS.Timeout>();
  private shuttingDown = false;
  private readonly logInboundPayloads = (process.env.WA_LOG_INBOUND_PAYLOADS || 'true').toLowerCase() !== 'false';
  private readonly inboundLogMaxLength = Number(process.env.WA_LOG_INBOUND_MAX_LENGTH || DEFAULT_INBOUND_LOG_MAX_LENGTH);
  private readonly logInboundToFile = (process.env.WA_LOG_INBOUND_FILE || 'true').toLowerCase() !== 'false';
  private readonly inboundLogFileName = process.env.WA_LOG_INBOUND_FILE_NAME || DEFAULT_INBOUND_LOG_FILE_NAME;
  private readonly waAuthTimeoutMs = Number(process.env.WA_AUTH_TIMEOUT_MS || DEFAULT_WA_AUTH_TIMEOUT_MS);
  private readonly waProtocolTimeoutMs = Number(process.env.WA_PROTOCOL_TIMEOUT_MS || DEFAULT_WA_PROTOCOL_TIMEOUT_MS);
  private readonly puppeteerExecutablePath = String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();

  private mapAckToDeliveryStatus(ack: number): MessageDeliveryStatus | null {
    if (ack >= 3) return MessageDeliveryStatus.READ;
    if (ack === 2) return MessageDeliveryStatus.RECEIVED;
    if (ack === 1) return MessageDeliveryStatus.SENT;
    return null;
  }

  private resolveProviderMessageIdCandidates(message: any) {
    const candidates = [
      message?.id?._serialized,
      message?.id?.id,
      message?._data?.id?._serialized,
      message?._data?.id?.id,
    ]
      .filter((value) => typeof value === 'string' && String(value).trim())
      .map((value) => String(value).trim());

    return Array.from(new Set(candidates));
  }

  constructor(
    private prisma: PrismaService,
    @InjectQueue('messages') private messageQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.restoreAllSessions();
  }

  async onModuleDestroy() {
    this.shuttingDown = true;

    for (const timeout of this.reconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.reconnectTimeouts.clear();

    const entries = Array.from(this.clients.entries());
    for (const [numberId, client] of entries) {
      try {
        await client.destroy();
      } catch (e) {
        this.logger.warn(`Error destroying client ${numberId} during shutdown: ${e.message}`);
      }
    }

    this.clients.clear();
    this.latestQrByNumber.clear();
  }

  setGateway(gateway: WhatsAppGateway) {
    (this as any).gateway = gateway;
  }

  private get gateway(): WhatsAppGateway {
    return (this as any)._gateway;
  }

  injectGateway(gateway: WhatsAppGateway) {
    (this as any)._gateway = gateway;
  }

  async restoreAllSessions() {
    const numbers = await this.prisma.whatsAppNumber.findMany();
    this.logger.log(`Restoring ${numbers.length} WhatsApp sessions...`);
    for (const number of numbers) {
      try {
        await this.startClient(number.id);
      } catch (e) {
        this.logger.error(`Failed to restore session for ${number.id}: ${e.message}`);
      }
    }
  }

  async startClient(numberId: string, attempt = 0) {
    const pendingReconnect = this.reconnectTimeouts.get(numberId);
    if (pendingReconnect) {
      clearTimeout(pendingReconnect);
      this.reconnectTimeouts.delete(numberId);
    }

    if (this.clients.has(numberId)) {
      this.logger.log(`Client for ${numberId} already running`);
      return;
    }

    if (this.clients.size >= MAX_ACTIVE_CLIENTS) {
      this.logger.warn('Max active clients reached');
      return;
    }

    const number = await this.prisma.whatsAppNumber.findUnique({ where: { id: numberId } });
    if (!number) return;

    await this.prisma.whatsAppNumber.update({
      where: { id: numberId },
      data: { status: 'CONNECTING' },
    });

    const sessionPath = path.join(process.cwd(), '.wwebjs_auth');
    const sessionDir = path.join(sessionPath, `session-${number.sessionName}`);
    this.cleanupSingletonLocks(sessionDir);

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: number.sessionName, dataPath: sessionPath }),
      authTimeoutMs: Number.isFinite(this.waAuthTimeoutMs) && this.waAuthTimeoutMs > 0
        ? this.waAuthTimeoutMs
        : DEFAULT_WA_AUTH_TIMEOUT_MS,
      puppeteer: {
        headless: true,
        ...(this.puppeteerExecutablePath ? { executablePath: this.puppeteerExecutablePath } : {}),
        protocolTimeout: Number.isFinite(this.waProtocolTimeoutMs) && this.waProtocolTimeoutMs > 0
          ? this.waProtocolTimeoutMs
          : DEFAULT_WA_PROTOCOL_TIMEOUT_MS,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-extensions',
          '--window-size=1280,720',
        ],
      },
    });

    this.clients.set(numberId, client);

    client.on('qr', async (qr: string) => {
      this.logger.log(`QR generated for number ${numberId}`);
      this.latestQrByNumber.set(numberId, qr);
      const gateway = (this as any)._gateway;
      if (gateway) {
        gateway.emitQR(number.tenantId, numberId, qr);
      }
    });

    client.on('ready', async () => {
      this.logger.log(`Client ${numberId} is ready`);
      const info = client.info;
      const resolvedPhone = info?.wid?.user || number.phoneNumber || null;
      this.logInboundPayload('ready', { info }, { numberId, tenantId: number.tenantId, resolvedPhone });
      await this.prisma.whatsAppNumber.update({
        where: { id: numberId },
        data: {
          status: 'CONNECTED',
          phoneNumber: resolvedPhone,
        },
      });
      this.latestQrByNumber.delete(numberId);
      const gateway = (this as any)._gateway;
      if (gateway) {
        gateway.emitStatus(number.tenantId, numberId, 'CONNECTED');
      }

      // No historical sync: only new incoming/outgoing chats are processed from this point.
    });

    client.on('authenticated', () => {
      this.logger.log(`Client ${numberId} authenticated`);
      this.logInboundPayload('authenticated', {}, { numberId, tenantId: number.tenantId });
      this.latestQrByNumber.delete(numberId);
      const gateway = (this as any)._gateway;
      if (gateway) {
        gateway.emitLinked(number.tenantId, numberId);
      }
    });

    client.on('auth_failure', async (msg: string) => {
      this.logger.error(`Auth failure for ${numberId}: ${msg}`);
      this.logInboundPayload('auth_failure', { message: msg }, { numberId, tenantId: number.tenantId });
      if (this.shuttingDown) {
        this.latestQrByNumber.delete(numberId);
        this.clients.delete(numberId);
        return;
      }
      await this.prisma.whatsAppNumber.update({
        where: { id: numberId },
        data: { status: 'DISCONNECTED' },
      });
      this.latestQrByNumber.delete(numberId);
      this.clients.delete(numberId);
      const gateway = (this as any)._gateway;
      if (gateway) {
        gateway.emitStatus(number.tenantId, numberId, 'DISCONNECTED');
      }
    });

    client.on('disconnected', async (reason: string) => {
      this.logger.warn(`Client ${numberId} disconnected: ${reason}`);
      this.logInboundPayload('disconnected', { reason }, { numberId, tenantId: number.tenantId });
      if (this.shuttingDown) {
        this.latestQrByNumber.delete(numberId);
        this.clients.delete(numberId);
        return;
      }
      await this.prisma.whatsAppNumber.update({
        where: { id: numberId },
        data: { status: 'DISCONNECTED' },
      });
      this.latestQrByNumber.delete(numberId);
      this.clients.delete(numberId);
      const gateway = (this as any)._gateway;
      if (gateway) {
        gateway.emitStatus(number.tenantId, numberId, 'DISCONNECTED');
      }
      // Auto-reconnect after 30s
      const timeout = setTimeout(() => {
        this.reconnectTimeouts.delete(numberId);
        void this.startClient(numberId);
      }, 30000);
      this.reconnectTimeouts.set(numberId, timeout);
    });

    client.on('change_state', (state: string) => {
      this.logInboundPayload('change_state', { state }, { numberId, tenantId: number.tenantId });
    });

    client.on('message_create', (msg: any) => {
      const from = String(msg?.from || msg?.author || '');
      const to = String(msg?.to || '');
      const isStatus = this.isStatusJid(from) || this.isStatusJid(to) || Boolean(msg?.isStatus);
      this.logInboundPayload('message_create', msg, {
        numberId,
        tenantId: number.tenantId,
        from,
        to,
        fromMe: Boolean(msg?.fromMe),
        isStatus,
        type: msg?.type || null,
      });
    });

    client.on('message', async (msg: any) => {
      const from = String(msg?.from || msg?.author || '');
      const isPersonMessage = this.isPersonJid(from);
      const isFromMe = Boolean(msg?.fromMe);
      const isStatus = this.isStatusJid(from) || Boolean(msg?.isStatus);
      const isGroup = Boolean(msg?.isGroup) || this.isGroupJid(from);
      const msgType = String(msg?.type || '').toLowerCase();
      const isNotificationTemplate = msgType === 'notification_template';
      const notifyName = String(msg?.notifyName || msg?._data?.notifyName || '').trim();
      this.logInboundPayload('message', msg, {
        numberId,
        tenantId: number.tenantId,
        from,
        to: String(msg?.to || ''),
        type: msgType || null,
        fromMe: isFromMe,
        isStatus,
        isGroup,
        hasMedia: Boolean(msg?.hasMedia),
        timestamp: msg?.timestamp || null,
      });

      // Exclude only notification templates plus non-inbound-person contexts.
      if (!isPersonMessage || isFromMe || isStatus || isGroup || isNotificationTemplate) {
        return;
      }

      await this.messageQueue.add('process-inbound', {
        numberId,
        tenantId: number.tenantId,
        msg: {
          id: msg?.id?._serialized || msg?.id?.id || null,
          from,
          to: msg.to,
          body: msg.body,
          type: msgType,
          notifyName,
          timestamp: msg.timestamp,
          hasMedia: msg.hasMedia,
          fromMe: msg.fromMe,
          isGroup: msg.isGroup,
        },
      });
    });

    client.on('message_ack', async (msg: any, ack: number) => {
      if (msg?.fromMe === false) {
        return;
      }

      const deliveryStatus = this.mapAckToDeliveryStatus(Number(ack));
      const providerMessageIds = this.resolveProviderMessageIdCandidates(msg);
      if (!deliveryStatus || providerMessageIds.length === 0) {
        return;
      }

      try {
        const updated = await this.prisma.message.updateMany({
          where: {
            numberId,
            direction: 'OUTBOUND',
            providerMessageId: { in: providerMessageIds },
            OR: [
              { deliveryStatus: null },
              { deliveryStatus: MessageDeliveryStatus.SENT },
              ...(deliveryStatus === MessageDeliveryStatus.READ
                ? [{ deliveryStatus: MessageDeliveryStatus.RECEIVED }]
                : []),
            ],
          },
          data: {
            deliveryStatus,
          },
        });

        if (updated.count === 0) {
          return;
        }

        const storedMessage = await this.prisma.message.findFirst({
          where: {
            numberId,
            direction: 'OUTBOUND',
            providerMessageId: { in: providerMessageIds },
          },
          orderBy: { timestamp: 'desc' },
        });

        if (storedMessage) {
          this.gateway.emitMessageUpdate(number.tenantId, storedMessage);
        }
      } catch (e) {
        const idsSummary = providerMessageIds.join(', ');
        this.logger.warn(`Could not update message ack for ${idsSummary}: ${e.message}`);
      }
    });

    try {
      await client.initialize();
      this.logger.log(`Client initialized for ${numberId}`);
    } catch (e) {
      const message = e?.message || 'Unknown initialization error';
      this.clients.delete(numberId);
      try {
        await client.destroy();
      } catch {
        // ignore cleanup errors on failed init
      }

      const isSingletonLockError = message.toLowerCase().includes('profile appears to be in use')
        || message.toLowerCase().includes('process_singleton_posix');

      if (isSingletonLockError && attempt < MAX_SINGLETON_LOCK_RETRIES) {
        this.logger.warn(
          `Retrying client ${numberId} after cleaning Chromium singleton locks (attempt ${attempt + 1}/${MAX_SINGLETON_LOCK_RETRIES})`,
        );
        this.cleanupSingletonLocks(sessionDir);

        await new Promise((r) => setTimeout(r, SINGLETON_LOCK_RETRY_DELAY_MS));
        return this.startClient(numberId, attempt + 1);
      }

      await this.prisma.whatsAppNumber.update({
        where: { id: numberId },
        data: { status: 'DISCONNECTED' },
      });
      this.latestQrByNumber.delete(numberId);

      throw e;
    }
  }

  async stopClient(numberId: string) {
    const client = this.clients.get(numberId);
    if (!client) return;
    try {
      await client.destroy();
    } catch (e) {
      this.logger.error(`Error destroying client ${numberId}: ${e.message}`);
    }
    this.clients.delete(numberId);
    this.latestQrByNumber.delete(numberId);
    await this.prisma.whatsAppNumber.update({
      where: { id: numberId },
      data: { status: 'DISCONNECTED' },
    });
  }

  getClient(numberId: string) {
    return this.clients.get(numberId);
  }

  getActiveClients(): string[] {
    return Array.from(this.clients.keys());
  }

  async sendTextMessage(numberId: string, to: string, text: string) {
    const client = this.clients.get(numberId);
    if (!client) throw new Error(`No active client for number ${numberId}`);
    const chatId = to.includes('@') ? to : `${to}@c.us`;
    return client.sendMessage(chatId, text);
  }

  async sendMediaMessage(numberId: string, to: string, mediaPath: string, caption?: string) {
    const client = this.clients.get(numberId);
    if (!client) throw new Error(`No active client for number ${numberId}`);
    const chatId = to.includes('@') ? to : `${to}@c.us`;
    const media = MessageMedia.fromFilePath(mediaPath);
    return client.sendMessage(chatId, media, { caption });
  }

  async downloadMedia(numberId: string, msgSerializedId: string): Promise<any> {
    const client = this.clients.get(numberId);
    if (!client) return null;
    const msg = await client.getMessageById(msgSerializedId);
    if (!msg || !msg.hasMedia) return null;
    return msg.downloadMedia();
  }

  getLatestQr(numberId: string): string | null {
    return this.latestQrByNumber.get(numberId) || null;
  }

  private isPersonJid(jid: string): boolean {
    return jid.endsWith('@c.us') || jid.endsWith('@lid') || jid.endsWith('@s.whatsapp.net');
  }

  private isGroupJid(jid: string): boolean {
    return jid.endsWith('@g.us');
  }

  private isStatusJid(jid: string): boolean {
    return jid.endsWith('@broadcast') || jid.endsWith('status@broadcast');
  }

  private logInboundPayload(event: string, payload: any, meta?: Record<string, any>) {
    const safePayload = this.safeStringify(payload);
    const maxLength = Number.isFinite(this.inboundLogMaxLength) && this.inboundLogMaxLength > 0
      ? this.inboundLogMaxLength
      : DEFAULT_INBOUND_LOG_MAX_LENGTH;
    const trimmedPayload = safePayload.length > maxLength
      ? `${safePayload.slice(0, maxLength)}...[truncated ${safePayload.length - maxLength} chars]`
      : safePayload;

    const metaJson = meta ? this.safeStringify(meta) : '{}';
    const line = `[WA_INBOUND] event=${event} meta=${metaJson} payload=${trimmedPayload}`;

    if (this.logInboundPayloads) {
      this.logger.log(line);
    }
    if (this.logInboundToFile) {
      this.appendInboundLogFile(line);
    }
  }

  private safeStringify(value: any): string {
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(value, (_key, v) => {
        if (typeof v === 'bigint') return v.toString();
        if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      });
    } catch (e) {
      return `{"serializationError":"${(e as Error)?.message || 'unknown'}"}`;
    }
  }

  private appendInboundLogFile(line: string) {
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      const filePath = path.join(logsDir, this.inboundLogFileName);
      const stampedLine = `${new Date().toISOString()} ${line}${process.platform === 'win32' ? '\r\n' : '\n'}`;
      fs.appendFileSync(filePath, stampedLine, { encoding: 'utf8' });
    } catch (e) {
      this.logger.warn(`Could not write inbound log file: ${(e as Error)?.message || 'unknown error'}`);
    }
  }

  private cleanupSingletonLocks(sessionDir: string) {
    const singletonFiles = [
      'SingletonLock',
      'SingletonSocket',
      'SingletonCookie',
      'DevToolsActivePort',
      path.join('Default', 'SingletonLock'),
      path.join('Default', 'SingletonSocket'),
      path.join('Default', 'SingletonCookie'),
    ];
    for (const file of singletonFiles) {
      const target = path.join(sessionDir, file);
      try {
        fs.rmSync(target, { force: true });
      } catch (e) {
        this.logger.warn(`Could not cleanup ${target}: ${e.message}`);
      }
    }
  }
}
