type Pending={id:string,path:string,init:RequestInit};const store='kirfit_pending';
const read=():Pending[]=>JSON.parse(localStorage.getItem(store)||'[]');
export function queue(item:Pending){const q=read();if(!q.some(x=>x.id===item.id))q.push(item);localStorage.setItem(store,JSON.stringify(q));}
export async function flush(sender:(p:string,i:RequestInit)=>Promise<any>){if(!navigator.onLine)return;const q=read();for(const item of q){try{await sender(item.path,item.init);localStorage.setItem(store,JSON.stringify(read().filter(x=>x.id!==item.id)));}catch{break;}}}
