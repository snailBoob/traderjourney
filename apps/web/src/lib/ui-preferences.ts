export const UI_PREFERENCE_KEYS = {
  dashboardLayout: "dashboardLayout",
  reportOverviewLayout: "reportOverviewLayout",
  playbookOrder: "playbookOrder",
  accountOrder: "accountOrder",
  accountSelection: "accountSelection",
  notebookFolderOrder: "notebookFolderOrder",
  notebookCurrentFolder: "notebookCurrentFolder",
  notebookNoteOrder: "notebookNoteOrder",
  notebookCurrentNote: "notebookCurrentNote",
  privacyMode: "privacyMode",
  marketDataProvider: "marketDataProvider",
  reportMarketDataProvider: "reportMarketDataProvider",
  journalColumnOrder: "journalColumnOrder",
  missedTradesColumnOrder: "missedTradesColumnOrder",
  tradesColumnOrder: "tradesColumnOrder",
  tradesColumnVisibility: "tradesColumnVisibility",
  journalTradesColumnOrder: "journalTradesColumnOrder",
  journalTradesColumnVisibility: "journalTradesColumnVisibility",
} as const;

export type UiPreferenceKey = (typeof UI_PREFERENCE_KEYS)[keyof typeof UI_PREFERENCE_KEYS];
