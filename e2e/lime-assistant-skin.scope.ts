// MC57 uses the existing route identity; body portals need separate producer evidence.
export const assistantOwnerFilter=":is(.phone-frame.fit-lime-shell.assistant-identity,.phone-frame.fit-lime-shell.assistant-identity *)"
export const assistantMigrationGuard=":where(:not(:is(.phone-frame.fit-lime-shell.assistant-identity,.phone-frame.fit-lime-shell.assistant-identity *)))"
