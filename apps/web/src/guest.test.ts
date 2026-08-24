import {beforeEach,describe,expect,it} from 'vitest';
import {guestApi} from './guest';

const values=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});

describe('guest persistence',()=>{
  beforeEach(()=>values.clear());
  it('keeps an active workout and completed set in local storage',async()=>{
    const started:any=await guestApi('/workouts/start',{method:'POST',body:JSON.stringify({introWeeks:true})});
    const exercise=started.exercises[0];
    await guestApi(`/workouts/${started.id}/sets`,{method:'POST',body:JSON.stringify({workoutExerciseId:exercise.id,setNumber:1,weight:40,reps:12})});
    const restored:any=await guestApi('/workouts/active');
    expect(restored.id).toBe(started.id);
    expect(restored.exercises[0].sets[0]).toMatchObject({weight:40,reps:12});
    expect(values.get('kirfit_guest_data_v1')).toContain('"weight":40');
  });
});
