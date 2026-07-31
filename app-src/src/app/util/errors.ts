/** The message of an unknown thrown value, for display in the UI. */
export function errorMessage(error: unknown): string {
  const message = (error as Error | undefined)?.message;
  return message ? String(message) : String(error);
}
