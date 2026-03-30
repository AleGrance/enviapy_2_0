import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CampaignStatus, Prisma } from '@prisma/client';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma.service';

const RECIPIENT_FILE_EXTENSIONS = new Set(['.csv', '.xls', '.xlsx']);
const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_ATTACHMENTS = 5;
const MAX_ATTACHMENTS = 10;
const MAX_RECIPIENTS = 10000;
const campaignResponseSelect = Prisma.validator<Prisma.CampaignSelect>()({
  id: true,
  tenantId: true,
  createdById: true,
  numberId: true,
  name: true,
  text: true,
  recipientsFileName: true,
  recipientsFilePath: true,
  status: true,
  totalRecipients: true,
  processedRecipients: true,
  sentRecipients: true,
  failedRecipients: true,
  scheduledAt: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: {
    select: {
      id: true,
      email: true,
    },
  },
  number: {
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      tenantId: true,
    },
  },
  attachments: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      originalName: true,
      storagePath: true,
      mimeType: true,
      size: true,
      sortOrder: true,
    },
  },
  recipients: {
    orderBy: { createdAt: 'asc' },
    take: 5,
    select: {
      id: true,
      phoneNumber: true,
      status: true,
    },
  },
});

type CampaignResponse = Prisma.CampaignGetPayload<{
  select: typeof campaignResponseSelect;
}>;

type CampaignResponseWithMetrics = CampaignResponse & {
  deliveredRecipients: number;
  readRecipients: number;
  respondedRecipients: number;
};

interface CampaignMetricsRow {
  campaignId: string;
  deliveredRecipients: bigint | number;
  readRecipients: bigint | number;
  respondedRecipients: bigint | number;
}

export class CreateCampaignDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsUUID()
  numberId: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsUUID()
  sourceCampaignId?: string;
}

interface AuthUser {
  id: string;
  role: string;
  tenantId: string;
  numberId?: string | null;
  campaignsEnabled?: boolean;
}

@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('messages') private messageQueue: Queue,
  ) {}

  async create(
    dto: CreateCampaignDto,
    recipientsFile: Express.Multer.File | undefined,
    attachments: Express.Multer.File[] = [],
    user: AuthUser,
  ) {
    this.ensureCampaignsEnabled(user);

    const name = dto.name?.trim();
    if (!name) {
      throw new BadRequestException('Debes indicar un nombre para la campaña');
    }

    const sourceCampaign = dto.sourceCampaignId
      ? await this.findSourceCampaignForReuse(dto.sourceCampaignId, user)
      : null;
    const text = this.normalizeMessageText(dto.text);
    const reusableAttachments = attachments.length === 0 ? sourceCampaign?.attachments || [] : [];
    if (!text?.trim() && reusableAttachments.length === 0 && attachments.length === 0) {
      throw new BadRequestException('Escribe un mensaje o adjunta al menos un archivo');
    }

    if (!recipientsFile && !sourceCampaign) {
      throw new BadRequestException('Debes subir un archivo csv, xls o xlsx con los destinatarios');
    }

    if (recipientsFile) {
      this.validateRecipientsFile(recipientsFile);
    }
    this.validateAttachments(attachments);

    const effectiveNumberId = user.role === 'CLIENT' ? user.numberId || '' : dto.numberId;
    if (!effectiveNumberId) {
      throw new BadRequestException('Debes seleccionar un numero emisor');
    }

    const number = await this.resolveAccessibleNumber(effectiveNumberId, user);
    const scheduledAt = this.parseScheduledAt(dto.scheduledAt);
    const recipients = recipientsFile
      ? this.parseRecipientsFile(recipientsFile)
      : this.parseRecipientsFile(
          this.readStoredCampaignFile(sourceCampaign?.recipientsFilePath || '', sourceCampaign?.recipientsFileName || ''),
        );
    if (recipients.length === 0) {
      throw new BadRequestException('No se encontraron numeros validos en el archivo subido');
    }

    if (recipients.length > MAX_RECIPIENTS) {
      throw new BadRequestException(`El archivo supera el maximo de ${MAX_RECIPIENTS} destinatarios`);
    }

    const campaignId = randomUUID();
    const campaignDir = path.join(process.cwd(), 'uploads', 'campaigns', number.tenantId, campaignId);
    fs.mkdirSync(campaignDir, { recursive: true });

    try {
      const effectiveRecipientsFile = recipientsFile
        || this.readStoredCampaignFile(sourceCampaign?.recipientsFilePath || '', sourceCampaign?.recipientsFileName || '');
      const recipientsFileStored = this.writeFileToCampaignDirectory(
        campaignDir,
        `recipients-${Date.now()}`,
        effectiveRecipientsFile.originalname,
        effectiveRecipientsFile.buffer,
      );

      const filesToPersist = attachments.length > 0
        ? attachments
        : reusableAttachments.map((attachment) => this.readStoredCampaignFile(attachment.storagePath, attachment.originalName, attachment.mimeType));
      const attachmentRecords = filesToPersist.map((file, index) => {
        const stored = this.writeFileToCampaignDirectory(
          campaignDir,
          `attachment-${index + 1}-${Date.now()}`,
          file.originalname,
          file.buffer,
        );

        return {
          id: randomUUID(),
          campaignId,
          originalName: file.originalname,
          storagePath: stored.publicPath,
          mimeType: file.mimetype || 'application/octet-stream',
          size: file.size,
          sortOrder: index,
        };
      });

      const uniqueRecipients = Array.from(new Set(recipients));
      const recipientRecords = uniqueRecipients.map((phoneNumber) => ({
        id: randomUUID(),
        campaignId,
        phoneNumber,
      }));

      await this.prisma.$transaction(async (tx) => {
        await tx.campaign.create({
          data: {
            id: campaignId,
            tenantId: number.tenantId,
            createdById: user.id,
            numberId: number.id,
            name,
            text: text ?? null,
            recipientsFileName: effectiveRecipientsFile.originalname,
            recipientsFilePath: recipientsFileStored.publicPath,
            status: scheduledAt ? CampaignStatus.SCHEDULED : CampaignStatus.PROCESSING,
            totalRecipients: recipientRecords.length,
            scheduledAt,
            startedAt: scheduledAt ? null : new Date(),
          },
        });

        await tx.campaignRecipient.createMany({
          data: recipientRecords,
        });

        if (attachmentRecords.length > 0) {
          await tx.campaignAttachment.createMany({
            data: attachmentRecords,
          });
        }
      });

      try {
        const delayBase = scheduledAt ? Math.max(scheduledAt.getTime() - Date.now(), 0) : 0;
        await this.messageQueue.addBulk(
          recipientRecords.map((recipient, index) => ({
            name: 'send-campaign-recipient',
            data: {
              campaignId,
              recipientId: recipient.id,
            },
            opts: {
              delay: delayBase + index * 10000,
            },
          })),
        );
      } catch (queueError) {
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: {
            status: CampaignStatus.FAILED,
            completedAt: new Date(),
          },
        });
        throw queueError;
      }

      return this.findOneForResponse(campaignId, user);
    } catch (error) {
      const campaignExists = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true },
      });

      if (!campaignExists) {
        try {
          fs.rmSync(campaignDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup for partially created campaign files.
        }
      }
      throw error;
    }
  }

  async findAll(user: AuthUser, query?: string) {
    this.ensureCampaignsEnabled(user);

    if (user.role === 'CLIENT' && !user.numberId) {
      return [];
    }

    const where: Prisma.CampaignWhereInput =
      user.role === 'SUPER_ADMIN'
        ? {}
        : user.role === 'TENANT_ADMIN'
          ? { tenantId: user.tenantId }
          : { tenantId: user.tenantId, numberId: user.numberId || '__no_number__' };

    const search = String(query || '').trim();

    const campaigns = await this.prisma.campaign.findMany({
      where: search
        ? {
            ...where,
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { text: { contains: search, mode: 'insensitive' } },
            ],
          }
        : where,
      orderBy: { createdAt: 'desc' },
      select: campaignResponseSelect,
    });

    return this.attachComputedMetrics(campaigns);
  }

  async findOneForResponse(id: string, user: AuthUser) {
    this.ensureCampaignsEnabled(user);

    const where: Prisma.CampaignWhereInput =
      user.role === 'SUPER_ADMIN'
        ? { id }
        : user.role === 'TENANT_ADMIN'
          ? { id, tenantId: user.tenantId }
          : { id, tenantId: user.tenantId, numberId: user.numberId || '__no_number__' };

    const campaign = await this.prisma.campaign.findFirst({
      where,
      select: campaignResponseSelect,
    });

    if (!campaign) {
      throw new NotFoundException('Campaña no encontrada');
    }

    const [campaignWithMetrics] = await this.attachComputedMetrics([campaign]);
    return campaignWithMetrics;
  }

  private ensureCampaignsEnabled(user: AuthUser) {
    if (!user.campaignsEnabled) {
      throw new ForbiddenException('El modulo de campañas esta deshabilitado para este usuario');
    }
  }

  private async findSourceCampaignForReuse(id: string, user: AuthUser) {
    const where: Prisma.CampaignWhereInput =
      user.role === 'SUPER_ADMIN'
        ? { id }
        : user.role === 'TENANT_ADMIN'
          ? { id, tenantId: user.tenantId }
          : { id, tenantId: user.tenantId, numberId: user.numberId || '__no_number__' };

    const campaign = await this.prisma.campaign.findFirst({
      where,
      select: {
        id: true,
        recipientsFileName: true,
        recipientsFilePath: true,
        attachments: {
          orderBy: { sortOrder: 'asc' },
          select: {
            originalName: true,
            storagePath: true,
            mimeType: true,
            size: true,
          },
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException('Campaña origen no encontrada');
    }

    return campaign;
  }

  private async resolveAccessibleNumber(numberId: string, user: AuthUser) {
    const where: Prisma.WhatsAppNumberWhereInput =
      user.role === 'SUPER_ADMIN'
        ? { id: numberId }
        : user.role === 'TENANT_ADMIN'
          ? { id: numberId, tenantId: user.tenantId }
          : { id: numberId, tenantId: user.tenantId };

    const number = await this.prisma.whatsAppNumber.findFirst({
      where,
      select: {
        id: true,
        tenantId: true,
        name: true,
        phoneNumber: true,
      },
    });

    if (!number) {
      throw new NotFoundException('Numero no encontrado');
    }

    if (user.role === 'CLIENT' && user.numberId !== number.id) {
      throw new NotFoundException('Numero no encontrado');
    }

    return number;
  }

  private validateRecipientsFile(file: Express.Multer.File) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!RECIPIENT_FILE_EXTENSIONS.has(extension)) {
      throw new BadRequestException('El archivo de destinatarios debe ser csv, xls o xlsx');
    }
  }

  private validateAttachments(files: Express.Multer.File[]) {
    if (files.length > MAX_ATTACHMENTS) {
      throw new BadRequestException(`Puedes adjuntar hasta ${MAX_ATTACHMENTS} archivos`);
    }

    const imageFiles = files.filter((file) => file.mimetype?.startsWith('image/'));
    if (imageFiles.length > MAX_IMAGE_ATTACHMENTS) {
      throw new BadRequestException(`Puedes subir hasta ${MAX_IMAGE_ATTACHMENTS} imagenes por campaña`);
    }

    const oversizedImage = imageFiles.find((file) => file.size > IMAGE_LIMIT_BYTES);
    if (oversizedImage) {
      throw new BadRequestException(`La imagen ${oversizedImage.originalname} supera el limite de 5 MB`);
    }
  }

  private parseRecipientsFile(file: Express.Multer.File): string[] {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return [];
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
    });

    if (!rows.length) {
      return [];
    }

    const recipientColumn = this.resolveRecipientColumn(rows);
    const dataRows = recipientColumn >= 0 ? rows.slice(1) : rows;

    const recipients: string[] = [];
    for (const row of dataRows) {
      const candidateValues = recipientColumn >= 0 ? [row[recipientColumn]] : row;
      for (const value of candidateValues) {
        const normalized = this.normalizePhoneNumber(value);
        if (normalized) {
          recipients.push(normalized);
          break;
        }
      }
    }

    return recipients;
  }

  private resolveRecipientColumn(rows: (string | number | null)[][]) {
    const headerKeywords = ['telefono', 'tel', 'phone', 'numero', 'celular', 'whatsapp', 'waid'];
    const headerRow = (rows[0] || []).map((value) => String(value || '').trim().toLowerCase());
    return headerRow.findIndex((value) => headerKeywords.some((keyword) => value.includes(keyword)));
  }

  private normalizePhoneNumber(value: string | number | null | undefined) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    const withoutJid = raw.includes('@') ? raw.split('@')[0] : raw;
    let digits = withoutJid.replace(/[^\d]/g, '');
    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    }

    if (digits.length < 8 || digits.length > 18) {
      return null;
    }

    return digits;
  }

  private parseScheduledAt(value: string | undefined) {
    if (!value?.trim()) {
      return null;
    }

    const scheduledAt = new Date(value);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('La fecha programada es invalida');
    }

    if (scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('La fecha programada debe ser posterior a la fecha y hora actual');
    }

    return scheduledAt;
  }

  private normalizeMessageText(value: string | undefined) {
    if (value === undefined || value === null) {
      return null;
    }

    return String(value).replace(/\r\n/g, '\n');
  }

  private readStoredCampaignFile(publicPath: string, originalName: string, mimeType?: string): Express.Multer.File {
    const normalizedPath = String(publicPath || '').trim();
    if (!normalizedPath) {
      throw new BadRequestException('El archivo almacenado de la campaña no esta disponible');
    }

    const fullPath = path.join(process.cwd(), normalizedPath.replace(/^\//, '').replace(/\//g, path.sep));
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(`No se encontro el archivo almacenado ${originalName}`);
    }

    const buffer = fs.readFileSync(fullPath);
    return {
      fieldname: 'storedFile',
      originalname: originalName,
      encoding: '7bit',
      mimetype: mimeType || 'application/octet-stream',
      size: buffer.length,
      buffer,
      destination: '',
      filename: path.basename(fullPath),
      path: fullPath,
      stream: undefined as any,
    };
  }

  private writeFileToCampaignDirectory(
    campaignDir: string,
    prefix: string,
    originalName: string,
    buffer: Buffer,
  ) {
    const ext = path.extname(originalName) || '';
    const safeBase = path
      .basename(originalName, ext)
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      || 'file';
    const fileName = `${prefix}-${safeBase}${ext.toLowerCase()}`;
    const fullPath = path.join(campaignDir, fileName);
    fs.writeFileSync(fullPath, buffer);

    const relativeDir = path.relative(process.cwd(), campaignDir).replace(/\\/g, '/');
    return {
      fileName,
      publicPath: `/${relativeDir}/${fileName}`,
    };
  }

  private async attachComputedMetrics(campaigns: CampaignResponse[]): Promise<CampaignResponseWithMetrics[]> {
    if (campaigns.length === 0) {
      return [];
    }

    const metricsByCampaignId = await this.loadCampaignMetrics(campaigns.map((campaign) => campaign.id));

    return campaigns.map((campaign) => {
      const metrics = metricsByCampaignId.get(campaign.id);
      return {
        ...campaign,
        deliveredRecipients: metrics?.deliveredRecipients ?? 0,
        readRecipients: metrics?.readRecipients ?? 0,
        respondedRecipients: metrics?.respondedRecipients ?? 0,
      };
    });
  }

  private async loadCampaignMetrics(campaignIds: string[]) {
    if (campaignIds.length === 0) {
      return new Map<string, Pick<CampaignResponseWithMetrics, 'deliveredRecipients' | 'readRecipients' | 'respondedRecipients'>>();
    }

    const rows = await this.prisma.$queryRaw<CampaignMetricsRow[]>(Prisma.sql`
      WITH recipient_windows AS (
        SELECT
          cr."campaignId",
          cr."phoneNumber",
          cr."sentAt",
          c."numberId",
          LEAD(cr."sentAt") OVER (
            PARTITION BY c."numberId", cr."phoneNumber"
            ORDER BY cr."sentAt"
          ) AS "nextSentAt"
        FROM "CampaignRecipient" cr
        INNER JOIN "Campaign" c ON c.id = cr."campaignId"
        WHERE cr."campaignId" IN (${Prisma.join(campaignIds)})
          AND cr.status = 'SENT'
          AND cr."sentAt" IS NOT NULL
      ),
      recipient_windows_normalized AS (
        SELECT
          rw."campaignId",
          rw."phoneNumber",
          rw."sentAt",
          rw."numberId",
          rw."nextSentAt",
          regexp_replace(rw."phoneNumber", '[^0-9]', '', 'g') AS "normalizedPhoneNumber"
        FROM recipient_windows rw
      )
      SELECT
        rw."campaignId" AS "campaignId",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM "Message" m
            WHERE (
                (
                  m."campaignRecipientId" IS NOT NULL
                  AND m."campaignRecipientId" IN (
                    SELECT cr.id
                    FROM "CampaignRecipient" cr
                    WHERE cr."campaignId" = rw."campaignId"
                      AND cr."phoneNumber" = rw."phoneNumber"
                  )
                )
                OR (
                  m."numberId" = rw."numberId"
                  AND (
                    regexp_replace(COALESCE(m."to", ''), '[^0-9]', '', 'g') = rw."normalizedPhoneNumber"
                    OR regexp_replace(COALESCE(m."to", ''), '[^0-9]', '', 'g') LIKE '%' || rw."normalizedPhoneNumber"
                    OR rw."normalizedPhoneNumber" LIKE '%' || regexp_replace(COALESCE(m."to", ''), '[^0-9]', '', 'g')
                  )
                  AND m."timestamp" >= rw."sentAt" - interval '1 minute'
                  AND (rw."nextSentAt" IS NULL OR m."timestamp" < rw."nextSentAt")
                )
              )
              AND m.direction = 'OUTBOUND'
              AND m."deliveryStatus" IN ('RECEIVED', 'READ')
          )
        ) AS "deliveredRecipients",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM "Message" m
            WHERE (
                (
                  m."campaignRecipientId" IS NOT NULL
                  AND m."campaignRecipientId" IN (
                    SELECT cr.id
                    FROM "CampaignRecipient" cr
                    WHERE cr."campaignId" = rw."campaignId"
                      AND cr."phoneNumber" = rw."phoneNumber"
                  )
                )
                OR (
                  m."numberId" = rw."numberId"
                  AND (
                    regexp_replace(COALESCE(m."to", ''), '[^0-9]', '', 'g') = rw."normalizedPhoneNumber"
                    OR regexp_replace(COALESCE(m."to", ''), '[^0-9]', '', 'g') LIKE '%' || rw."normalizedPhoneNumber"
                    OR rw."normalizedPhoneNumber" LIKE '%' || regexp_replace(COALESCE(m."to", ''), '[^0-9]', '', 'g')
                  )
                  AND m."timestamp" >= rw."sentAt" - interval '1 minute'
                  AND (rw."nextSentAt" IS NULL OR m."timestamp" < rw."nextSentAt")
                )
              )
              AND m.direction = 'OUTBOUND'
              AND m."deliveryStatus" = 'READ'
          )
        ) AS "readRecipients",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM "Message" m
            WHERE (
                (
                  m."campaignRecipientId" IS NOT NULL
                  AND m."campaignRecipientId" IN (
                    SELECT cr.id
                    FROM "CampaignRecipient" cr
                    WHERE cr."campaignId" = rw."campaignId"
                      AND cr."phoneNumber" = rw."phoneNumber"
                  )
                )
                OR (
                  m."numberId" = rw."numberId"
                  AND (
                    regexp_replace(COALESCE(m."from", ''), '[^0-9]', '', 'g') = rw."normalizedPhoneNumber"
                    OR regexp_replace(COALESCE(m."from", ''), '[^0-9]', '', 'g') LIKE '%' || rw."normalizedPhoneNumber"
                    OR rw."normalizedPhoneNumber" LIKE '%' || regexp_replace(COALESCE(m."from", ''), '[^0-9]', '', 'g')
                  )
                  AND m."timestamp" >= rw."sentAt"
                  AND (rw."nextSentAt" IS NULL OR m."timestamp" < rw."nextSentAt")
                )
              )
              AND m.direction = 'INBOUND'
          )
        ) AS "respondedRecipients"
      FROM recipient_windows_normalized rw
      GROUP BY rw."campaignId"
    `);

    return new Map(
      rows.map((row) => [
        row.campaignId,
        {
          deliveredRecipients: Number(row.deliveredRecipients ?? 0),
          readRecipients: Number(row.readRecipients ?? 0),
          respondedRecipients: Number(row.respondedRecipients ?? 0),
        },
      ]),
    );
  }
}
