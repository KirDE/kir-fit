const key='kirfit_token';
const guestKey='kirfit_guest';
export const token=()=>localStorage.getItem(key);
export const setToken=(v:string|null)=>v?localStorage.setItem(key,v):localStorage.removeItem(key);
export const isGuest=()=>localStorage.getItem(guestKey)==='1';
export const setGuest=(v:boolean)=>v?localStorage.setItem(guestKey,'1'):localStorage.removeItem(guestKey);
export async function api<T=any>(path:string,init:RequestInit={}){if(isGuest()){const {guestApi}=await import('./guest');return guestApi(path,init) as T;}const headers=new Headers(init.headers);headers.set('Content-Type','application/json');if(token())headers.set('Authorization','Bearer '+token());const r=await fetch('/api'+path,{...init,headers});if(r.status===401){setToken(null);location.reload();throw new Error('Authentication required')}if(!r.ok){const e=await r.json().catch(()=>({error:r.statusText}));throw new Error(e.error||'Request failed')}return (r.status===204?null:await r.json()) as T;}
export const uuid=()=>crypto.randomUUID();
