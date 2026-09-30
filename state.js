// state.js — all shared mutable app state lives on S (one object, so every module sees the same values).
export const S = {
  scheduleDay: null,
  roosterMode: 'week',
  pendingSwapRequest: null,
  me: null,
  canEdit: false,
  coordinatorExists: false,
  coordinatorConfig: null,
  appReady: false,
  impersonateFamilyId: null,
  families: {},
  groups: {},
  links: {},
  deviations: {},
  linksLoaded: false,
  invitesByCode: {},
  inviteByFamily: {},
  lastUpdateRooster: null,
  lastUpdateDeviation: null,
  serverSchedules: {},
  lastPendingChangeCount: null,
  matchFeeds: [],
  matchFeedsLoaded: false,
  matchLoadSeq: 0,
  matches: [],
  matchesSource: null,
  matchesFetchedAt: null,
  matchesFeedsSig: null,           // which calendars this session's last successful fetch was for
  matchFetchFailedTeams: [],
  cachedMatches: [],
  cachedMatchesAt: null,
  cachedMatchesFeedsSig: null,     // which calendars the cache was fetched for (calendar IDs)
  cachedMatchesPartial: false,     // the cache was written while a team calendar failed
  matchCacheLoaded: false,         // settings/matchCache has been read (also when it does not exist yet)
  matchLastAttempt: null,          // {at, sig}: last automatic fetch in this session (limits retries)
  orsApiKey: '',                   // OpenRouteService key, read from settings/apiKeys (members only)
  matchCarpools: {},
  weekendMatchBySlug: {},
  openMatchCarpoolForm: null,
  currentWeekKey: null,
  dayCoordinators: {},
  period: null,            // settings/period: the period with other times (holiday, exam week); null = none
  periodDraft: null,       // Beheer: the period form while it has unsaved edits (null = show the saved period)
  locationsDoc: null,      // settings/locations as stored (locations.js normalises it)
  matchDistances: {},
  matchDistancesLoaded: false,      // settings/matchDistances: calculated km per match
  impactPreview: null,     // impact preview switch (null = not loaded yet)
  settings: {gapThresholdHours:3, travelLeadMinutes:60, prefWindowMinutes:30, parentPrefWindowMinutes:60},
  prefs: {rules:[]},
  shiftPriority: {},
  deferredInstallPrompt: null,
  appIsInstalled: false,
  dataUnsubs: [],
  linksCollUnsub: null,
  invitesUnsub: null,
  migratingSecrets: false,
  migrationFailed: false,
  hashTabApplied: false,
  defaultTabChosen: false,
  formSelectedDay: {me:'Ma', coord:'Ma'},
  deviationDay: null,
  weekschemaBase: null,   // Mijn gezin: Weekschema as saved, while an edit waits for confirmation
  weekschemaEdit: null,   // Mijn gezin: the edited (not yet saved) Weekschema
  deviationIntent: null,  // Wijzigen: what the parent wanted to change one-off (from Mijn gezin)
  lastDeviationEditDay: null,
  coordEditId: undefined,
  selectedShiftKey: 'Ma_heen',
};
