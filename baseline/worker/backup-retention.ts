export const BACKUP_PREFIX = "database-backups/";
export const BACKUP_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupMetadata {
  key: string;
  uploaded: Date;
  customMetadata?: Record<string, string>;
}

export function backupObjectKey(createdAt: string): string {
  const timestamp = createdAt.replaceAll(":", "-").replaceAll(".", "-");
  return `${BACKUP_PREFIX}liftline-${timestamp}.json`;
}

export function expiredBackupKeys(
  backups: BackupMetadata[],
  referenceTime: number,
  retentionDays = BACKUP_RETENTION_DAYS,
): string[] {
  const cutoff = referenceTime - retentionDays * DAY_MS;

  return backups
    .filter((backup) => {
      const recordedTime = Date.parse(backup.customMetadata?.createdAt ?? "");
      const backupTime = Number.isFinite(recordedTime) ? recordedTime : backup.uploaded.getTime();
      return backupTime <= cutoff;
    })
    .map((backup) => backup.key);
}
