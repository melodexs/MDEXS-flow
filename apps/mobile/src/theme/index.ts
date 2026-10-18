/**
 * Shared theme: colors, spacing, and typography scale.
 * Kept intentionally small; no UI framework.
 */

export const colors = {
  primary: "#0251B0",
  primaryMuted: "#0251b0aa",
  accent: "#D1FF42",
  background: "#F7F9FC",
  surface: "#FFFFFF",
  text: "#101828",
  textSecondary: "#667085",
  border: "#E4EAF1",
  danger: "#D92D20",
  success: "#039855",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const typography = {
  title: {
    fontSize: 28,
    fontWeight: "700" as const,
    color: colors.text,
  },
  heading: {
    fontSize: 20,
    fontWeight: "600" as const,
    color: colors.text,
  },
  body: {
    fontSize: 16,
    fontWeight: "400" as const,
    color: colors.text,
  },
  caption: {
    fontSize: 13,
    fontWeight: "400" as const,
    color: colors.textSecondary,
  },
} as const;

export const radius = { sm: 6, md: 12, lg: 20 } as const;
