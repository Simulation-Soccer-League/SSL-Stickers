# API reference

Every route lives under `src/pages/api`. Handlers are thin; the logic is in `src/server/services`.

## Conventions

- **Auth:** the `ssl_session` cookie (HS256 JWT, HTTP-only, 30 days, renewed after a day of use). Routes marked *login* return `401 {error}` without it.
- **Roles** (`users.status`): `normal` 0, `moderator` 1, `admin` 3. Value 2 (the old `card_approver`) is retired. Role-restricted routes return `403 {error: "You do not have permission to do that"}`.
- **Same-origin check:** POST, PUT, PATCH and DELETE need an `Origin` (or `Referer`) matching `APP_ORIGIN`, or the request host, or they get `403 {error: "Cross-site request rejected"}`. The bearer-token pack-grant route is exempt.
- **Errors:** JSON `{error: "<message>"}`, sometimes with extra fields (`card_ids`, `files`, `ids`). Unsupported methods get `405`; bodies over the size limit get `413`; malformed JSON gets `400`; unexpected failures get `500 {error: "Internal server error"}`.
- **Bodies:** JSON, except `cards_with_params` and `cards_by_rarity` (form data, URL-encoded or JSON) and `original_cards` (multipart).
- **Enums** are strings: card rarity `"Bronze" | "Silver" | "Gold" | "Diamond"` (stored 0–3); trade status `"pending" | "accepted" | "declined"` (0–2).
- **Card IDs:** `user_cards.uuid` is `VARBINARY(16)` and is exposed as a lowercase dashed UUID string.
- **Timestamps:** ISO 8601 in UTC with milliseconds, e.g. `2026-06-08T21:34:38.670Z`.
- **Pagination:** `page` (default 1) and `per_page` (default 10, max 100). Invalid values fall back to the defaults.

## Health

| Method & path | Response |
|---|---|
| `GET /api/health` | `200 {status: "ok", database: "ok", forum: "ok"}`, or `503` with `"error"` for whichever database is unreachable |

## Users and session

| Method & path | Access | Request | Success | Errors |
|---|---|---|---|---|
| `POST /api/v1/login` | public | `{username, password}` | `200 {id, username}` and sets the cookie | `401 {error: "Invalid credentials"}`; `403 {error}` banned or awaiting activation; `429` with `Retry-After` |
| `POST /api/v1/logout` | public | — | `204`, clears the cookie | — |
| `GET /api/v1/me` | login | — | `200 {status, id, username}` (`status` is the role name) | `401 {user: null}` |
| `GET /api/v1/users_but_me` | login | — | `200 ["username", ...]`, ordered by id | `401` |

**Login:**
- The username and password are checked against the MyBB users table (`MYBB_USERS_TABLE`). MyBB salted MD5 and bcrypt are supported; other formats are refused and logged as "unsupported".
- Usergroups 5 (awaiting activation) and 7 (banned) are refused, but only after a correct password.
- The stickers user is found by `forum_uid`, or linked by username, or created. Their username follows forum renames.
- Rate limit: 10 failures per username+IP and 50 per IP in 15 minutes. The client IP comes from `X-Forwarded-For` only when `TRUST_PROXY=true`.

## External pack grants

Called by an outside system, not the browser.

| Method & path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/v1/external/pack_grants` | Header `Authorization: Bearer <PACK_GRANT_API_TOKEN>`; JSON or form `{username}` (forum username) | `200 {username, packs_available}` | `401 {error: "Unauthorized"}`; `400` if `username` is missing; `404 {error: "User not found"}` if there is no forum user |

The route adds one pack atomically, and creates the stickers user if needed.

## Packs

| Method & path | Access | Success | Errors |
|---|---|---|---|
| `GET /api/v1/pack_count` | login | `200 {packs_available}` | `401` |
| `POST /api/v1/pack` | login | `200 {cards: [{public_id: "<season>/<Rarity>/<api_id>", rarity, new_card}], packs_available}` | `422 {error: "No packs available"}`; `503` if a drawn rarity has no approved cards (the pack is kept) |

- A pack holds 5 cards. Each card's rarity is drawn independently: Bronze 80%, Silver 17%, Gold 2.5%, Diamond 0.5%.
- Each card is a uniformly random **approved** original card of that rarity.
- `new_card` is `true` when the user owned no copy of the card before that draw.
- The whole pack is one transaction with the user row locked, so concurrent opens can't spend the same pack twice.

## Collection

| Method & path | Access | Request | Success |
|---|---|---|---|
| `GET /api/v1/user_cards` | login | query `page`, `per_page`, `sort` | `200 [GroupedCard]` |
| `GET /api/v1/get_user_card_count` | login | — | `200 <integer>` (distinct cards owned) |
| `POST /api/v1/cards_with_params` | login | form `name`, `sort`, `page`, `per_page`, `include_unowned` | `200 {cards: [GroupedCard], count}` |
| `POST /api/v1/cards_by_rarity` | login | form `visual=true` (required, otherwise `400`), `name?` | `200 [TradeCardOption]` |

`GroupedCard` = `{card_name, api_id, cardtype, season, team, owned_count}`.
`TradeCardOption` = `{card_name, season, api_id, cardtype, owned_count, uuids: [uuid], current_user_owns}`.

- Owned cards are grouped by `(card_name, api_id, cardtype, season)`.
- `include_unowned=true` lists every approved card instead, with `owned_count` 0 for cards the user doesn't own.
- The `name` filter is a case-insensitive substring match.
- `sort` is `<field>_asc` or `<field>_desc`, where the field is `player_name`, `team_name`, `owned` or `rarity`. The default is rarity descending. Missing teams sort last.
- `cards_by_rarity` lists the cards of the user named in `name` (for building a trade offer), or the session user's own. An unknown user returns `[]`. Cards locked in a pending trade are excluded.

## Factory

| Method & path | Access | Request | Success | Errors |
|---|---|---|---|---|
| `POST /api/v1/factory_pack` | login | `{cards: [uuid], rarity}` | `200` the reward's original card `{id, name, cardtype, approved, api_id, season, team, created_at, updated_at}` | `400 {error}` (invalid selection, rarity or recipe); `503` if the rarity has no approved cards (inputs are kept) |

| Output `rarity` | Accepted inputs |
|---|---|
| Bronze | 2 Bronze |
| Silver | 5 Bronze **or** 2 Silver |
| Gold | 5 Silver **or** 2 Gold |
| Diamond | 5 Gold **or** 2 Diamond |

The inputs must be distinct cards the user owns that aren't locked in a pending trade. They are consumed, and the reward is granted, in one transaction.

## Trades

| Method & path | Access | Request | Success |
|---|---|---|---|
| `GET /api/v1/trades` | login | — | `200 TradeList` |
| `POST /api/v1/trades` | login | `{combinedCards: [uuid], receiver: username}` | `201 {id, created_at, updated_at, status}` |
| `GET /api/v1/trades/:id` | participant | — | `200 TradeDetail` |
| `PATCH` or `PUT /api/v1/trades/:id` | participant | `{combinedCards: [uuid]}`, which must equal the trade's card set | `200 {id, created_at, updated_at, status}` |
| `DELETE /api/v1/trades/:id` | participant | — | `204` |

Non-participants and unknown ids get `404 {error: "Trade not found"}`. Rule failures get `422 {error}`, plus `card_ids` when specific cards are at fault.

**Rules:**
- **Offers can't be edited, and there are no counteroffers.** `PATCH` only accepts the offer. A different card set gets `422 "Offered trades are locked and cannot be edited"`.
- **Create:**
  - The offer can include cards from both the sender and the receiver.
  - Every card must exist and belong to one of them.
  - None of the sender's cards may already be locked in another pending trade.
  - You can't trade with yourself.
  - The proposer counts as accepted, and their offered cards are locked until the trade ends.
- **Accept:**
  - The trade must be pending, and the caller must be the participant who hasn't accepted.
  - Every card must still belong to the user who offered it. If not, the response is `422` naming the cards.
  - All the cards then change owner in one transaction, and the trade becomes `accepted`.
  - Concurrent accepts can't transfer twice.
- **Decline/cancel:** a pending trade becomes `declined`. On a trade that isn't pending it does nothing.
- If a card in a pending trade has since moved, that trade stays open, shows a `trade_errors` flag, and fails on acceptance.

**`TradeList`:**
- Parallel arrays over the user's pending trades: `trades` (ids), `current_user_accept`, `user2_name`, `current_user_rarities` and `other_user_rarities` (each `{Rarity: count}`), and `trade_errors`.
- Plus `history`, newest first. Each entry is `{id, other_user, status, offered_card_count, offered_rarity_counts, received_card_count, received_rarity_counts, completed_at}`.

**`TradeDetail`:** `{user_trade_items: [UserCard], user2_trade_items: [UserCard], current_user_accept, user2_name, unavailable_card_ids}`.
- `UserCard` is `{uuid, created_at, updated_at, user_id, cardtype, season, api_id, card_name}`.
- `unavailable_card_ids` lists cards that were deleted or are no longer owned by the user who offered them.

## Card upload and approval

| Method & path | Access | Request | Success | Errors |
|---|---|---|---|---|
| `POST /api/v1/original_cards` | moderator, admin | multipart field `zip` | `201 [OriginalCard]` | `413` ZIP too large; `422 {error, files?}` invalid ZIP or file names; `502` Cloudinary failure (nothing is kept) |
| `GET /api/v1/unapproved` | admin | — | `200 {all_cards: [OriginalCard]}` | — |
| `POST /api/v1/approved` | admin | `{ids: [id]}` | `200 [Cloudinary update result]` | `422 {error, ids?}` unknown or already-approved ids; `502 {error, approved, failed}` |
| `POST /api/v1/delete_cards` | admin | `{ids: [id]}` | `200`, empty body | `422 {error, ids?}`; `502 {error, deleted, failed}` |

**Upload:**
- File names: `Player_Name-rarity-season[-Team_Name][-anything].png`. See the README for the full format.
- Limits: a ZIP of up to 50 MB, with at most 200 images of 20 MB each and 200 MB in total. Every entry must be a real PNG. `__MACOSX/`, `._*` and `.DS_Store` entries are skipped.
- The whole ZIP is validated before anything is uploaded. If any upload fails, the images already uploaded are removed and no rows are written.
- Admins' uploads go to the Cloudinary folder `<season>/<Rarity>` and are approved. Moderators' uploads go to `<season>/Unapproved` and wait in the review queue.
- `api_id` is the Cloudinary public ID without the folder.

**Approve and delete:**
- Both accept only existing, unapproved card ids.
- Approving moves the image to `<season>/<Rarity>`. Deleting removes the image and the card's row.
- If Cloudinary fails partway, the route undoes what it can and logs anything that needs fixing by hand ("Cloudinary cleanup failed").

## Admin users

| Method & path | Access | Request | Success | Errors |
|---|---|---|---|---|
| `GET /api/v1/admin/users` | admin | query `search?`, `role?` | `200 {users: [{id, username, role, forum_uid, packs_available, created_at}], total, limit: 100}`, ordered by username | `422` unknown role |
| `PATCH /api/v1/admin/users/:id` | admin | `{role: "normal" \| "moderator" \| "admin"}` | `200` the updated user | `404` unknown user; `422` invalid role, or the caller's own account |

Role changes are logged, and take effect on the user's next request.
