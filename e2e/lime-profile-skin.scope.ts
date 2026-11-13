// Existing AppLayout identities: client own profile/settings and self edit have
// separate dedicated roots. Trainer identity is also used by corporate services,
// so qualify its direct content by the existing exact pathname|routeStep value.
// No :has, route/DOM mutation, or role/rollout inference is needed.
export const profileClientShellOwnerFilter=':is(.fit-client-lime.client-profile-shell-identity,.fit-client-lime.client-profile-shell-identity *)'
export const profileClientEditOwnerFilter=':is(.fit-client-lime.client-card-edit-identity,.fit-client-lime.client-card-edit-identity *)'
export const profileTrainerContentSelector='.fit-lime-shell.trainer-profile-identity > .content:is([data-viewport-route="/profile|"],[data-viewport-route="/profile/settings|"])'
export const profileTrainerPageSelector=profileTrainerContentSelector+' > .profile-page'
// Actual mounted profile portals are appended to .phone-frame after .content.
// Body fallback is an emergency shared consumer, not newly claimed ownership.
export const profileTrainerSiblingSelector=profileTrainerContentSelector+' ~ :is(.tab-bar,.modal-overlay,.sheet-overlay,.overflow-list,.coachmark-bubble)'
export const profileTrainerOwnerFilter=':is('+profileTrainerContentSelector+','+profileTrainerPageSelector+','+profileTrainerPageSelector+' *,'+profileTrainerSiblingSelector+','+profileTrainerSiblingSelector+' *)'
export const profileOwnerFilter=':is('+profileClientShellOwnerFilter+','+profileClientEditOwnerFilter+','+profileTrainerOwnerFilter+')'
export const profileMigrationGuard=':where(:not('+profileOwnerFilter+'))'
