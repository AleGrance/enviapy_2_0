import { Controller, Post, Get, Body, Param, Query, UseGuards, Request, UseInterceptors, UploadedFile } from '@nestjs/common';
import { MessagesService, SendMessageDto } from './messages.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private messagesService: MessagesService) {}

  @Post('send')
  send(@Body() dto: SendMessageDto, @Request() req) {
    return this.messagesService.send(dto, req.user);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req: any, file, cb) => {
          const dir = path.join(process.cwd(), 'uploads', 'temp');
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const ext = path.extname(file.originalname);
          cb(null, `${Date.now()}${ext}`);
        },
      }),
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return { mediaPath: `/uploads/temp/${file.filename}` };
  }

  @Get('conversation/:conversationId')
  findByConversation(
    @Param('conversationId') conversationId: string,
    @Request() req,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.messagesService.findByConversation(conversationId, req.user, +page || 1, +limit || 50);
  }
}
