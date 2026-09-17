/**
 * Ambient global typings shared between preload and renderer.
 *
 * The preload script (src/preload/index.ts) calls
 * `contextBridge.exposeInMainWorld('tud', ...)`; the renderer reads it
 * off `window.tud`. Keeping the contract in a single ambient type makes
 * both ends stay in sync.
 */
declare global {
  interface Window {
    tud: {
      version: () => string;
      platform: NodeJS.Platform;
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      showMainWindow: () => void;
      quit: () => void;
      getAutoUpdateState: () => Promise<import('../shared/auto-update').AutoUpdateState>;
      checkForUpdates: () => Promise<import('../shared/auto-update').AutoUpdateState>;
      installDownloadedUpdate: () => Promise<import('../shared/auto-update').AutoUpdateState>;
      acknowledgeUpdateCompleted: () => Promise<void>;
      onAutoUpdateStateChanged: (
        callback: (state: import('../shared/auto-update').AutoUpdateState) => void,
      ) => () => void;
      copyImageToClipboard: (dataUrl: string) => Promise<boolean>;
      getCodexSubscription: () => Promise<
        import('../shared/codex-subscription').CodexSubscriptionSnapshot
      >;
      getClaudeSubscription: (options?: {
        allowCredentialAccess?: boolean;
        forceRefresh?: boolean;
      }) => Promise<
        import('../shared/claude-subscription').ClaudeSubscriptionSnapshot
      >;
      getCursorSubscription: () => Promise<
        import('../shared/cursor-subscription').CursorSubscriptionSnapshot
      >;
      getGrokSubscription: () => Promise<
        import('../shared/grok-subscription').GrokSubscriptionSnapshot
      >;
      getKimiSubscription: () => Promise<
        import('../shared/kimi-subscription').KimiSubscriptionSnapshot
      >;
      getZcodeSubscription: () => Promise<
        import('../shared/zcode-subscription').ZcodeSubscriptionSnapshot
      >;
      getAntigravitySubscription: () => Promise<
        import('../shared/antigravity-subscription').AntigravitySubscriptionSnapshot
      >;
      getQoderSubscription: () => Promise<
        import('../shared/qoder-subscription').QoderSubscriptionSnapshot
      >;
      getMiniMaxSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/minimax-subscription').MiniMaxSubscriptionSnapshot
      >;
      getDeepSeekSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/deepseek-subscription').DeepSeekSubscriptionSnapshot
      >;
      getOpenCodeSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/opencode-subscription').OpenCodeSubscriptionSnapshot
      >;
      getTraeGlobalSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/trae-subscription').TraeSubscriptionSnapshot
      >;
      getTraeCnSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/trae-subscription').TraeSubscriptionSnapshot
      >;
      getWorkBuddyGlobalSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/workbuddy-subscription').WorkBuddySubscriptionSnapshot
      >;
      getWorkBuddyMainlandSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/workbuddy-subscription').WorkBuddySubscriptionSnapshot
      >;
      getSubscriptionKeysStatus: () => Promise<{
        success: boolean;
        message: string;
        data: Array<{ plan: 'minimax' | 'ark'; source: 'env' | 'stored' | 'none'; masked: string | null; region?: string | null }>;
      }>;
      saveSubscriptionKeys: (keys: {
        minimax?: { apiKey: string; region?: 'auto' | 'global' | 'mainland' };
        ark?: { accessKeyId: string; secretAccessKey: string; region?: string };
      }) => Promise<{ success: boolean; message: string }>;
      clearSubscriptionKeys: (plan: 'minimax' | 'ark') => Promise<{ success: boolean; message: string }>;
      getArkSubscription: (options?: { forceRefresh?: boolean }) => Promise<
        import('../shared/ark-subscription').ArkSubscriptionSnapshot
      >;
      openExternal: (
        url: string,
      ) => Promise<{ ok: boolean; message?: string }>;
      resizeTrayPopover: (height: number) => void;
      getDashboardRange: () => Promise<
        import('../shared/dashboard-range').DashboardRange
      >;
      setDashboardRange: (
        range: import('../shared/dashboard-range').DashboardRange,
      ) => Promise<import('../shared/dashboard-range').DashboardRange>;
      onDashboardRange: (
        callback: (range: import('../shared/dashboard-range').DashboardRange) => void,
      ) => () => void;
      getTheme: () => Promise<{
        mode: import('../shared/theme').ThemeMode;
        resolved: import('../shared/theme').Theme;
      }>;
      setThemeMode: (mode: import('../shared/theme').ThemeMode) => void;
      onThemeChanged: (
        callback: (state: {
          mode: import('../shared/theme').ThemeMode;
          resolved: import('../shared/theme').Theme;
        }) => void,
      ) => () => void;
      getOpenAtLogin: () => Promise<boolean>;
      setOpenAtLogin: (enabled: boolean) => Promise<boolean>;
      getLaunchHidden: () => Promise<boolean>;
      setLaunchHidden: (hidden: boolean) => Promise<boolean>;
      getDesktopPet: () => Promise<{
        enabled: boolean;
        selectedPetId: string;
        position?: { x: number; y: number };
        scale: number;
        frameIntervalMs: number;
        autoMoveEnabled: boolean;
        autoMoveIntervalMinutes: number;
        syncFeedbackEnabled: boolean;
        syncFeedbackDurationSec: number;
        quotaBubbleMode: 'off' | 'periodic' | 'persistent';
        quotaBubbleIntervalMin: number;
        quotaAlertEnabled: boolean;
        quotaAlertThreshold: 80 | 90 | 95;
        quotaAlertCooldownMin: number;
        quotaMoodEnabled: boolean;
      }>;
      setDesktopPetEnabled: (enabled: boolean) => Promise<boolean>;
      getDesktopPetCatalog: () => Promise<import('../shared/desktop-pet-catalog').DesktopPetCatalog>;
      refreshDesktopPetCatalog: () => Promise<import('../shared/desktop-pet-catalog').DesktopPetCatalog & { selectedPetId: string }>;
      fetchRemoteDesktopPetCatalog: (force?: boolean) => Promise<
        import('../shared/desktop-pet-catalog').DesktopPetCatalog & {
          selectedPetId: string;
          remoteError: string | null;
        }
      >;
      installRemoteDesktopPet: (id: string) => Promise<
        import('../shared/desktop-pet-catalog').DesktopPetCatalog & {
          selectedPetId: string;
          remoteError: string | null;
        }
      >;
      openDesktopPetDirectory: () => Promise<string>;
      getDesktopPetSpritesheetUrl: (id: string) => Promise<string>;
      setSelectedDesktopPet: (selectedPetId: string) => Promise<{
        enabled: boolean;
        selectedPetId: string;
        position?: { x: number; y: number };
        scale: number;
        frameIntervalMs: number;
        autoMoveEnabled: boolean;
        autoMoveIntervalMinutes: number;
        syncFeedbackEnabled: boolean;
        syncFeedbackDurationSec: number;
        quotaBubbleMode: 'off' | 'periodic' | 'persistent';
        quotaBubbleIntervalMin: number;
        quotaAlertEnabled: boolean;
        quotaAlertThreshold: 80 | 90 | 95;
        quotaAlertCooldownMin: number;
        quotaMoodEnabled: boolean;
      }>;
      setDesktopPetPreferences: (changes: {
        scale?: number;
        frameIntervalMs?: number;
        autoMoveEnabled?: boolean;
        autoMoveIntervalMinutes?: number;
        syncFeedbackEnabled?: boolean;
        syncFeedbackDurationSec?: number;
        quotaBubbleMode?: 'off' | 'periodic' | 'persistent';
        quotaBubbleIntervalMin?: number;
        quotaAlertEnabled?: boolean;
        quotaAlertThreshold?: 80 | 90 | 95;
        quotaAlertCooldownMin?: number;
        quotaMoodEnabled?: boolean;
      }) => Promise<{
        enabled: boolean;
        selectedPetId: string;
        position?: { x: number; y: number };
        scale: number;
        frameIntervalMs: number;
        autoMoveEnabled: boolean;
        autoMoveIntervalMinutes: number;
        syncFeedbackEnabled: boolean;
        syncFeedbackDurationSec: number;
        quotaBubbleMode: 'off' | 'periodic' | 'persistent';
        quotaBubbleIntervalMin: number;
        quotaAlertEnabled: boolean;
        quotaAlertThreshold: 80 | 90 | 95;
        quotaAlertCooldownMin: number;
        quotaMoodEnabled: boolean;
      }>;
      setDesktopPetMouseIgnored: (ignored: boolean) => void;
      beginDesktopPetDrag: () => void;
      endDesktopPetDrag: () => void;
      setDesktopPetBubbleBounds: (size: {
        width: number;
        height: number;
      }) => Promise<number>;
      onDesktopPetAnimation: (
        callback: (animation: 'idle' | 'running-left' | 'running-right') => void,
      ) => () => void;
      onDesktopPetPreferences: (callback: (preferences: {
        enabled: boolean;
        selectedPetId: string;
        position?: { x: number; y: number };
        scale: number;
        frameIntervalMs: number;
        autoMoveEnabled: boolean;
        autoMoveIntervalMinutes: number;
        syncFeedbackEnabled: boolean;
        syncFeedbackDurationSec: number;
        quotaBubbleMode: 'off' | 'periodic' | 'persistent';
        quotaBubbleIntervalMin: number;
        quotaAlertEnabled: boolean;
        quotaAlertThreshold: 80 | 90 | 95;
        quotaAlertCooldownMin: number;
        quotaMoodEnabled: boolean;
      }) => void) => () => void;
      onMaximized: (callback: (isMaximized: boolean) => void) => () => void;
      api: {
        request: (
          path: string,
          init?: {
            method?: string;
            body?: string;
            headers?: Record<string, string>;
          },
        ) => Promise<{ status: number; body: unknown }>;
      };
      onDataSynced: (
        callback: (
          feedback?: import('../shared/pet-sync-feedback').PetSyncFeedback | null,
        ) => void,
      ) => () => void;
      onOpenSettings: (
        callback: (detail?: {
          tab?: 'sync' | 'pet' | 'app';
          reloadConfig?: boolean;
          loginSuccess?: boolean;
          loginError?: string;
        }) => void,
      ) => () => void;
      onJuejinLinkResult: (
        callback: (detail: { ok: boolean; message?: string }) => void,
      ) => () => void;
      onRuntimeNotice: (
        callback: (detail: { kind: 'config-reset'; tokenSalvaged: boolean }) => void,
      ) => () => void;
    };
  }
}

export {};
