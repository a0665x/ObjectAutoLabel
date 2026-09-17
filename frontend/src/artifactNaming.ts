export function versionedBuildName(prefix: string, existingNames: string[] = [], date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const highestVersion = existingNames.reduce((highest, name) => {
    const match = name.match(/_v(\d+)$/i);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  const version = Math.max(existingNames.length, highestVersion) + 1;
  return `${prefix}_${pad(date.getMonth() + 1)}${pad(date.getDate())}_v${String(version).padStart(3, "0")}`;
}
