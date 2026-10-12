export interface UploadedBinary {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

export abstract class FileStorage {
  /** guarda e devolve o caminho relativo persistível */
  abstract save(file: UploadedBinary, folder?: string): Promise<string>;
  abstract remove(path: string): Promise<void>;
  abstract absolutePath(path: string): string;
  abstract exists(path: string): Promise<boolean>;
}
