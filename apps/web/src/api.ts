const key='kirfit_token';
export const token=()=>localStorage.getItem(key);
export const setToken=(v:string|null)=>v?localStorage.setItem(key,v):localStorage.removeItem(key);
export async function api<T=any>(path:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set('Content-Type','application/json');if(token())headers.set('Authorization','Bearer '+token());const r=await fetch('/api'+path,{...init,headers});if(r.status===401){setToken(null);location.reload();throw new Error('Authentication required')}if(!r.ok){const e=await r.json().catch(()=>({error:r.statusText}));throw new Error(e.error||'Request failed')}return (r.status===204?null:await r.json()) as T;}
export const uuid=()=>crypto.randomUUID();
