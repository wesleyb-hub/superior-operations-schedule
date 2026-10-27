import test from 'node:test';
import assert from 'node:assert/strict';
import {HUB_READONLY_SCOPE,isHubReadonlyProfile,isRestrictedPilot,isReviewedEmployeeScope} from '../employee-password-candidate/identity.mjs';
const reader=()=>structuredClone(HUB_READONLY_SCOPE);
const pilot={enabled:true,preset:'walls_existing_employee_pilot_v1',division:'walls',production_views:['today','five_day','table_board','weekly_forecast'],production_write:false,inventory_counts:true,inventory_manage:false,inventory_other_mutations:false,approved_walls_packs:true,unapproved_packs:false,management:false,purchasing:false,approvals:false,other_divisions:[],independent_grants:[]};
test('reader employee scope is explicit and separate from unchanged legacy pilot',()=>{
 assert.equal(isHubReadonlyProfile(reader()),true);assert.equal(isReviewedEmployeeScope(reader()),true);
 assert.equal(isRestrictedPilot(reader()),false);assert.equal(isRestrictedPilot(pilot),true);assert.equal(isReviewedEmployeeScope(pilot),true);assert.equal(isHubReadonlyProfile(pilot),false);
});
for(const key of Object.keys(HUB_READONLY_SCOPE))test(`reader scope fails closed for missing, null or changed ${key}`,()=>{
 let s=reader();delete s[key];assert.equal(isReviewedEmployeeScope(s),false);
 s=reader();s[key]=null;assert.equal(isReviewedEmployeeScope(s),false);
 s=reader();s[key]=typeof s[key]==='boolean'?!s[key]:Array.isArray(s[key])?[...s[key],'unexpected']:s[key]+'-unexpected';assert.equal(isReviewedEmployeeScope(s),false);
});
for(const key of Object.keys(HUB_READONLY_SCOPE).filter(k=>Array.isArray(HUB_READONLY_SCOPE[k])))test(`reader ${key} rejects removed values and duplicates, order-independent`,()=>{
 let s=reader();if(s[key].length){s[key].pop();assert.equal(isHubReadonlyProfile(s),false);}
 s=reader();s[key].push(s[key][0]);assert.equal(isHubReadonlyProfile(s),false);
 s=reader();s[key].reverse();assert.equal(isHubReadonlyProfile(s),true);
});
test('reader scope rejects added field, generic admin, unknown profile and malformed input',()=>{
 assert.equal(isReviewedEmployeeScope({...reader(),admin:true}),false);
 for(const s of [undefined,null,[],{},'admin',{...reader(),preset:'admin'}])assert.ok(!isReviewedEmployeeScope(s));
});
