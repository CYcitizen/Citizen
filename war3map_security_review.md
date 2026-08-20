# war3map.j cheat-signal review

Reviewed remote file: <https://github.com/CYcitizen/riva/blob/main/war3map.j>

## Scope

This repository does not currently contain `war3map.j`; the review was performed against the remote GitHub file linked above. The goal was to look for obvious cheat/backdoor signals such as hidden chat commands, secret key sequences, player-resource mutation, fog-of-war manipulation, level grants, movement-speed grants, and command names such as `-mk`.

## Findings

A targeted scan of the accessible source preview did not confirm an existing hidden cheat trigger from the requested key sequences. The remote file is large, so this note should be treated as a triage result rather than a complete assurance review.

Potentially sensitive Warcraft III JASS APIs and patterns to review manually in the full file include:

- `SetPlayerState` or `PLAYER_STATE_RESOURCE_GOLD` for gold/resource grants.
- `CreateFogModifier*`, `FogModifierStart`, `GetLocalPlayer`, or fog constants for map-vision changes.
- `AddHeroXP`, `SetHeroLevel`, or related hero-level APIs for level manipulation.
- `SetUnitMoveSpeed` or item/ability paths that grant movement speed.
- chat-command handlers registered with `TriggerRegisterPlayerChatEvent`, especially commands that start with `-`.
- keyboard-event handlers such as arrow-key or ESC events.

## Safe recommendation

Do not add hidden, per-player cheats or code intended to evade an anti-cheat command such as `-mk`. If developer/test functionality is needed, implement it as an explicit debug/admin-only mode that is documented, gated, and disabled in public builds.
