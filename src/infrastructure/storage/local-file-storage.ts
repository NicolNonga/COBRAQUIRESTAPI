import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile, access } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileStorage, UploadedBinary } from '@/shared/application/file-storage.port';
import { ValidationError } from '@/shared/domain/errors';

@Injectable()
export class LocalFileStorage extends FileStorage {
  private readonly logger = new Logger(LocalFileStorage.name);
  private readonly root: string;

  constructor(cfg: ConfigService) {
    super();
    this.root = resolve(cfg.get<string>('UPLOAD_DIR', 'uploads'));
  }

  async save(file: UploadedBinary, folder = ''): Promise<string> {
    const ext = extname(file.originalName).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const relative = join(folder, `${randomUUID()}${ext}`);
    const abs = this.absolutePath(relative);
    await mkdir(join(this.root, folder), { recursive: true });
    await writeFile(abs, file.buffer, { flag: 'wx' });
    return relative.split(sep).join('/');
  }

  async remove(path: string): Promise<void> {
    try {
      await unlink(this.absolutePath(path));
    } catch (e) {
      this.logger.warn({ path, err: e }, 'Não foi possível remover ficheiro');
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(this.absolutePath(path));
      return true;
    } catch {
      return false;
    }
  }

  /** Impede path traversal (../../etc/passwd) */
  absolutePath(path: string): string {
    const abs = resolve(this.root, normalize(path));
    if (!abs.startsWith(this.root + sep)) throw new ValidationError('Caminho de ficheiro inválido');
    return abs;
  }
}
