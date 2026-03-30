import { Controller, Get, Post, Patch, Body, Param, UseGuards, Query, Request } from '@nestjs/common';
import { UsersService, CreateUserDto, UpdateUserDto } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'TENANT_ADMIN')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto, @Request() req) {
    return this.usersService.create(dto, req.user);
  }

  @Get()
  findAll(@Query('tenantId') tenantId: string | undefined, @Request() req) {
    return this.usersService.findAll(tenantId, req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.usersService.findOne(id, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req) {
    return this.usersService.update(id, dto, req.user);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string, @Request() req) {
    return this.usersService.deactivate(id, req.user);
  }
}
