// Exact route owner and negative guard for the accepted MC5.8 block.
export const participantsOwnerFilter=":is(.phone-frame.fit-lime-shell:is(.trainer-clients-identity,.trainer-client-detail-identity,.trainer-client-form-identity),.phone-frame.fit-lime-shell:is(.trainer-clients-identity,.trainer-client-detail-identity,.trainer-client-form-identity) *,.phone-frame.fit-client-lime:has(.trainer-catalog-page,.public-trainer-page),.phone-frame.fit-client-lime:has(.trainer-catalog-page,.public-trainer-page) *)"
export const participantsMigrationGuard=':where(:not('+participantsOwnerFilter+'))'
