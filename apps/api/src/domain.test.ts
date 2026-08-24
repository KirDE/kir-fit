import {describe,it,expect} from 'vitest';
import {shouldSuggestIncrease,volume,nextWorkoutDay} from './domain.js';
describe('double progression',()=>{it('requires all planned sets at upper limit',()=>{expect(shouldSuggestIncrease([{reps:12},{reps:12},{reps:12}],3,12)).toBe(true);expect(shouldSuggestIncrease([{reps:12},{reps:11},{reps:12}],3,12)).toBe(false);});});
describe('volume',()=>{it('sums weight × reps',()=>expect(volume([{weight:30,reps:12},{weight:30,reps:10}])).toBe(660));});
describe('schedule',()=>{it('does not pick Monday when absent',()=>expect(nextWorkoutDay(new Date('2026-08-24T12:00:00Z'),[3,5,0]).getUTCDay()).toBe(3));});
