export interface AppSettings {
  autoRefresh: boolean;
  pollIntervalSeconds: number;
  highlightEnabled: boolean;
  showLeftPanel: boolean;
  maxLogCount: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoRefresh: true,
  pollIntervalSeconds: 5,
  highlightEnabled: true,
  showLeftPanel: true,
  maxLogCount: 100_000,
};

const SETTINGS_KEY = "git-extensions.settings";
const POLL_INTERVALS = [3, 5, 10, 30, 60];
const LOG_LIMITS = [10_000, 50_000, 100_000, 200_000];

function numberOption(value: unknown, allowed: number[], fallback: number): number {
  return typeof value === "number" && allowed.includes(value) ? value : fallback;
}

/** localStorage 可能被手工修改，只接受白名单中的设置值。 */
export function loadSettings(): AppSettings {
  try {
    const raw: Partial<AppSettings> = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return {
      autoRefresh: typeof raw.autoRefresh === "boolean" ? raw.autoRefresh : DEFAULT_SETTINGS.autoRefresh,
      pollIntervalSeconds: numberOption(raw.pollIntervalSeconds, POLL_INTERVALS, DEFAULT_SETTINGS.pollIntervalSeconds),
      highlightEnabled: typeof raw.highlightEnabled === "boolean" ? raw.highlightEnabled : DEFAULT_SETTINGS.highlightEnabled,
      showLeftPanel: typeof raw.showLeftPanel === "boolean" ? raw.showLeftPanel : DEFAULT_SETTINGS.showLeftPanel,
      maxLogCount: numberOption(raw.maxLogCount, LOG_LIMITS, DEFAULT_SETTINGS.maxLogCount),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
