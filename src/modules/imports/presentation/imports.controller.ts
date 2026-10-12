import { BadRequestException, Controller, Get, HttpCode, Param, Post, Res, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthenticatedUser } from '@/shared/application/authenticated-user';
import { FileStorage } from '@/shared/application/file-storage.port';
import { CurrentUser } from '@/shared/presentation/current-user.decorator';
import { assertFileType, EXCEL_TYPES, PDF_TYPES, toBinary } from '@/shared/presentation/upload';
import { AttachInvoicePdfsUseCase } from '../application/attach-invoice-pdfs.use-case';
import { ImportHistoryService } from '../application/import-history.service';
import { ImportDebtorsUseCase } from '../application/import-debtors.use-case';
import { ImportInvoicesUseCase } from '../application/import-invoices.use-case';
import { ImportOrganizationsUseCase } from '../application/import-organizations.use-case';
import { RequirePermissions } from '@/modules/auth/presentation/require-permissions.decorator';
import { P } from '@/modules/access-control/domain/permission-catalog';

const FILE_BODY = { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } };

const requireExcel = (f?: Express.Multer.File): Express.Multer.File => {
  if (!f) throw new BadRequestException('Nenhum ficheiro seleccionado');
  assertFileType(f, EXCEL_TYPES);
  return f;
};

/** o multer entrega o nome em latin1; converter para UTF-8 (acentos) */
const fileName = (f: Express.Multer.File) => {
  try { return Buffer.from(f.originalname, 'latin1').toString('utf8'); } catch { return f.originalname; }
};

@ApiTags('Importações')
@ApiBearerAuth()
@Controller('file')
export class ImportsController {
  constructor(
    private readonly debtors: ImportDebtorsUseCase,
    private readonly invoices: ImportInvoicesUseCase,
    private readonly orgs: ImportOrganizationsUseCase,
    private readonly pdfs: AttachInvoicePdfsUseCase,
    private readonly storage: FileStorage,
    private readonly history: ImportHistoryService,
  ) {}

  @Post('import/organization')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @UseInterceptors(FileInterceptor('file'))
  @RequirePermissions(P.ORGANIZATION_MANAGE)
  async importOrgs(@CurrentUser() me: AuthenticatedUser, @UploadedFile() file?: Express.Multer.File) {
    const f = requireExcel(file);
    const r = await this.history.track({ kind: 'ORGANIZATIONS', fileName: fileName(f), size: f.size, buffer: f.buffer, userId: me.id }, () => this.orgs.execute(f.buffer));
    return { message: `Foram carregadas ${r.imported} de ${r.total} empresas`, data: r };
  }

  @Post('import/debtors')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @UseInterceptors(FileInterceptor('file'))
  @RequirePermissions(P.DEBTOR_CREATE)
  async importDebtors(@CurrentUser() me: AuthenticatedUser, @UploadedFile() file?: Express.Multer.File) {
    const f = requireExcel(file);
    const r = await this.history.track({ kind: 'DEBTORS', fileName: fileName(f), size: f.size, buffer: f.buffer, userId: me.id }, () => this.debtors.execute(f.buffer));
    return { message: `Foram carregados ${r.imported} de ${r.total} devedores`, data: r };
  }

  @Post('import/invoices')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @UseInterceptors(FileInterceptor('file'))
  @RequirePermissions(P.INVOICE_CREATE)
  async importInvoices(@CurrentUser() me: AuthenticatedUser, @UploadedFile() file?: Express.Multer.File) {
    const f = requireExcel(file);
    const r = await this.history.track({ kind: 'INVOICES', fileName: fileName(f), size: f.size, buffer: f.buffer, userId: me.id }, () => this.invoices.execute(f.buffer, me.id));
    return { message: `Foram carregadas ${r.imported} de ${r.total} facturas`, data: r };
  }

  @Post('import/invoices/pdf')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { invoices: { type: 'array', items: { type: 'string', format: 'binary' } } } } })
  @UseInterceptors(FilesInterceptor('invoices', 50))
  @ApiOperation({ summary: 'Associar PDFs às facturas (match por referência + devedor)' })
  @RequirePermissions(P.INVOICE_CREATE)
  async importPdfs(@CurrentUser() me: AuthenticatedUser, @UploadedFiles() files: Express.Multer.File[] = []) {
    if (!files.length) throw new BadRequestException('Nenhum ficheiro enviado');
    files.forEach((f) => assertFileType(f, PDF_TYPES));
    let results: Awaited<ReturnType<AttachInvoicePdfsUseCase['execute']>> = [];
    const label = files.length === 1 ? fileName(files[0]) : `${files.length} ficheiros PDF`;
    await this.history.track(
      { kind: 'INVOICE_PDFS', fileName: label, size: files.reduce((n, f) => n + f.size, 0), userId: me.id },
      async () => {
        results = await this.pdfs.execute(files.map((f) => ({ ...toBinary(f), originalName: fileName(f) })));
        const failedRows = results.flatMap((x, i) => (x.matched ? [] : [{ rowNumber: i + 1, label: x.file, errors: [x.reason ?? 'Não associado'] }]));
        return { total: files.length, imported: files.length - failedRows.length, failed: failedRows.length, errors: failedRows };
      },
    );
    return { message: `${results.filter((r) => r.matched).length} de ${files.length} PDFs associados`, data: results };
  }

  @Get('import-errors/:name')
  @ApiOperation({ summary: 'Descarregar relatório de erros de importação' })
  async downloadReport(@Param('name') name: string, @Res() res: Response) {
    if (!/^[0-9a-f-]{36}\.xlsx$/.test(name)) throw new BadRequestException('Nome inválido');
    res.download(this.storage.absolutePath(`import-errors/${name}`));
  }
}
