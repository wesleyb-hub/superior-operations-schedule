// Import the actual new access helpers into legacy isolated-function VM fixtures.
import vm from 'node:vm';
export function installHubReaderHelpers(context,html){
 const start=html.indexOf('function hubReadOnly('),end=html.indexOf('function viewAllowed(',start);
 if(start<0||end<0)throw Error('Hub read-only helpers missing');
 context.currentUserFullReadAccess??=false;
 vm.runInContext(html.slice(start,end),context);
}
