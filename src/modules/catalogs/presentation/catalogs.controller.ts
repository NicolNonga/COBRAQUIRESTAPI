import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from '@/shared/presentation/pagination.dto';
import { CreateContactTypeUseCase } from '../application/create-contact-type.use-case';
import { ListCatalogUseCase } from '../application/list-catalog.use-case';
import { CreateContactTypeDto } from './dto/create-contact-type.dto';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { P } from '@/modules/access-control/domain/permission-catalog';

@ApiTags('Catálogos')
@ApiBearerAuth()
@Controller()
export class CatalogsController {
  constructor(
    private readonly list: ListCatalogUseCase,
    private readonly createContactType: CreateContactTypeUseCase,
  ) {}

  @Get('curriency')
  @ApiOperation({ summary: 'Moedas (paginado)' })
  currencies(@Query() q: PaginationQueryDto) {
    return this.list.paginate('currencies', q);
  }

  @Get('curriency/dropdown')
  @ApiOperation({ summary: 'Moedas activas (dropdown)' })
  async currenciesDropdown() {
    return { data: await this.list.dropdown('currencies') };
  }

  @Get('category')
  @ApiOperation({ summary: 'Categorias de utilizador (paginado)' })
  categories(@Query() q: PaginationQueryDto) {
    return this.list.paginate('categories', q);
  }

  @Get('category/dropdown')
  async categoriesDropdown() {
    return { data: await this.list.dropdown('categories') };
  }

  @Get('type_debtor')
  @ApiOperation({ summary: 'Tipos de devedor (paginado)' })
  debtorTypes(@Query() q: PaginationQueryDto) {
    return this.list.paginate('debtorTypes', q);
  }

  @Get('type_debtor/dropdown')
  async debtorTypesDropdown() {
    return { data: await this.list.dropdown('debtorTypes') };
  }

  @Get('contact_type')
  @ApiOperation({ summary: 'Tipos de contacto (paginado)' })
  contactTypes(@Query() q: PaginationQueryDto) {
    return this.list.paginate('contactTypes', q);
  }

  @Post('contact_type')
  @ApiOperation({ summary: 'Criar tipo de contacto' })
  @RequirePermissions(P.CATALOG_MANAGE)
  async createContact(@Body() dto: CreateContactTypeDto) {
    const { id } = await this.createContactType.execute(dto);
    return { message: 'Tipo de contacto registado', id };
  }

  @Get('invoice_states/dropdown')
  async invoiceStates() {
    return { data: await this.list.dropdown('invoiceStates') };
  }

  @Get('process_states/dropdown')
  async processStates() {
    return { data: await this.list.dropdown('processStates') };
  }
}
