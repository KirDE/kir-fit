export function shouldSuggestIncrease(sets:{reps:number}[], plannedSets:number, maxReps:number) {
  return sets.length >= plannedSets && sets.slice(0,plannedSets).every(s=>s.reps>=maxReps);
}
export function volume(sets:{weight:number|string;reps:number}[]) {
  return sets.reduce((sum,s)=>sum+Number(s.weight)*s.reps,0);
}
export function nextWorkoutDay(now:Date, preferred:number[]) {
  for(let add=0;add<8;add++){const d=new Date(now);d.setDate(d.getDate()+add);if(preferred.includes(d.getDay()))return d;}return now;
}
