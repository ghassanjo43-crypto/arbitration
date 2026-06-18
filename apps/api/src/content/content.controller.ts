import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ContentService } from './content.service';

@ApiTags('content')
@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('news')
  listNews(@Query('page') page?: string) {
    return this.content.listNews(page ? parseInt(page, 10) : 1);
  }

  @Get('news/:slug')
  getNews(@Param('slug') slug: string) {
    return this.content.getNews(slug);
  }

  @Get('court-highlights')
  listHighlights(@Query('page') page?: string) {
    return this.content.listHighlights(page ? parseInt(page, 10) : 1);
  }

  @Get('court-highlights/:slug')
  getHighlight(@Param('slug') slug: string) {
    return this.content.getHighlight(slug);
  }

  @Get('publications')
  listPublications(@Query('page') page?: string) {
    return this.content.listPublications(page ? parseInt(page, 10) : 1);
  }
}
