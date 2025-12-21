Here’s a compact palette built around your logo orange (`#ff9900`), inspired by early‑2000s Steam: dark UI, muted oranges/greens, and steel/monochrome tones.

### Core Brand Color
- **Brand Orange (primary accent)**  
  - Hex: `#ff9900`  
  - Use: main highlight, important buttons, logo, key icons.

---

### Dark Backgrounds & Surfaces

- **Deep Charcoal (main background)**  
  - Hex: `#121217`  
  - Use: app/page background, large panels.

- **Gunmetal (secondary background / panels)**  
  - Hex: `#1c2127`  
  - Use: sidebars, cards, modal backgrounds.

- **Steel Grey (tertiary surface)**  
  - Hex: `#2b333b`  
  - Use: hover states, raised elements, secondary panels.

---

### Monochrome Text & Borders

- **Off‑White (primary text)**  
  - Hex: `#f3f4f5`  
  - Use: body text on dark backgrounds.

- **Muted Light Grey (secondary text)**  
  - Hex: `#c2c7cc`  
  - Use: labels, placeholders, less-important info.

- **Dim Grey (borders / dividers)**  
  - Hex: `#4a4f57`  
  - Use: card borders, subtle separators.

---

### Orange System (2000s UI feel)

- **Dark Burnt Orange (active / pressed)**  
  - Hex: `#cc7a00`  
  - Use: pressed buttons, active nav item, badges.

- **Soft Amber (hover / subtle highlight)**  
  - Hex: `#ffbb33`  
  - Use: hover on orange elements, light glows.

- **Rust Tint (background accents)**  
  - Hex: `#5a3b15`  
  - Use: subtle gradients behind the logo, notification chips.

---

### Green System (old Steam-inspired)

- **Dark Moss Green (secondary accent)**  
  - Hex: `#1b3a2e`  
  - Use: success states, secondary buttons, status bars.

- **Muted Steam Green**  
  - Hex: `#3a5f4a`  
  - Use: toggles, tags, small accents that shouldn’t overshadow the orange.

- **Soft HUD Green (subtle glow)**  
  - Hex: `#7fbf7b`  
  - Use: tiny indicators, online/active states.

---

### Optional Highlight / Error

- **Warning Red (error / destructive)**  
  - Hex: `#d84747`  
  - Use: errors, “danger” buttons, critical alerts.

---

### Example CSS Variables

```css
:root {
  /* Brand */
  --color-brand-orange: #ff9900;

  /* Backgrounds */
  --color-bg-primary: #121217;
  --color-bg-secondary: #1c2127;
  --color-bg-tertiary: #2b333b;

  /* Text & lines */
  --color-text-primary: #f3f4f5;
  --color-text-secondary: #c2c7cc;
  --color-border-subtle: #4a4f57;

  /* Oranges */
  --color-orange-dark: #cc7a00;
  --color-orange-soft: #ffbb33;
  --color-orange-rust-bg: #5a3b15;

  /* Greens */
  --color-green-dark: #1b3a2e;
  --color-green-muted: #3a5f4a;
  --color-green-soft: #7fbf7b;

  /* Utility */
  --color-error: #d84747;
}
```