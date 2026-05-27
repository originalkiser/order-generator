export const fmtNum = (n, decimals = 1) => {
  if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—";
  const num = Number(n);
  const abs = Math.abs(num);
  // Only show extra decimals (up to 4) for very small non-zero values
  if (abs > 0 && abs < 0.001) {
    return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return num.toLocaleString(undefined, { maximumFractionDigits: decimals });
};

// For usage: show up to 6 decimal places for sub-1 values, 1 decimal otherwise
export const fmtUsage = (n) => {
  if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—";
  const num = Number(n);
  if (num === 0) return "0";
  const abs = Math.abs(num);
  if (abs < 1 && abs > 0) {
    // Find the first significant digit and show up to 6 decimal places
    return num.toLocaleString(undefined, { maximumFractionDigits: 6, minimumSignificantDigits: 1 });
  }
  return num.toLocaleString(undefined, { maximumFractionDigits: 1 });
};

export const fmtCurrency = (n) =>
  n === null || n === undefined || n === "" || isNaN(Number(n))
    ? "—"
    : "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
