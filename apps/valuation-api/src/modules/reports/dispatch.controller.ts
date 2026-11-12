import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, StreamableFile, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AssignmentAccessGuard } from '../../common/auth/assignment-access.guard.js';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { DispatchService } from './dispatch.service.js';

class SetCheckDto {
  @IsBoolean() checked!: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class SubmitReportDto {
  // Only used when the case has no fee recorded.
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(100000000) amount?: number;
}

class ReworkDto {
  @IsIn(['DRAFTER', 'REINSPECTION', 'DOCUMENTS']) kind!: 'DRAFTER' | 'REINSPECTION' | 'DOCUMENTS';
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @IsOptional() @IsDateString({ strict: true }) dueDate?: string;
}

class ReopenDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

class SendReportDto {
  @IsIn(['EMAIL', 'WHATSAPP', 'OTHER']) channel!: 'EMAIL' | 'WHATSAPP' | 'OTHER';
  @IsString() @MinLength(3) @MaxLength(200) recipient!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

// The valuer's last step: tick the key items, approve (which raises the bill), then send to the bank.
@UseGuards(AssignmentAccessGuard)
@Roles('FIRM_ADMIN', 'VALUER')
@Controller('assignments/:assignmentId/dispatch')
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  state(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.dispatch.state(user.firmId, assignmentId);
  }

  @Put('checks/:itemKey')
  check(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Param('itemKey') itemKey: string, @Body() dto: SetCheckDto) {
    return this.dispatch.setCheck(user.firmId, user.userId, assignmentId, itemKey, dto.checked, dto.note);
  }

  @Post('submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: SubmitReportDto) {
    return this.dispatch.submit(user.firmId, user.userId, assignmentId, dto?.amount);
  }

  @Get('final')
  async final(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    const { bytes, name } = await this.dispatch.finalFile(user.firmId, assignmentId);
    return new StreamableFile(bytes, { type: 'application/pdf', disposition: `attachment; filename="${name}"` });
  }

  @Post('reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: ReopenDto) {
    return this.dispatch.reopen(user.firmId, user.userId, assignmentId, dto.reason);
  }

  @Post('rework')
  @HttpCode(200)
  rework(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: ReworkDto) {
    return this.dispatch.requestRework(user.firmId, user.userId, assignmentId, dto);
  }

  @Post('send')
  @HttpCode(200)
  send(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: SendReportDto) {
    return this.dispatch.send(user.firmId, user.userId, assignmentId, dto);
  }
}
