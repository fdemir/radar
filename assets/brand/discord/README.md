# Radar Discord profile assets

These assets reuse the website's existing identity without redrawing the logo.

- `radar-profile-1024.png`: 1024 × 1024 PNG, 40,022 bytes. Original blue logo on white with circular-crop padding.
- `radar-banner-680x240.png`: 680 × 240 PNG, 26,571 bytes. Website wordmark and hero headline, with space at the bottom left for the profile avatar.
- `radar-discord-preview.png`: a presentation mockup showing the avatar overlapping the banner; upload the two files above separately.

## Source identity

- Logo geometry and `#2597d0`: `apps/web/src/assets/radar.svg`.
- Wordmark: `Brand` in `apps/web/src/features/radar/components.tsx`; Manrope Bold, tracking −0.06em.
- Headline: `Track the web. Get updates.` from `apps/web/src/routes/_index.tsx`; Manrope SemiBold, tracking −0.055em.
- Light-theme background gradient from `packages/ui/src/styles/globals.css`: `#779bc1` at 0%, `#9abfda` at 58%, `#cbdcec` at 100%.
- Text `#070709`, white background, white headline.

Rendered directly from the existing vector and the same Google Fonts Manrope files used by the website. The banner was rendered at twice its final resolution and downsampled. No generative image edits or font substitutions were used.
