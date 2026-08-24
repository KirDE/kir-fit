import{describe,it,expect}from'vitest';describe('app',()=>{it('supports crypto UUIDs',()=>expect(typeof crypto.randomUUID).toBe('function'))});
