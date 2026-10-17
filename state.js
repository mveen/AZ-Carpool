// state.js — all shared mutable app state lives on S (one object, so every module sees the same values).
export const S = {
  scheduleDay: null,
  roosterMode: 'week',
  pendingSwapRequest: null,
  periodSwap: null,   // temporary rooster: a move into a full car waiting for a rider to swap with { iso, direction, girlId, toIndex }
  me: null,
  canEdit: false,
  coordinatorExists: false,
  coordinatorConfig: null,
  appReady: false,
  impersonateFamilyId: null,
  viewAsParent: false,   // a coordinator who also has a family can look at the app as a parent (Instellingen > Bekijk als); view only, rights on the server are unchanged
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
  practiceMatches: {},             // practiceMatches/<id>: practice matches added by the parents (see matches.js practiceToMatch)
  weekendMatchBySlug: {},
  openMatchCarpoolForm: null,
  editMatchCarIdx: null,   // index of the car being edited in the open match form (null = adding a new car)
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
  weekrooster: null,       // settings/weekrooster: the Afwijkend-weekrooster switch { mode: 'uit'|'test'|'aan' } (null = none / not loaded, which means uit)
  weekRequests: {},        // weekRequests/*: the own family's requests for this and next week, by document id (only while the switch is on for this person)
  weekRequestsKey: '',     // '<family>|<week>' the listeners belong to ('' = none)
  weekRequestsUnsubs: [],
  wrWeek: 'this',          // Wijzigen with the weekrooster on: 'this' or 'next' week
  wrForm: null,            // the week form being filled in: { which, days } (null = nothing typed)
  wrBusy: false,           // a request is being saved (a double tap makes no double request)
  offers: {},              // offers/*: rides offered in the Ritbeurs, by document id (see ritbeurs.js)
  moments: {},             // backupMoments/*: "Ik kan inspringen" moments of all families, by document id
  notifications: {},       // families/<my family>/notifications/*: my in-app notifications, by document id
  notificationsFor: null,  // the family whose notifications are being listened to (null = none)
  notificationsUnsub: null,
  pushSettings: null,      // settings/push { mode, live }: the test switch and the live switch (null = not loaded, which means both off); every member reads it
  push: {                  // Beheer, "Push-meldingen testen" (coordinator only; see push-data.js)
    unsubs: [],            // the open listeners (settings/pushKey, settings/pushStatus, pushDevices, pushQueue, testNotifications)
    key: null, status: null, devices: {}, queue: {}, tests: {},
    personaId: '',         // the family whose notifications the coordinator experiences ("Ouder van Saar")
    personaNotifs: {}, personaFor: null, personaUnsub: null,   // that family's real notifications (families/<id>/notifications)
    timeChoice: 'nu',      // scenarios: pretend it is now, or the middle of the night
    last: null,            // the last scenario that was played { id, rows, explain, ride, simMs }
    thisDeviceId: '',      // the id of this browser's own device document, when it is subscribed
    pendingOpen: '',       // a family id from a tapped push, to open in Testweergave as soon as the app is ready
    pendingView: false,    // ...and then to show the Ritten-ruilen screen as soon as the app knows that Ritten ruilen is on
  },
  pushMe: {                // Instellingen > Push-meldingen: this phone as a parent's own device (see push-data.js, ui-push-device.js)
    status: 'idle',        // 'idle' | 'loading' | 'ready' | 'error'
    key: null,             // settings/pushKey (the public key the phone subscribes with), read when the sheet opens
    deviceId: '',          // the id of this browser's device document, when it is subscribed
    on: false,             // this phone is switched on for the family
    pendingOpen: 0,        // a tapped real push (the moment it was tapped, ms): show Ritten ruilen as soon as the app knows that it is on
  },
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
  calendarLink: null,      // Profiel > Agenda: { familyId, token, status } of the calendar link of the family whose Profiel is open (null = not asked yet)
  dataUnsubs: [],
  linksCollUnsub: null,
  sessionsUnsub: null,
  lastSeenByFamily: {},
  invitesUnsub: null,
  errorLogUnsub: null,
  errorLogLoaded: false,
  errorLog: {},            // Beheer: the app's own error log (errorLog/<uid>_<slot>), coordinator only
  migratingSecrets: false,
  migrationFailed: false,
  hashTabApplied: false,
  defaultTabChosen: false,
  formSelectedDay: {me:'Ma', coord:'Ma'},
  devOpen: {},             // Wijzigen: which ride cards are unfolded, by 'Ma|heen|0'
  devKid: null,            // Wijzigen: the child whose options (move / remove) are open: 'Ma|heen|0|<girlId>'
  devPick: {},             // Wijzigen: ride cards whose "+ Passagier toevoegen" list is open, by 'Ma|heen|0'
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
