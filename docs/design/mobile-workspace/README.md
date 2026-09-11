# Mobile workspace composition

Approved for issue #347 in Lavish: **five tabs with More**. The reference is
[`index.html`](index.html), using Interview Arc's existing teal, mineral paper,
Geist body type, and editorial headings. Its sample records and timer are
illustrative, not personal practice data or working backend integrations.

The implementation keeps the desktop identity and makes phone composition
explicit: one compact application bar, four primary destinations plus More,
short headings, flat lists with secondary-action sheets, and direct readers.
Phone rules belong to `app/mobile-workspace.css`. Shared scrolling and desktop
containment belong to `app/workspace-responsive.css`.

The existing desktop topic ribbon was also squeezing labels at intermediate
widths. It now switches from three columns to category rows based on the
ribbon's own available width, without changing the wide-screen composition.

Research informed the direction rather than supplying a copied product skin:

- [Apple design tips](https://developer.apple.com/design/tips/): readable text,
  touch targets, and avoiding clipped content.
- [Linear's design refresh](https://linear.app/now/behind-the-latest-design-refresh):
  quieter navigation and clearer content hierarchy.
- [Linear mobile navigation](https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile):
  a small set of primary destinations with additional navigation available.

Acceptance covers 375–440px phones, readable code with horizontal scrolling
and optional wrapping, sheet dismissal and focus return, normal phone document
scrolling, an explicit Reviews selection cart, full-screen Engineering navigation,
and resizing through intermediate desktop widths. The 580px results minimum is
desktop-only. `scripts/check-phone-flow.mjs` exercises populated selections,
failed queued saves and recovery, role-context response failures, and the phone
layout with synthetic local responses in Chromium and WebKit. Browser emulation does not
replace physical iPhone keyboard and safe-area acceptance.
