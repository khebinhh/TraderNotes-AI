export function getMarketDate(): string {
  const now = new Date();
  const nyDate = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const year = nyDate.getFullYear();
  const month = String(nyDate.getMonth() + 1).padStart(2, "0");
  const day = String(nyDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
