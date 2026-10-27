import test from 'node:test';
import assert from 'node:assert/strict';
import {MIXED_EMPLOYEE_SCOPE,isRestrictedMixedProfile,isRestrictedPilot,isReviewedEmployeeScope} from '../employee-password-candidate/identity.mjs';
const mixed=()=>structuredClone(MIXED_EMPLOYEE_SCOPE);
const pilot={enabled:true,preset:'walls_existing_employee_pilot_v1',division:'walls',production_views:['today','five_day','table_board','weekly_forecast'],production_write:false,inventory_counts:true,inventory_manage:false,inventory_other_mutations:false,approved_walls_packs:true,unapproved_packs:false,management:false,purchasing:false,approvals:false,other_divisions:[],independent_grants:[]};
test('mixed employee scope is explicit and separate from unchanged legacy pilot',()=>{
 assert.equal(isRestrictedMixedProfile(mixed()),true);assert.equal(isReviewedEmployeeScope(mixed()),true);
 assert.equal(isRestrictedPilot(mixed()),false);assert.equal(isRestrictedPilot(pilot),true);assert.equal(isReviewedEmployeeScope(pilot),true);assert.equal(isRestrictedMixedProfile(pilot),false);
});
for(const key of Object.keys(MIXED_EMPLOYEE_SCOPE))test(`mixed scope fails closed for missing, null or changed ${key}`,()=>{
 let s=mixed();delete s[key];assert.equal(isReviewedEmployeeScope(s),false);
 s=mixed();s[key]=null;assert.equal(isReviewedEmployeeScope(s),false);
 s=mixed();s[key]=typeof s[key]==='boolean'?!s[key]:Array.isArray(s[key])?[...s[key],'unexpected']:s[key]+'-unexpected';assert.equal(isReviewedEmployeeScope(s),false);
});
for(const key of Object.keys(MIXED_EMPLOYEE_SCOPE).filter(k=>Array.isArray(MIXED_EMPLOYEE_SCOPE[k])))test(`mixed ${key} rejects removed values and duplicates, order-independent`,()=>{
 let s=mixed();s[key].pop();assert.equal(isRestrictedMixedProfile(s),false);
 s=mixed();s[key].push(s[key][0]);assert.equal(isRestrictedMixedProfile(s),false);
 s=mixed();s[key].reverse();assert.equal(isRestrictedMixedProfile(s),true);
});
test('mixed scope rejects added field, generic admin, unknown profile and malformed input',()=>{
 assert.equal(isReviewedEmployeeScope({...mixed(),admin:true}),false);
 for(const s of [undefined,null,[],{},'admin',{...mixed(),preset:'admin'}])assert.ok(!isReviewedEmployeeScope(s));
});
