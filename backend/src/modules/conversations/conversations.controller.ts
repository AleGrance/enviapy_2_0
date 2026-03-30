import { Controller, Delete, Get, Param, Post, Query, UseGuards, Request } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private conversationsService: ConversationsService) {}

  @Get()
  findAll(@Request() req, @Query('numberId') numberId?: string, @Query('q') query?: string) {
    return this.conversationsService.findAll(req.user, numberId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.conversationsService.findOneAccessible(id, req.user);
  }

  @Post(':id/clear')
  clear(@Param('id') id: string, @Request() req) {
    return this.conversationsService.clearConversation(id, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.conversationsService.deleteConversation(id, req.user);
  }
}
