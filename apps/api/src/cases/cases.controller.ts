import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CasesService } from './cases.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { AddCaseNoteDto, CreateCaseDraftDto, DeliberationNoteDto, ProceduralOrderDto, SubmitCaseDto, UpdateCaseAdminDto } from './dto';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(JwtAuthGuard)
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Post('draft')
  createDraft(@CurrentUser() user: AuthUser, @Body() dto: CreateCaseDraftDto) {
    return this.cases.createDraft(user, dto);
  }

  @Get()
  myCases(@CurrentUser() user: AuthUser) {
    return this.cases.listMyCases(user);
  }

  @Get(':id')
  getCase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cases.getCase(user, id);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SubmitCaseDto) {
    return this.cases.submit(user, id, dto);
  }

  // Tribunal-only. The service rejects anyone who is not an appointed tribunal
  // member on this case — including registrars, admins and super-admins.
  @Get(':id/deliberations')
  listDeliberations(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cases.listDeliberations(user, id);
  }

  @Post(':id/deliberations')
  addDeliberation(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeliberationNoteDto) {
    return this.cases.addDeliberation(user, id, dto);
  }

  // Registrar/administrative editing of non-merits case information + notes.
  @Patch(':id/admin')
  updateAdmin(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCaseAdminDto) {
    return this.cases.updateAdminInfo(user, id, dto);
  }

  @Get(':id/admin-notes')
  listAdminNotes(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cases.listAdminNotes(user, id);
  }

  @Post(':id/admin-notes')
  addAdminNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddCaseNoteDto) {
    return this.cases.addAdminNote(user, id, dto);
  }

  @Get(':id/procedural-orders')
  listOrders(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cases.listProceduralOrders(user, id);
  }

  @Post(':id/procedural-orders')
  issueOrder(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ProceduralOrderDto) {
    return this.cases.issueProceduralOrder(user, id, dto);
  }
}
