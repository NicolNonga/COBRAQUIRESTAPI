export abstract class RealTimeNotifier {
  abstract emitToUser(userId: number, event: string, data: unknown): void;
}
