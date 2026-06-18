import { Module } from '@nestjs/common';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { ContentAdminService } from './admin/content-admin.service';
import { ContentAdminController } from './admin/content-admin.controller';

@Module({
  providers: [ContentService, ContentAdminService],
  controllers: [ContentController, ContentAdminController],
})
export class ContentModule {}
