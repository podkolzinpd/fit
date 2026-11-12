// Active current/history only: no presets or unclassified profile bootstrap.
// Trainer list/calendar uses its real page marker, never the main Schedule.
export const workoutListOwnerFilter=":is(.fit-client-lime.client-workouts-identity:has(> .content > .client-workouts-page > :is(#workouts-current-panel:not([hidden]),#workouts-history-panel:not([hidden]))),.fit-client-lime.client-workouts-identity:has(> .content > .client-workouts-page > :is(#workouts-current-panel:not([hidden]),#workouts-history-panel:not([hidden]))) *,.fit-lime-shell.client-workouts-identity:has(> .content > .trainer-client-workouts-page),.fit-lime-shell.client-workouts-identity:has(> .content > .trainer-client-workouts-page) *)"
export const workoutListMigrationGuard=':where(:not('+workoutListOwnerFilter+'))'
