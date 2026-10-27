// Existing restricted UID only; no grant mutation or email reassignment.
const PRODUCTION_VIEWS=['today','five_day','table_board','weekly_forecast'];
function exactSet(actual,expected){return Array.isArray(actual)&&actual.length===expected.length&&new Set(actual).size===actual.length&&expected.every(x=>actual.includes(x));}
export function isRestrictedPilot(scope){
  return scope&&exactSet(Object.keys(scope),['enabled','preset','division','production_views','production_write','inventory_counts','inventory_manage','inventory_other_mutations','approved_walls_packs','unapproved_packs','management','purchasing','approvals','other_divisions','independent_grants'])
    &&scope.enabled===true&&scope.preset==='walls_existing_employee_pilot_v1'&&scope.division==='walls'
    &&exactSet(scope.production_views,PRODUCTION_VIEWS)&&scope.production_write===false
    &&scope.inventory_counts===true&&scope.inventory_manage===false&&scope.inventory_other_mutations===false
    &&scope.approved_walls_packs===true&&scope.unapproved_packs===false
    &&scope.management===false&&scope.purchasing===false&&scope.approvals===false
    &&Array.isArray(scope.other_divisions)&&scope.other_divisions.length===0
    &&Array.isArray(scope.independent_grants)&&scope.independent_grants.length===0;
}
export function matchesExistingEmailIdentity(user,record){
  return user?.id===record.auth_uid&&user.email===record.auth_email&&user.is_anonymous===false
    &&(!Object.hasOwn(user,'is_sso_user')||user.is_sso_user===false)
    &&user.app_metadata?.provider==='email'&&exactSet(user.app_metadata?.providers,['email'])
    &&Array.isArray(user.identities)&&user.identities.length===1&&user.identities[0]?.provider==='email'
    &&user.identities[0]?.user_id===record.auth_uid&&user.identities[0]?.identity_data?.email===record.auth_email;
}
