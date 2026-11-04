import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { PaginationQuery } from '../../common/pagination/pagination.dto.js';
import { CreateBankDto, CreateBranchDto, UpdateBankDto, UpdateBranchDto } from './banks.dto.js';
import { BanksService } from './banks.service.js';

@Controller('banks')
export class BanksController {
  constructor(private readonly banks: BanksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: PaginationQuery) {
    return this.banks.list(user.firmId, query);
  }

  @Roles('FIRM_ADMIN')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBankDto) {
    return this.banks.create(user.firmId, user.userId, dto);
  }

  @Roles('FIRM_ADMIN')
  @Post(':bankId/branches')
  createBranch(
    @CurrentUser() user: AuthUser,
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.banks.createBranch(user.firmId, user.userId, bankId, dto);
  }

  @Roles('FIRM_ADMIN')
  @Patch(':bankId')
  rename(@CurrentUser() user: AuthUser, @Param('bankId', ParseUUIDPipe) bankId: string, @Body() dto: UpdateBankDto) {
    return this.banks.rename(user.firmId, user.userId, bankId, dto);
  }

  @Roles('FIRM_ADMIN')
  @Patch(':bankId/branches/:branchId')
  updateBranch(
    @CurrentUser() user: AuthUser,
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.banks.updateBranch(user.firmId, user.userId, bankId, branchId, dto);
  }
}
