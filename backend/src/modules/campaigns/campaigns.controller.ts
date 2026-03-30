import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CampaignsService, CreateCampaignDto } from './campaigns.service';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private campaignsService: CampaignsService) {}

  @Get()
  findAll(@Request() req, @Query('q') query?: string) {
    return this.campaignsService.findAll(req.user, query);
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'recipientsFile', maxCount: 1 },
        { name: 'attachments', maxCount: 10 },
      ],
      {
        storage: memoryStorage(),
        limits: {
          files: 11,
          fileSize: 15 * 1024 * 1024,
        },
      },
    ),
  )
  create(
    @Body() dto: CreateCampaignDto,
    @UploadedFiles()
    files: {
      recipientsFile?: Express.Multer.File[];
      attachments?: Express.Multer.File[];
    },
    @Request() req,
  ) {
    return this.campaignsService.create(
      dto,
      files?.recipientsFile?.[0],
      files?.attachments || [],
      req.user,
    );
  }
}
