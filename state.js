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
  periods: {},             // the periods with other times (holiday, exam week), { firstDay: period }; several can exist at once
  periodsColl: {},         // periods/*: the collection as loaded
  legacyPeriod: null,      // settings/period: the single period of the first version; the coordinator's app moves it into periods/
  notice: null,            // settings/notice: the notice for everyone { on, text, offDate, offTime } (null = none / not loaded)
  noticeDraft: null,       // Beheer: what is typed in the notice card, kept while other cards redraw (null = nothing typed)
  periodDraft: null,       // Beheer: the period form { editing: firstDay of the period being edited or '', value } while it is open (null = closed)
  periodSel: null,         // Rooster, temporary view: the chosen period (firstDay)
  periodEntries: {},       // periodEntries/*: the times families handed in for the period, by document id
  periodEntriesLoaded: false,
  periodCars: {},          // periodCars/*: the temporary rooster, one document per shift (see period.js)
  periodDay: null,         // Rooster, temporary view: the open date ('YYYY-MM-DD')
  folds: {},               // open state of the collapsible sections, by key (default = collapsed); see foldHtml in ui-common.js
  periodView: null,        // Wijzigen (coordinator): '<firstDay>|<familyId>' whose handed-in times are unfolded ("Bekijk")
  periodForm: null,        // Wijzigen: the open form for handing in times { familyId, firstDay, days } (null = closed); it also holds unsaved edits
  periodPhaseKey: null,    // last shown state of the task card and badge, so the minute check redraws only on a change
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
