import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { NumbersService, CreateNumberDto } from './numbers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('numbers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NumbersController {
  constructor(private numbersService: NumbersService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN')
  create(@Body() dto: CreateNumberDto, @Request() req) {
    return this.numbersService.create(dto, req.user);
  }

  @Get()
  findAll(@Request() req) {
    return this.numbersService.findAllAccessible(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.numbersService.findAccessible(id, req.user);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'TENANT_ADMIN')
  remove(@Param('id') id: string, @Request() req) {
    return this.numbersService.remove(id, req.user);
  }
}
