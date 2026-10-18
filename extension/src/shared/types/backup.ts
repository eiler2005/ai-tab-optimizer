export interface BackupSettings { enabled: boolean; intervalHours: number; retention: number }
export interface FullBackup { id: string; createdAt: number; path: string; collections: number; scope: string[] }
export interface BackupStatus {
  settings: BackupSettings;
  lastAttemptAt?: number; lastSuccessAt?: number; error?: string; lastBackup?: FullBackup;
  backups?: FullBackup[]; serverError?: string;
}
