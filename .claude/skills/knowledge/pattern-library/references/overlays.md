# Overlays — refused, with redirects

Overlays (Modal, Popover, Tooltip, Dropdown) are **out of scope**. The
orchestrator refuses `category: overlay`.

## Why

Overlays depend on capabilities that diverge fundamentally per platform:

- **Portals / z-order:** web renders to a portal; native has no equivalent DOM.
- **Focus trap + restore:** correct focus management is subtle and platform-specific.
- **Dismiss semantics:** ESC, scrim tap, back button (Android) all differ.
- **Scroll locking, inert background, ARIA (`aria-modal`, `role="dialog"`).**

There is no honest single abstraction across web + SwiftUI + Compose + RN. A
generated one would be wrong in ways users can't see until it fails AT.

## Redirect

| platform | use |
|----------|-----|
| React/Vue/Svelte | Radix UI (headless), or `<dialog>` |
| React Native | built-in `<Modal>` |
| SwiftUI | `.sheet(isPresented:)` / `.popover` |
| Compose | `Dialog` / `ModalBottomSheet` composable |

Compose the trigger + content with in-scope skills; hand the overlay shell to
the platform primitive.
