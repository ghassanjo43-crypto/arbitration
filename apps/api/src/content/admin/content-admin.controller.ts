import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ContentStatus } from '@prisma/client';
import { Permission } from '@gaap/shared';
import { ContentAdminService } from './content-admin.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../authz/permissions.guard';
import { RequirePermissions } from '../../authz/permissions.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/types';
import { UpsertCourtHighlightDto, UpsertNewsDto, UpsertPublicationDto } from './dto';

@ApiTags('content-admin')
@ApiBearerAuth()
@Controller('admin/content')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContentAdminController {
  constructor(private readonly cms: ContentAdminService) {}

  // News
  @Get('news')
  @RequirePermissions(Permission.NEWS_MANAGE)
  listNews() {
    return this.cms.listNews();
  }

  @Post('news')
  @RequirePermissions(Permission.NEWS_MANAGE)
  createNews(@CurrentUser() user: AuthUser, @Body() dto: UpsertNewsDto) {
    return this.cms.createNews(user, dto);
  }

  @Put('news/:id')
  @RequirePermissions(Permission.NEWS_MANAGE)
  updateNews(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpsertNewsDto) {
    return this.cms.updateNews(user, id, dto);
  }

  @Post('news/:id/publish')
  @RequirePermissions(Permission.NEWS_MANAGE)
  publishNews(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cms.setStatus(user, 'news', id, ContentStatus.PUBLISHED);
  }

  @Post('news/:id/archive')
  @RequirePermissions(Permission.NEWS_MANAGE)
  archiveNews(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cms.setStatus(user, 'news', id, ContentStatus.ARCHIVED);
  }

  // Court highlights
  @Get('court-highlights')
  @RequirePermissions(Permission.COURT_HIGHLIGHT_MANAGE)
  listHighlights() {
    return this.cms.listHighlights();
  }

  @Post('court-highlights')
  @RequirePermissions(Permission.COURT_HIGHLIGHT_MANAGE)
  createHighlight(@CurrentUser() user: AuthUser, @Body() dto: UpsertCourtHighlightDto) {
    return this.cms.createHighlight(user, dto);
  }

  @Post('court-highlights/:id/publish')
  @RequirePermissions(Permission.COURT_HIGHLIGHT_MANAGE)
  publishHighlight(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cms.setStatus(user, 'highlight', id, ContentStatus.PUBLISHED);
  }

  // Publications
  @Get('publications')
  @RequirePermissions(Permission.PUBLICATION_MANAGE)
  listPublications() {
    return this.cms.listPublications();
  }

  @Post('publications')
  @RequirePermissions(Permission.PUBLICATION_MANAGE)
  createPublication(@CurrentUser() user: AuthUser, @Body() dto: UpsertPublicationDto) {
    return this.cms.createPublication(user, dto);
  }

  @Post('publications/:id/publish')
  @RequirePermissions(Permission.PUBLICATION_MANAGE)
  publishPublication(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cms.setStatus(user, 'publication', id, ContentStatus.PUBLISHED);
  }
}
