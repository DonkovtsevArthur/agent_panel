---
name: figma-color-harmony
description: Color theory, shade generation, and text contrast rules for Harbor Figma Agent. Load when picking colors, creating palettes, ensuring readability, or «подобрать оттенок / сочетание».
---

# Figma color harmony (Harbor canvas tools)

## Color model

All `figma_set_fills` / `figma_set_stroke` values are **RGBA 0–1** (not 0–255).

Conversion: `r = R / 255`, `g = G / 255`, `b = B / 255`. Example: `#3B82F6` → `{ r: 0.231, g: 0.510, b: 0.965, a: 1 }`.

## Shade generation

Given a base color, generate a **5-step scale** (50–950) by adjusting lightness:

| Step | Use | Lightness shift |
|------|-----|----------------|
| 50 | Backgrounds, highlights | +40% lighter |
| 100 | Subtle backgrounds | +30% lighter |
| 200 | Borders, dividers | +20% lighter |
| 300 | Muted text, icons | +10% lighter |
| 400 | Secondary actions | +5% lighter |
| **500** | **Base color** | — |
| 600 | Hover states | −5% darker |
| 700 | Active/pressed | −10% darker |
| 800 | Dark accents | −20% darker |
| 900 | Darkest, headings on light bg | −30% darker |

### How to shift lightness (HSL)

1. Convert RGB → HSL
2. Adjust L (lightness) by the percentage above, clamped to 0–1
3. Convert HSL → RGB → RGBA 0–1

Agent formula for lighter: `L_new = min(1, L + shift)`. Darker: `L_new = max(0, L − shift)`.

### Quick shade via fills

When the agent needs a lighter variant without computing HSL:
- White overlay: `{ r: 1, g: 1, b: 1, a: 0.1 }` on top = 10% lighter
- Black overlay: `{ r: 0, g: 0, b: 0, a: 0.1 }` on top = 10% darker

Use `figma_set_fills` with **two fills** (base + overlay) for quick shade without color math.

## Color harmony

### For UI (practical palettes)

| Role | Count | Rule |
|------|-------|------|
| **Primary** | 1 | Brand color, main CTA, links |
| **Secondary** | 1 | Supporting action, less prominent |
| **Accent** | 0–1 | Attention grabber, badges, alerts |
| **Neutral** | 5–7 | Gray scale for text, borders, backgrounds |
| **Semantic** | 3–4 | Success (green), warning (amber), error (red), info (blue) |

### Harmony rules

| Scheme | Hue distance | When to use |
|--------|-------------|-------------|
| **Monochromatic** | 0° (same hue, different lightness) | Safe, clean, corporate |
| **Analogous** | ±30° | Harmonious, natural feel |
| **Complementary** | 180° | High contrast, CTA stands out |
| **Split-complementary** | 150° + 210° | Contrast without tension |
| **Triadic** | 120° apart | Vibrant, playful (use sparingly) |

**Practical rule:** pick ONE primary hue. Derive everything else from neutrals + one semantic color. Don't use 4+ saturated hues — it looks chaotic.

## Text contrast (WCAG)

Text must be readable. Minimum contrast ratios:

| Text size | Normal text (< 18pt / < 14pt bold) | Large text (≥ 18pt / ≥ 14pt bold) |
|-----------|-------------------------------------|-------------------------------------|
| **AA** (minimum) | 4.5:1 | 3:1 |
| **AAA** (preferred) | 7:1 | 4.5:1 |

### Contrast ratio formula

```
L = 0.2126 * R' + 0.7152 * G' + 0.0722 * B'
where R' = (R/255)^2.2 (gamma-corrected)
Contrast = (L_lighter + 0.05) / (L_darker + 0.05)
```

### Quick contrast checks for the agent

| Background | Safe text color | Ratio |
|------------|----------------|-------|
| White `#FFFFFF` | Black `#000000` | 21:1 ✓ |
| White `#FFFFFF` | Gray `#6B7280` | 5.0:1 ✓ AA |
| White `#FFFFFF` | Gray `#9CA3AF` | 3.0:1 ✗ fails AA for small text |
| Black `#000000` | White `#FFFFFF` | 21:1 ✓ |
| Black `#000000` | Gray `#9CA3AF` | 7.0:1 ✓ AAA |
| Blue `#3B82F6` | White `#FFFFFF` | 3.6:1 ✗ fails AA for small text |
| Blue `#2563EB` | White `#FFFFFF` | 4.6:1 ✓ AA |
| Dark blue `#1E40AF` | White `#FFFFFF` | 8.6:1 ✓ AAA |

### Rules for the agent

1. **Dark text on light bg** — always safe: `#1F2937` (gray-800) or `#111827` (gray-900) on white.
2. **Light text on dark bg** — use white or gray-100 (`#F3F4F6`) on dark backgrounds.
3. **Colored text** — only on white/light bg with ≥4.5:1 ratio. If unsure, darken the color (use shade 700+).
4. **Colored bg + white text** — use shade 600+ for the bg. Shade 500 often fails AA.
5. **Never** put mid-tone text (gray-400/500) on white — fails AA for small text.
6. **Muted text** — gray-500 (`#6B7280`) on white is borderline AA; prefer gray-600 (`#4B5563`).

## Practical palette template

When user asks for a color scheme, start with:

```
Primary:    #2563EB (blue-600)     — buttons, links
Primary hover: #1D4ED8 (blue-700)  — hover state
Primary light: #DBEAFE (blue-100)  — subtle bg

Neutral-900: #111827  — headings
Neutral-600: #4B5563  — body text
Neutral-400: #9CA3AF  — placeholder, disabled
Neutral-200: #E5E7EB  — borders, dividers
Neutral-50:  #F9FAFB  — page background

Success: #059669 (green-600)  — positive actions
Warning: #D97706 (amber-600)  — caution
Error:   #DC2626 (red-600)    — destructive, errors
```

Apply via `figma_set_fills` for backgrounds, `figma_set_stroke` for borders, `figma_set_font` + `figma_set_fills` on TEXT nodes for text color.

## Do not

- Invent colors from imagination — use a known palette (Tailwind, Material, or user's brand).
- Use shade 500 as bg + white text without checking contrast (often fails).
- Mix more than 2 saturated hues in one screen.
- Use pure black `#000000` for body text on white — too harsh; use gray-900 `#111827`.
- Forget alpha — `a: 1` is opaque, `a: 0` is invisible.
