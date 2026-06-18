import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  providers: [AuthService, PasswordService, TokensService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService, TokensService, PasswordService],
})
export class AuthModule {}
