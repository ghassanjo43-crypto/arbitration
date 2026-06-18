import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { UploadDocumentDto, UploadedFileLike } from './dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('cases/:caseId/documents')
  @ApiConsumes('multipart/form-data')
  // Hard cap at the transport layer; the service re-checks against MAX_UPLOAD_MB.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('caseId') caseId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.documents.upload(user, caseId, dto, file);
  }

  @Get('cases/:caseId/documents')
  list(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.documents.listForCase(user, caseId);
  }

  @Get('documents/:id')
  meta(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.getMeta(user, id);
  }

  @Get('documents/:id/activity')
  activity(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.activity(user, id);
  }

  @Get('documents/:id/download')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { buffer, fileName, mimeType } = await this.documents.download(user, id, req.ip);
    res.set({
      'Content-Type': mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(buffer);
  }
}
