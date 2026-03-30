import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { WhatsAppManagerService } from '../whatsapp/whatsapp-manager.service';
import { WhatsAppGateway } from '../whatsapp/whatsapp.gateway';
import * as fs from 'fs';
import * as path from 'path';
import { MessageDeliveryStatus } from '@prisma/client';

const NO_ACTIVE_CLIENT_RETRY_DELAY_MS = 15000;
const NO_ACTIVE_CLIENT_MAX_RETRIES = 20;

@Processor('messages')
export class MessagesProcessor extends WorkerHost {
  private readonly logger = new Logger(MessagesProcessor.name);

  constructor(
    private prisma: PrismaService,
    private manager: WhatsAppManagerService,
    private gateway: WhatsAppGateway,
    @InjectQueue('messages') private messageQueue: Queue,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'process-inbound') {
      await this.processInbound(job.data);
    } else if (job.name === 'send-outbound') {
      await this.processOutbound(job.data);
    } else if (job.name === 'send-campaign-recipient') {
      await this.processCampaignRecipient(job);
    }
  }

  private isNoActiveClientError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('No active client for number');
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

  private normalizeWaId(jid: string): string {
    const raw = String(jid || '');
    const withoutSuffix = raw
      .replace('@c.us', '')
      .replace('@g.us', '')
      .replace('@lid', '')
      .replace('@s.whatsapp.net', '');
    return withoutSuffix.split(':')[0];
  }

  private areEquivalentWaIds(left: string, right: string): boolean {
    const normalizedLeft = this.normalizeWaId(left);
    const normalizedRight = this.normalizeWaId(right);

    return (
      normalizedLeft === normalizedRight ||
      normalizedLeft.endsWith(normalizedRight) ||
      normalizedRight.endsWith(normalizedLeft)
    );
  }

  private resolveRemoteWaId(message: any, fallback: string) {
    const candidates = [
      message?.to,
      message?.from,
      message?.id?.remote,
      message?._data?.to,
      message?._data?.from,
      message?._data?.id?.remote,
      fallback,
    ];

    const candidate = candidates.find((value) => typeof value === 'string' && String(value).trim());
    return this.normalizeWaId(String(candidate || fallback));
  }

  private resolveProviderMessageId(message: any) {
    const candidates = [
      message?.id?._serialized,
      message?.id?.id,
      message?._data?.id?._serialized,
      message?._data?.id?.id,
    ];

    const candidate = candidates.find((value) => typeof value === 'string' && String(value).trim());
    return candidate ? String(candidate) : null;
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

  private async findConversationForContact(numberId: string, rawWaId: string) {
    const waId = this.normalizeWaId(rawWaId);
    let conversation = await this.prisma.conversation.findUnique({
      where: { numberId_waId: { numberId, waId } },
    });

    if (conversation) {
      return conversation;
    }

    const candidates = await this.prisma.conversation.findMany({
      where: {
        numberId,
        NOT: [
          { waId: { contains: '@broadcast' } },
          { waId: { contains: '-' } },
        ],
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    const matches = candidates.filter((candidate) => this.areEquivalentWaIds(candidate.waId, waId));
    if (matches.length !== 1) {
      return null;
    }

    conversation = matches[0];
    if (conversation.waId === waId) {
      return conversation;
    }

    const alreadyExists = await this.prisma.conversation.findUnique({
      where: { numberId_waId: { numberId, waId } },
      select: { id: true },
    });

    if (alreadyExists) {
      return conversation;
    }

    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { waId },
    });
  }

  private async upsertConversationForContact(params: {
    tenantId: string;
    numberId: string;
    rawWaId: string;
    name?: string;
    lastMessageAt: Date;
  }) {
    const { tenantId, numberId, rawWaId, name, lastMessageAt } = params;
    const waId = this.normalizeWaId(rawWaId);
    const trimmedName = name?.trim() || '';
    const displayName = trimmedName
      ? (trimmedName.includes('@') ? this.normalizeWaId(trimmedName) : trimmedName)
      : waId;
    const number = await this.prisma.whatsAppNumber.findUnique({
      where: { id: numberId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!number) {
      throw new Error(`WhatsApp number ${numberId} no longer exists`);
    }

    let conversation = await this.findConversationForContact(numberId, waId);

    if (!conversation) {
      return this.prisma.conversation.create({
        data: {
          tenantId: number.tenantId || tenantId,
          numberId: number.id,
          waId,
          name: displayName,
          lastMessageAt,
        },
      });
    }

    const updateData: Record<string, any> = { lastMessageAt };
    if (conversation.waId !== waId) {
      updateData.waId = waId;
    }
    if (
      conversation.name !== displayName
      && (trimmedName || !conversation.name?.trim() || String(conversation.name).includes('@'))
    ) {
      updateData.name = displayName;
    }

    if (Object.keys(updateData).length === 1 && updateData.lastMessageAt === lastMessageAt) {
      return this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt },
      });
    }

    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: updateData,
    });
  }

  private async resolveDestinationToJid(numberId: string, to: string): Promise<string> {
    const rawTo = String(to || '').trim();
    if (!rawTo) return rawTo;
    if (rawTo.includes('@')) return rawTo;

    const waId = this.normalizeWaId(rawTo);
    const conversation = await this.findConversationForContact(numberId, waId);

    if (!conversation) {
      return rawTo;
    }

    const lastInbound = await this.prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        direction: 'INBOUND',
      },
      orderBy: { timestamp: 'desc' },
      select: { from: true },
    });

    if (lastInbound?.from && String(lastInbound.from).includes('@')) {
      return String(lastInbound.from);
    }

    return rawTo;
  }

  private async findLatestCampaignRecipientForInbound(params: {
    numberId: string;
    rawWaId: string;
    inboundTimestamp: Date;
  }) {
    const { numberId, rawWaId, inboundTimestamp } = params;
    const waId = this.normalizeWaId(rawWaId);

    const candidates = await this.prisma.campaignRecipient.findMany({
      where: {
        status: 'SENT',
        sentAt: { lte: inboundTimestamp },
        campaign: {
          numberId,
        },
        OR: [
          { phoneNumber: waId },
          { phoneNumber: { endsWith: waId } },
          { phoneNumber: { startsWith: waId } },
        ],
      },
      select: {
        id: true,
        campaignId: true,
        phoneNumber: true,
        sentAt: true,
      },
      orderBy: { sentAt: 'desc' },
    });

    return candidates.find((candidate) => this.areEquivalentWaIds(candidate.phoneNumber, waId)) || null;
  }

  private async findLatestCampaignMessageForInbound(params: {
    conversationId: string;
    inboundTimestamp: Date;
  }) {
    const { conversationId, inboundTimestamp } = params;
    return this.prisma.message.findFirst({
      where: {
        conversationId,
        direction: 'OUTBOUND',
        campaignRecipientId: { not: null },
        timestamp: { lte: inboundTimestamp },
      },
      orderBy: { timestamp: 'desc' },
      select: {
        campaignId: true,
        campaignRecipientId: true,
      },
    });
  }

  private async processInbound(data: any) {
    const { numberId, tenantId, msg } = data;
    const from = String(msg?.from || msg?.author || '');
    const isPersonMessage = this.isPersonJid(from);
    const isFromMe = Boolean(msg?.fromMe);
    const isStatus = this.isStatusJid(from);
    const isGroup = Boolean(msg?.isGroup) || this.isGroupJid(from);
    const msgType = String(msg?.type || '').toLowerCase();
    const isNotificationTemplate = msgType === 'notification_template';
    const notifyName = String(msg?.notifyName || '').trim();

    // Defensive filter: exclude only notification templates plus non-inbound-person contexts.
    if (!isPersonMessage || isFromMe || isStatus || isGroup || isNotificationTemplate) {
      return;
    }

    const msgTypeMap: Record<string, string> = {
      chat: 'TEXT',
      image: 'IMAGE',
      audio: 'AUDIO',
      ptt: 'AUDIO',
      video: 'VIDEO',
      document: 'DOCUMENT',
      sticker: 'STICKER',
    };
    const type = msgTypeMap[msgType] || 'TEXT';
    const inboundTimestamp = Number(msg.timestamp) > 0 ? new Date(Number(msg.timestamp) * 1000) : new Date();
    const conversation = await this.upsertConversationForContact({
      tenantId,
      numberId,
      rawWaId: from,
      name: notifyName,
      lastMessageAt: inboundTimestamp,
    });
    const linkedCampaignMessage = await this.findLatestCampaignMessageForInbound({
      conversationId: conversation.id,
      inboundTimestamp,
    });
    const linkedCampaignRecipient = linkedCampaignMessage?.campaignRecipientId
      ? {
        id: linkedCampaignMessage.campaignRecipientId,
        campaignId: linkedCampaignMessage.campaignId,
      }
      : await this.findLatestCampaignRecipientForInbound({
      numberId,
      rawWaId: from,
      inboundTimestamp,
      });

    let mediaPath: string | undefined;
    let mimeType: string | undefined;

    // Handle media download
    if (msg.hasMedia && msg.id) {
      try {
        const media = await this.manager.downloadMedia(numberId, msg.id);
        if (media) {
          const uploadDir = path.join(process.cwd(), 'uploads', tenantId, numberId);
          fs.mkdirSync(uploadDir, { recursive: true });
          const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
          const filename = `${Date.now()}.${ext}`;
          const filePath = path.join(uploadDir, filename);
          fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
          mediaPath = `/uploads/${tenantId}/${numberId}/${filename}`;
          mimeType = media.mimetype;
        }
      } catch (e) {
        this.logger.error(`Media download failed: ${e.message}`);
      }
    }

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        numberId,
        conversationId: conversation.id,
        campaignId: linkedCampaignRecipient?.campaignId || null,
        campaignRecipientId: linkedCampaignRecipient?.id || null,
        direction: 'INBOUND',
        from,
        to: String(msg.to || ''),
        type: type as any,
        text: msg.body || null,
        mediaPath,
        mimeType,
        timestamp: inboundTimestamp,
      },
    });

    this.gateway.emitMessage(tenantId, message);
    this.gateway.emitConversationUpdate(tenantId, { ...conversation, lastMessage: message });
  }

  private async processOutbound(data: any) {
    const { numberId, to, type, text, mediaPath, tenantId, campaignId, campaignRecipientId, sentAtOverride } = data;
    const resolvedTo = await this.resolveDestinationToJid(numberId, to);
    const sentAt = sentAtOverride instanceof Date
      ? sentAtOverride
      : sentAtOverride
        ? new Date(sentAtOverride)
        : new Date();
    let sentMessage: any;

    if (type === 'text' || !mediaPath) {
      sentMessage = await this.manager.sendTextMessage(numberId, resolvedTo, text);
    } else {
      const fullPath = path.join(process.cwd(), mediaPath);
      sentMessage = await this.manager.sendMediaMessage(numberId, resolvedTo, fullPath, text);
    }

    const conversation = await this.upsertConversationForContact({
      tenantId,
      numberId,
      rawWaId: this.resolveRemoteWaId(sentMessage, resolvedTo),
      lastMessageAt: sentAt,
    });

    const number = await this.prisma.whatsAppNumber.findUnique({ where: { id: numberId } });
    const messageTo = String(sentMessage?.to || sentMessage?.id?.remote || resolvedTo);

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        numberId,
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        from: number?.phoneNumber || numberId,
        to: messageTo,
        type: (type?.toUpperCase() || 'TEXT') as any,
        text: text || null,
        mediaPath,
        campaignId: campaignId || null,
        campaignRecipientId: campaignRecipientId || null,
        providerMessageId: this.resolveProviderMessageId(sentMessage),
        deliveryStatus: MessageDeliveryStatus.SENT,
        timestamp: sentAt,
      },
    });

    this.gateway.emitMessage(tenantId, message);
    this.gateway.emitConversationUpdate(tenantId, { ...conversation, lastMessage: message });
  }

  private async processCampaignRecipient(job: Job) {
    const { campaignId, recipientId, retryCount = 0 } = job.data;
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        tenantId: true,
        numberId: true,
        text: true,
        startedAt: true,
        attachments: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!campaign) {
      return;
    }

    const recipient = await this.prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      select: {
        id: true,
        phoneNumber: true,
        status: true,
      },
    });
    if (!recipient || recipient.status !== 'PENDING') {
      return;
    }

    try {
      const sentAt = new Date();

      await this.prisma.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'PROCESSING',
          ...(campaign.startedAt ? {} : { startedAt: sentAt }),
        },
      });

      if (campaign.text?.trim()) {
        await this.processOutbound({
          numberId: campaign.numberId,
          tenantId: campaign.tenantId,
          to: recipient.phoneNumber,
          type: 'text',
          text: campaign.text,
          campaignId,
          campaignRecipientId: recipient.id,
          sentAtOverride: sentAt,
        });
      }

      for (const attachment of campaign.attachments) {
        await this.processOutbound({
          numberId: campaign.numberId,
          tenantId: campaign.tenantId,
          to: recipient.phoneNumber,
          type: this.resolveMessageTypeFromMime(attachment.mimeType),
          mediaPath: attachment.storagePath,
          campaignId,
          campaignRecipientId: recipient.id,
          sentAtOverride: sentAt,
        });
      }

      const updated = await this.prisma.campaignRecipient.updateMany({
        where: { id: recipientId, status: 'PENDING' },
        data: {
          status: 'SENT',
          errorMessage: null,
          sentAt,
        },
      });

      if (updated.count > 0) {
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: {
            processedRecipients: { increment: 1 },
            sentRecipients: { increment: 1 },
          },
        });
      }
    } catch (error) {
      if (this.isNoActiveClientError(error) && retryCount < NO_ACTIVE_CLIENT_MAX_RETRIES) {
        try {
          if (!this.manager.getClient(campaign.numberId)) {
            await this.manager.startClient(campaign.numberId);
          }
        } catch (startError) {
          this.logger.warn(
            `No se pudo reactivar la sesi\u00f3n del n\u00famero ${campaign.numberId} antes del reintento de campa\u00f1a: ${startError instanceof Error ? startError.message : 'unknown error'}`,
          );
        }

        this.logger.warn(
          `Reencolando destinatario ${recipientId} de campa\u00f1a ${campaignId}: sesi\u00f3n WhatsApp todav\u00eda no activa (intento ${retryCount + 1}/${NO_ACTIVE_CLIENT_MAX_RETRIES})`,
        );
        await this.messageQueue.add(
          'send-campaign-recipient',
          {
            campaignId,
            recipientId,
            retryCount: retryCount + 1,
          },
          {
            delay: NO_ACTIVE_CLIENT_RETRY_DELAY_MS,
          },
        );
        return;
      }

      this.logger.error(
        `Fallo al enviar destinatario ${recipientId} de campa\u00f1a ${campaignId}: ${error instanceof Error ? error.message : 'Unknown send error'}`,
      );
      const updated = await this.prisma.campaignRecipient.updateMany({
        where: { id: recipientId, status: 'PENDING' },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown send error',
        },
      });

      if (updated.count > 0) {
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: {
            processedRecipients: { increment: 1 },
            failedRecipients: { increment: 1 },
          },
        });
      }
    } finally {
      await this.finalizeCampaignStatus(campaignId);
    }
  }

  private resolveMessageTypeFromMime(mimeType: string) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'document';
  }

  private async finalizeCampaignStatus(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        totalRecipients: true,
        processedRecipients: true,
        sentRecipients: true,
        failedRecipients: true,
      },
    });

    if (!campaign || campaign.processedRecipients < campaign.totalRecipients) {
      return;
    }

    let status: 'COMPLETED' | 'PARTIAL' | 'FAILED' = 'COMPLETED';
    if (campaign.failedRecipients === campaign.totalRecipients) {
      status = 'FAILED';
    } else if (campaign.failedRecipients > 0) {
      status = 'PARTIAL';
    }

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status,
        completedAt: new Date(),
      },
    });
  }
}
