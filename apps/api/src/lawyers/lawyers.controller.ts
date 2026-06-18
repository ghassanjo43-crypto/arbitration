import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LawyersService } from './lawyers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { UpsertLawyerProfileDto } from './dto';

@ApiTags('lawyers')
@ApiBearerAuth()
@Controller('lawyers')
@UseGuards(JwtAuthGuard)
export class LawyersController {
  constructor(private readonly lawyers: LawyersService) {}

  @Get('me')
  myProfile(@CurrentUser() user: AuthUser) {
    return this.lawyers.getMyProfile(user);
  }

  @Put('me')
  upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertLawyerProfileDto) {
    return this.lawyers.upsertProfile(user, dto);
  }

  @Get('me/dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.lawyers.dashboard(user);
  }
}
