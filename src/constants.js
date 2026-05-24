export const VERSION = "v1.0";

// ── palettes ──────────────────────────────────────────────────────────────────
export const DARK = {
  bg: "#0f1117", surface: "#181c27", card: "#1e2335", border: "#2a3150",
  accent: "#4f8ef7", accentDim: "#2a4a8a", green: "#2ecc71", orange: "#f39c12",
  purple: "#a78bfa", purpleDim: "#4c3a8a", red: "#e74c3c", text: "#e8ecf4", muted: "#7a85a3",
};

export const LIGHT = {
  bg: "#f0f2f8", surface: "#ffffff", card: "#e8ecf6", border: "#cdd3e8",
  accent: "#2563eb", accentDim: "#dbeafe", green: "#16a34a", orange: "#d97706",
  purple: "#7c3aed", purpleDim: "#ede9fe", red: "#dc2626", text: "#111827", muted: "#6b7280",
};

// Default export kept for any code that needs the palette statically (e.g. canvas drawing)
export const C = DARK;

export const REQUIRED_CORE = ["location", "product", "on_hand", "leadtime"];
export const MANUAL_ENTRY_FIELDS = ["location", "product", "leadtime"];
export const FIELD_LABELS = {
  location: "Location", product: "Product", on_hand: "On Hand",
  leadtime: "Lead Time (days)", daily_usage: "Daily Usage",
  category: "Category", cost: "Cost (per unit)",
};

export const STOCK_COLS = [
  { key: "location", label: "Location" },
  { key: "product", label: "Product" },
  { key: "category", label: "Category" },
  { key: "daily_usage", label: "Daily Usage" },
  { key: "on_hand", label: "On Hand" },
  { key: "days_on_hand", label: "Days On Hand" },
  { key: "leadtime", label: "Lead Time" },
  { key: "cost", label: "Cost (per unit)" },
  { key: "suggested", label: "Suggested Qty" },
  { key: "est_on_hand_after", label: "Est. On Hand After" },
  { key: "order", label: "Order Qty" },
];

export const SNAKE_SIZES = [
  { label: "Tiny  — 200×200",  cell: 10 },
  { label: "Small  — 240×240", cell: 12 },
  { label: "Medium — 320×320", cell: 16 },
  { label: "Large  — 400×400", cell: 20 },
  { label: "XL     — 480×480", cell: 24 },
];
