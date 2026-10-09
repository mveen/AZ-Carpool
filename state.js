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
  deviationsLoaded: false,
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
  maintenance: null,       // settings/maintenance: onderhoudsmodus { on, text } (null = none / not loaded)
  maintenanceDraft: null,  // Beheer: what is typed in the maintenance card, kept while other cards redraw (null = nothing typed)
  ritbeurs: null,          // settings/ritbeurs: the Ritbeurs feature switch { on } (null = none / not loaded, which means off)
  offers: {},              // offers/*: rides offered in the Ritbeurs, by document id (see ritbeurs.js)
  moments: {},             // backupMoments/*: "Ik kan inspringen" moments of all families, by document id
  notifications: {},       // families/<my family>/notifications/*: my in-app notifications, by document id
  notificationsFor: null,  // the family whose notifications are being listened to (null = none)
  notificationsUnsub: null,
  rbView: 'wijzigen',      // Wijzigen tab: 'wijzigen' (the ride cards) or 'ritbeurs'
  rbConfirm: null,         // Ritbeurs: id of the offer whose "Neem over" confirmation is open (null = none)
  rbOffering: null,        // Ritbeurs: the own ride whose "Aanbieden" form is open, 'Do|heen' (null = none)
  rbMomentDraft: null,     // Ritbeurs: what is typed in the "Nieuw moment" form { date, from, to, place, onlyIfFree } (null = defaults)
  rbBusy: false,           // Ritbeurs: a background check (late offers, housekeeping) is running
  periodDraft: null,       // Beheer: the period form { editing: firstDay of the period being edited or '', value } while it is open (null = closed)
  periodSel: null,         // Rooster, temporary view: the chosen period (firstDay)
  periodEntries: {},       // periodEntries/*: the times families handed in for the period, by document id
  periodEntriesLoaded: false,
  periodCars: {},          // periodCars/*: the temporary rooster, one document per shift (see period.js)
  periodBackups: {},       // periodBackups/*: back-ups of a period (coordinator only), by document id (see period-backup.js)
  periodBackupsUnsub: null,
  rideLog: {},             // rideLog/*: the rides that were driven, by '<date>_<heen|terug>' (coordinator only, see ride-log.js)
  rideLogLoaded: false,    // the log has been read, so logPassedShifts can tell what is new
  rideLogUnsub: null,
  rideLogView: null,       // Beheer, Gereden shifts: { mode:'month'|'year', year, month } while the coordinator looks at it (null = the current month)
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
  sessionsUnsub: null,
  lastSeenByFamily: {},
  invitesUnsub: null,
  migratingSecrets: false,
  migrationFailed: false,
  hashTabApplied: false,
  defaultTabChosen: false,
  formSelectedDay: {me:'Ma', coord:'Ma'},
  devOpen: {},             // Wijzigen: which ride cards are unfolded, by 'Ma|heen|0'
  devKid: null,            // Wijzigen: the child whose options (move / remove) are open: 'Ma|heen|0|<girlId>'
  devFree: {},             // Wijzigen: ride cards whose free place input was asked for ("Ander adres") before anything is typed
  devUndo: null,           // Wijzigen: the last change that can be undone { key, text, day, direction, cars }
  deviationDay: null,
  weekschemaBase: null,   // Mijn gezin: Weekschema as saved, while an edit waits for confirmation
  weekschemaEdit: null,   // Mijn gezin: the edited (not yet saved) Weekschema
  deviationIntent: null,  // Wijzigen: what the parent wanted to change one-off (from Mijn gezin)
  lastDeviationEditDay: null,
  coordEditId: undefined,
  selectedShiftKey: 'Ma_heen',
};
