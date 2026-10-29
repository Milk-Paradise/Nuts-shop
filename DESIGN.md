---
version: alpha
name: Nuts Store
description: A calm Russian electronics store with a vivid lilac product stage.
colors:
  primary: "#7050E5"
  background: "#F7F7FA"
  surface: "#FFFFFF"
  ink: "#232329"
  muted: "#74747E"
  border: "#E9E9EF"
  success: "#257B55"
  danger: "#B33545"
typography:
  sans:
    fontFamily: "Arial, Helvetica, sans-serif"
  display:
    fontFamily: "Arial, Helvetica, sans-serif"
rounded:
  DEFAULT: "1rem"
  lg: "2rem"
spacing:
  page-max: "86rem"
  section-gap: "4.5rem"
components:
  button: {}
  input: {}
  modal: {}
  card: {}
---

# Nuts Store design system

## Overview

Russian electronics shoppers need to browse devices, compare configurations and
request an order without online payment. Brand on home; familiar utility in catalog
and checkout. Signature: a large lavender iPhone stage with an inset editorial label.
Product photography, wide type and quiet surfaces convey the Apple-inspired brief.
No invented discounts, testimonials, delivery guarantees or certifications.

## Colors

Canonical runtime tokens: src/app/styles/globals.css. Tailwind consumes these same
CSS variables. Purple is brand/action, green is availability, red is validation.
Day/dawn/dusk/night change surfaces and text without changing semantic hierarchy.

## Typography

Locally available Arial/Helvetica provide Cyrillic and avoid font-network failures.
Display 40–76px with tight tracking; body 14–16px, line-height 1.5. Prices tabular.

## Layout

Maximum 1376px; 40px desktop gutters, 20px mobile. Four-column product grid; two on
mobile. Hero has a main device stage and a narrow accessory story. No clipping
controls at 360px. Reserve all image aspect ratios.

## Elevation & Depth

Mostly flat surfaces with fine borders. Soft shadow on interactive hover only.
Opaque dialog over a translucent scrim, native dialog supplies focus management.

## Shapes

32px hero, 22px cards, 12px buttons, pills for category and configuration selection.

## Components

Shared Button/Input/Modal/Skeleton live in shared/ui. Lucide 1.6px strokes.
Actions have focus-visible outlines and disabled states; form errors are inline.
Global visible scrollbars, stable gutter; native selects for sorting.

## Motion

React Bits gradient and FadeContent/AnimatedContent where appropriate. Reduced
motion disables decorative movement, observers reveal content without hiding it.

## Do's and Don'ts

- Let product images and large editorial type carry the identity.
- Keep checkout predictable and order status truthful.
- Never show mock prices as verified backend data in technical documentation.
- Never move primary controls when hover or feedback changes.

## Store presentation

Apple products only. Brand wordmark: nuts in brand purple, store in primary ink.
Display a single current price; no struck-through prices or discount anchors.
Store contact is email only, configured by STORE_EMAIL in shared/config.

## MacBook editorial section

User-requested Tech-Noir reference is integrated into the shared footer, with
contacts and navigation over the Renaissance/MacBook scene as a full footer background.
The separate home banner, promotional intro and CTA are removed. A dark red overlay
keeps white navigation and contact text readable. The scene uses cover positioning
on desktop and mobile; the storefront's other sections keep their existing tokens.
The footer omits playback controls at the user's request. Offscreen/tab pause,
reduced-motion poster and media-error poster remain in shared/ui/AmbientVideo.
No audio or new runtime animation library.
