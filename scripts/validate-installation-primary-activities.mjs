// Prepared by Scout
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scriptTag=html.lastIndexOf('<script>');
assert.notEqual(scriptTag,-1,'activity-catalog UI script exists');
const scriptStart=scriptTag+'<script>'.length;
const scriptEnd=html.indexOf('</script>',scriptStart);
assert.notEqual(scriptEnd,-1,'activity-catalog UI script closes');
const runtime=html.slice(scriptStart,scriptEnd);
class Select{
  constructor(options,value){this.options=options;this.value=value;this.dataset={}}
  replaceChildren(...options){this.options=options;if(!options.some(option=>option.value===this.value))this.value=options[0]?.value||''}
}
const option=(value,text)=>({value,textContent:text});
const makeStage=name=>{
  const label={textContent:name},small={textContent:'scheduled',attributes:{},setAttribute(key,value){this.attributes[key]=value}};
  return{children:[{},label,small],querySelector:selector=>selector==='small'?small:null,attributes:{},setAttribute(key,value){this.attributes[key]=value},removed:false,remove(){this.removed=true}};
};
const create=new Select([
  option('site_preparation','Site preparation'),option('stone_footing','Stone footing'),option('panel_readiness','Panel readiness'),
  option('loading_hauling','Loading & hauling'),option('wall_installation','Wall installation'),option('field_closeout','Field closeout'),option('other','Other'),
],'site_preparation');
const edit=new Select([option('site_preparation','Site preparation'),option('other','Other')],'other');
const stages=['Site','Stone','Hauling','Install','Closeout'].map(makeStage);
const activity=option('','site preparation'),weekly=option('','wall installation'),next=option('','Plan site preparation and wall installation');
const selectors={
  '#installType':[create],
  '#installEditType':[edit],
  '.install-job-progress .install-stage':stages,
  '.install-card strong,.install-week-cell button strong':[activity,weekly],
  '.install-job-next span':[next],
};
const document={
  head:{append(){}},body:{},
  createElement:()=>({textContent:''}),
  querySelectorAll:selector=>selectors[selector]||[],
};
class Observer{constructor(callback){this.callback=callback}observe(){}}
vm.runInNewContext(runtime,{document,MutationObserver:Observer,Option:function(label,value){return option(value,label)}});
assert.deepEqual(create.options.map(x=>[x.value,x.textContent]),[
  ['site_preparation','Site readiness'],['stone_footing','Stone footing'],['wall_installation','Wall install'],['field_closeout','Field closeout'],
]);
assert.deepEqual(edit.options.map(x=>[x.value,x.textContent]),[
  ['site_preparation','Site readiness'],['stone_footing','Stone footing'],['wall_installation','Wall install'],['field_closeout','Field closeout'],['other','Other (legacy)'],
]);
assert.deepEqual(stages.filter(x=>!x.removed).map(x=>x.children[1].textContent),['Site readiness','Stone footing','Wall install','Field closeout']);
assert.equal(activity.textContent,'Site readiness');
assert.equal(weekly.textContent,'Wall install');
assert.equal(next.textContent,'Plan site readiness and wall install');
console.log('PASS: activity creation offers only the four approved activities');
console.log('PASS: editing retains the selected legacy type without exposing other legacy choices');
console.log('PASS: progress, weekly plan, activity cards, and next action use the approved names');

