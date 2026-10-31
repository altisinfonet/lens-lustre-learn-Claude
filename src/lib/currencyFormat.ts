/**
 * Centralized currency formatting utilities.
 * Use these everywhere instead of hardcoding ₹ / $ symbols.
 */

/** Format a number as Indian Rupees: ₹1,23,456.78 */
export const formatINR = (amount: number, decimals = 2): string => {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

/** Format a number as US Dollars: $1,234.56 */
export const formatUSD = (amount: number, decimals = 2): string => {
  return `$${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

/** Format with sign prefix: +$10.00 or -$5.00 */
export const formatUSDSigned = (amount: number, decimals = 2): string => {
  const prefix = amount >= 0 ? "+" : "";
  return `${prefix}${formatUSD(amount, decimals)}`;
};

/** Format INR without decimals (for quick-amount buttons like ₹500) */
export const formatINRShort = (amount: number): string => {
  return `₹${amount.toLocaleString("en-IN")}`;
};

/** Format USD without locale (for micro amounts like $0.010) */
export const formatUSDFixed = (amount: number, decimals = 2): string => {
  return `$${Number(amount).toFixed(decimals)}`;
};

/** Format INR without locale (for PDF / plain text) */
export const formatINRFixed = (amount: number, decimals = 2): string => {
  return `₹${Number(amount).toFixed(decimals)}`;
};
