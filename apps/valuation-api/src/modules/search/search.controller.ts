import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { SearchQuery } from './search.dto.js';
import { SearchService } from './search.service.js';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(@CurrentUser() user: AuthUser, @Query() query: SearchQuery) {
    return this.search.search(user, query);
  }
}
