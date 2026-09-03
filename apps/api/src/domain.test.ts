import {describe,it,expect} from 'vitest';
import {shouldSuggestIncrease,volume,nextWorkoutDay,calculateProteinTarget,scaleNutrients,localDateToUtc,localDateKey} from './domain.js';
describe('double progression',()=>{it('requires all planned sets at upper limit',()=>{expect(shouldSuggestIncrease([{reps:12},{reps:12},{reps:12}],3,12)).toBe(true);expect(shouldSuggestIncrease([{reps:12},{reps:11},{reps:12}],3,12)).toBe(false);});});
describe('volume',()=>{it('sums weight × reps',()=>expect(volume([{weight:30,reps:12},{weight:30,reps:10}])).toBe(660));});
describe('schedule',()=>{it('does not pick Monday when absent',()=>expect(nextWorkoutDay(new Date('2026-08-24T12:00:00Z'),[3,5,0]).getUTCDay()).toBe(3));});
describe('protein target',()=>{
  const base={heightCm:180,currentWeightKg:80,startingWeightKg:90,goalWeightKg:null,mode:'automatic' as const,manualProteinTargetGrams:null};
  it('uses current weight below BMI 30',()=>expect(calculateProteinTarget(base)).toMatchObject({weightSource:'latest',referenceWeightKg:80,referenceWeightSource:'current',targetGrams:130,recommendedRangeGrams:{min:95,max:130}}));
  it('uses goal weight at exactly BMI 30',()=>expect(calculateProteinTarget({...base,currentWeightKg:97.2,goalWeightKg:82})).toMatchObject({bmi:30,referenceWeightKg:82,referenceWeightSource:'goal',targetGrams:130}));
  it('uses BMI 25 reference without a goal',()=>expect(calculateProteinTarget({...base,currentWeightKg:110})).toMatchObject({referenceWeightKg:81,referenceWeightSource:'bmi25',targetGrams:130}));
  it('falls back to starting weight',()=>expect(calculateProteinTarget({...base,currentWeightKg:null})).toMatchObject({currentWeightKg:90,weightSource:'starting'}));
  it('returns no automatic target without weight',()=>expect(calculateProteinTarget({...base,currentWeightKg:null,startingWeightKg:null})).toMatchObject({targetGrams:null,referenceWeightKg:null}));
  it('keeps a manual target independent of weight',()=>expect(calculateProteinTarget({...base,mode:'manual',manualProteinTargetGrams:145,currentWeightKg:120})).toMatchObject({targetGrams:145,automaticTargetGrams:130}));
});
describe('nutrition totals',()=>{it('scales all nutrients deterministically',()=>expect(scaleNutrients({calories:501,proteinGrams:40,fatGrams:21,carbsGrams:30,fiberGrams:5},37.5)).toEqual({calories:187.88,proteinGrams:15,fatGrams:7.88,carbsGrams:11.25,fiberGrams:1.88}));});
describe('nutrition timezone',()=>{
  it('resolves DST day boundaries in an IANA timezone',()=>{
    const start=localDateToUtc('2026-03-29','Europe/Berlin');
    const end=localDateToUtc('2026-03-30','Europe/Berlin');
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(end.getTime()-start.getTime()).toBe(23*60*60*1000);
    expect(localDateKey(new Date('2026-03-29T22:30:00Z'),'Europe/Berlin')).toBe('2026-03-30');
  });
});
