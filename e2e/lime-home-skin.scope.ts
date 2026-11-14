// AppLayout owns the athlete home only outside compose/review/save. Its
// schedule-v2 identity similarly excludes the coach composer and V1/classic.
// Frame-local portals inherit the same exact existing route boundary.
export const homeClientOwnerFilter=':is(.fit-client-lime.client-home-identity,.fit-client-lime.client-home-identity *)'
export const homeTrainerPortalFilter=':is(html.fit-lime-document .schedule-v2-sheet-backdrop,html.fit-lime-document .schedule-v2-sheet-backdrop *)'
export const homeTrainerOwnerFilter=':is(.fit-lime-shell.trainer-schedule-v2-shell,.fit-lime-shell.trainer-schedule-v2-shell *,'+homeTrainerPortalFilter+')'
export const homeOwnerFilter=':is('+homeClientOwnerFilter+','+homeTrainerOwnerFilter+')'
export const homeMigrationGuard=':where(:not('+homeOwnerFilter+'))'
