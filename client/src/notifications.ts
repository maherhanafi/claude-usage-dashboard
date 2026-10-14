export interface NotificationMessage {
  id: string;
  message: string;
}

export function toNotificationText(warnings?: string[] | null): string | null {
  if (!warnings || warnings.length === 0) return null;
  return warnings.filter(Boolean).join(" • ");
}
