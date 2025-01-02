interface Settings {
  parentFolderId?: string;
  autoSync: boolean;
}

export class StorageManager {
  private defaultSettings: Settings = {
    autoSync: true,
  };

  async getSettings(): Promise<Settings> {
    return new Promise((resolve) => {
      chrome.storage.sync.get(this.defaultSettings, (settings) => {
        resolve(settings as Settings);
      });
    });
  }

  async updateSettings(settings: Partial<Settings>): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.sync.set(settings, resolve);
    });
  }
}