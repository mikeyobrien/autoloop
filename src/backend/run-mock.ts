export function mockBackend(command: string, args: string[]): boolean {
  if (command.includes("mock-backend")) return true;
  return args.some((arg) => arg.includes("mock-backend"));
}
