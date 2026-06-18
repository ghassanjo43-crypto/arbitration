import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { SendMessageDto } from './dto';

@ApiTags('messages')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('cases/:caseId/messages')
  list(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.messages.listForCase(user, caseId);
  }

  @Post('cases/:caseId/messages')
  send(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() dto: SendMessageDto) {
    return this.messages.send(user, caseId, dto);
  }

  @Post('messages/:id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.messages.markRead(user, id);
  }
}
