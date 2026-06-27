import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArbitratorsService } from './arbitrators.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';

// The arbitrator directory is available to authenticated users only.
@ApiTags('arbitrators')
@ApiBearerAuth()
@Controller('arbitrators')
@UseGuards(JwtAuthGuard)
export class ArbitratorsController {
  constructor(private readonly service: ArbitratorsService) {}

  /** Directory search — requires authentication. */
  @Get()
  search(
    @Query('q') q?: string,
    @Query('legalField') legalField?: string,
    @Query('industry') industry?: string,
    @Query('language') language?: string,
    @Query('nationality') nationality?: string,
    @Query('country') country?: string,
    @Query('availability') availability?: string,
    @Query('feeBand') feeBand?: string,
    @Query('minYears') minYears?: string,
    @Query('minSole') minSole?: string,
    @Query('minChair') minChair?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.search({
      q,
      legalField,
      industry,
      language,
      nationality,
      country,
      availability,
      feeBand,
      minYears: minYears ? parseInt(minYears, 10) : undefined,
      minSole: minSole ? parseInt(minSole, 10) : undefined,
      minChair: minChair ? parseInt(minChair, 10) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  /**
   * Internal administrative listing including each arbitrator's ACCESS (login)
   * email. Authorisation is enforced in the service (Super Admin/Admin, Registrar,
   * Council). Declared before ':id' so the static path is matched first.
   */
  @Get('internal')
  listInternal(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listInternal(user, {
      q,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const result = await this.service.findOne(id);
    if (!result) throw new NotFoundException('Arbitrator not found.');
    return result;
  }
}
