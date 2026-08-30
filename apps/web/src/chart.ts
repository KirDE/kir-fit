export function paddedDomain(values: number[]): [number, number] | undefined {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return undefined;

  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  const padding = Math.max(0.5, (maximum - minimum) * 0.2);

  return [
    Math.floor((minimum - padding) * 10) / 10,
    Math.ceil((maximum + padding) * 10) / 10,
  ];
}
