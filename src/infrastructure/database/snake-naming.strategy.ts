import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

const snake = (s: string): string =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();

/** camelCase nas entidades ↔ snake_case na base de dados. */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override tableName(className: string, customName?: string): string {
    return customName ?? snake(className);
  }
  override columnName(propertyName: string, customName: string | undefined, prefixes: string[]): string {
    return snake(prefixes.join('_')) + (customName ?? snake(propertyName));
  }
  override relationName(propertyName: string): string {
    return snake(propertyName);
  }
  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snake(`${relationName}_${referencedColumnName}`);
  }
  override joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return snake(`${tableName}_${columnName ?? propertyName}`);
  }
}
