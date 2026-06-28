import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@gaap/shared';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../authz/permissions.guard';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { CreateUserDto, ResetPasswordDto, SetIdentityDto, SetRolesDto, UpdateUserDto } from './dto';

@ApiTags('admin-users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(Permission.USER_MANAGE)
  list(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.users.list({
      q,
      status,
      role,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post()
  @RequirePermissions(Permission.USER_MANAGE)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(actor, dto);
  }

  @Get(':id')
  @RequirePermissions(Permission.USER_MANAGE)
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.USER_MANAGE)
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(actor, id, dto);
  }

  // Role changes are an escalation surface — restricted to the super administrator.
  @Put(':id/roles')
  @RequirePermissions(Permission.ROLE_MANAGE)
  setRoles(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: SetRolesDto) {
    return this.users.setRoles(actor, id, dto);
  }

  // Legal identity type (Individual / Company / Law firm / Arbitrator).
  @Patch(':id/identity')
  @RequirePermissions(Permission.ROLE_MANAGE)
  setIdentity(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: SetIdentityDto) {
    return this.users.setIdentityType(actor, id, dto.identityType);
  }

  // Pre-flight: is this account linked to anything? Drives Delete-vs-Archive in the UI.
  @Get(':id/delete-check')
  @RequirePermissions(Permission.USER_MANAGE)
  deleteCheck(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.deleteCheck(actor, id);
  }

  // Archive (soft-delete): the safe option for any linked account. USER_MANAGE.
  @Post(':id/archive')
  @RequirePermissions(Permission.USER_MANAGE)
  archive(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.archive(actor, id);
  }

  // PERMANENT delete — only for unlinked accounts; super administrator only.
  @Delete(':id')
  @RequirePermissions(Permission.ROLE_MANAGE)
  hardDelete(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.hardDelete(actor, id);
  }

  @Post(':id/restore')
  @RequirePermissions(Permission.USER_MANAGE)
  restore(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.restore(actor, id);
  }

  @Post(':id/reset-password')
  @RequirePermissions(Permission.USER_MANAGE)
  resetPassword(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(actor, id, dto);
  }

  // ---- Account-notification emails ----
  @Post(':id/send-enrollment')
  @RequirePermissions(Permission.USER_MANAGE)
  sendEnrollment(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.sendEnrollmentEmail(actor, id);
  }

  @Post(':id/send-password-setup')
  @RequirePermissions(Permission.USER_MANAGE)
  sendPasswordSetup(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.sendPasswordSetupEmail(actor, id);
  }

  @Get(':id/email-deliveries')
  @RequirePermissions(Permission.USER_MANAGE)
  emailDeliveries(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.listEmailDeliveries(actor, id);
  }
}
