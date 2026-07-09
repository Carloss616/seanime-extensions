export const formatTs = (ms: number): string => {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const formatListStatus = (status: string | undefined): string => {
  if (!status) return "—";
  return status.replace(/_/g, " ").toLowerCase();
};

export const ent = (n: number): string =>
  `${n} ${n === 1 ? "entry" : "entries"}`;
