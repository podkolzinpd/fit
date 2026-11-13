// AppLayout assigns these dedicated route identities before paint. Unlike the
// workouts tab host, every state on each Progress route is in the same block.
export const progressOwnerFilter=':is(.fit-client-lime.progress-identity,.fit-client-lime.progress-identity *,.fit-lime-shell.trainer-progress-identity,.fit-lime-shell.trainer-progress-identity *)'
export const progressMigrationGuard=':where(:not('+progressOwnerFilter+'))'
