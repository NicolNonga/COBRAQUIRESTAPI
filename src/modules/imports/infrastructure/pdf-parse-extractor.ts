import { Injectable } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import { PdfTextExtractor } from '../domain/spreadsheet.port';

@Injectable()
export class PdfParseExtractor extends PdfTextExtractor {
  async extract(buffer: Buffer): Promise<string> {
    return (await pdfParse(buffer)).text ?? '';
  }
}
