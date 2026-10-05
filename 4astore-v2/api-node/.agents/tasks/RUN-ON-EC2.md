# Run on EC2 — full reset + reload (catalogue + users + orders)

This restores the full legacy dataset from `data/*.json`: products (202),
categories (15), banners/config, settings, announcement, **users (42 logins)**,
and **orders**. `addresses.json` is intentionally NOT imported — users re-add
their own addresses.

> Run every command from the API package unless noted:
> `cd <repo>/4astore-v2/api-node`

---

## 1. Backup FIRST (do not skip)

```bash
mysqldump -u <user> -p <dbname> > ~/4astore-backup-$(date +%F-%H%M).sql
```

Restore (if needed):

```bash
mysql -u <user> -p <dbname> < ~/4astore-backup-<stamp>.sql
```

---

## 2. Resolve the data directory

`DEFAULT_DATA_DIR` resolves from `src/services/` four levels up to `<repo>/data`
(i.e. `path.resolve(__dirname, '..','..','..','..','data')`). Use **`data/` ONLY —
NOT `data1/`**.

Override with a positional arg if your data lives elsewhere:

```bash
npx ts-node --transpile-only scripts/import-legacy-json.ts /abs/path/to/data
```

Confirm the files are present:

```bash
ls -1 <repo>/data/{products,categories,users,orders,config,settings,announcement}.json
```

---

## 3. Build

```bash
cd <repo>/4astore-v2/api-node
npm ci
npm run build            # tsc -p tsconfig.json — typechecks src/
```

The CLI runs through `ts-node`, so a successful build is the gate; the CLI does
not need the compiled output.

---

## 4. Option A — CLI one-shot (import only, no truncate)

```bash
npx ts-node --transpile-only scripts/import-legacy-json.ts
```

Prints, e.g.:

```
Done: categories=15 products=202 banners=<n> ads=<n> users=41 orders=16 (skipped=1, renamed=0, noReadable=14) (+ settings, announcement)
```

The CLI does **not** truncate. For a clean "truncate everything then reload",
run the API reset first (Option B) or truncate manually, then run this CLI (or
the API import).

---

## 5. Option B — owner-only API (full reset + import)

Get an owner token:

```bash
curl -s -X POST https://<host>/api/users/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"owner","password":"owner@7543"}'
# copy the "token" value → <TOKEN>
```

Reset (DESTRUCTIVE — truncates all tables incl. users/orders/addresses and
re-seeds the owner):

```bash
curl -X POST https://<host>/api/admin/data/reset \
  -H "Authorization: Bearer <TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"confirm":"RESET"}'
```

Import (reloads catalogue + config + banners + settings + announcement +
**users + orders**):

```bash
curl -X POST https://<host>/api/admin/data/import \
  -H "Authorization: Bearer <TOKEN>"
```

Status:

```bash
curl https://<host>/api/admin/data/status \
  -H "Authorization: Bearer <TOKEN>"
```

> Note: the Bearer token from the login before the reset keeps working because
> reset re-seeds the SAME owner (`owner`/`owner@7543`) with the same JWT secret.

---

## 6. Verification SELECTs

```sql
SELECT COUNT(*) FROM users;                                 -- 42 (41 imported + seeded owner)
SELECT COUNT(*) FROM users WHERE role='owner';              -- 1
SELECT username, role, plain_password IS NOT NULL AS has_plain
  FROM users WHERE role='owner';                            -- owner | owner | 1
SELECT COUNT(*) FROM users WHERE plain_password IS NOT NULL;-- 28 (27 plaintext users + owner; legacy id 5 skipped as owner-mobile collision)

-- 3 sample users (readable password visible for phone support):
SELECT name, mobile, plain_password FROM users
  WHERE username IN ('akash','priya','rahul');

SELECT COUNT(*) FROM orders;                                -- 16
SELECT COUNT(*) FROM orders WHERE user_id IS NULL;          -- 2 (orphan orders kept)
SELECT COUNT(*) FROM categories;                            -- 15
SELECT COUNT(*) FROM products;                              -- 202
SELECT COUNT(*) FROM addresses;                             -- 0 (addresses.json NOT imported)
```

---

## 7. Owner login re-check

```bash
curl -s -X POST https://<host>/api/users/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"owner","password":"owner@7543"}'
# expect HTTP 200 with a token
```

Any imported customer logs in with their original password, e.g.:

```bash
curl -s -X POST https://<host>/api/users/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"akash","password":"akash123"}'
```

---

## 8. ⚠️ SECURITY CAVEAT — readable passwords

The `plain_password` column stores customer passwords in **CLEARTEXT** by
**explicit owner request** so an admin can tell a rural customer their password
over the phone. This is a deliberate deviation from best practice.

- Restrict DB access tightly; never expose this column through any API. It is
  intentionally kept OUT of the Prisma `User` model, so `safeUser()` and every
  users/auth endpoint can never return it. If a future dev adds it to
  `schema.prisma`, they MUST also strip it in `safeUser()`.
- Exclude it from logs and from backups shared outside the business.
- Only accounts that signed up with a plaintext password have a readable value
  (28 users + owner = 29). Accounts imported from a PHP `$2y$` hash have
  `plain_password = NULL` — a one-way hash is never reversed to fabricate one.
- Consider dropping the column once phone-based password support is no longer
  needed: `ALTER TABLE users DROP COLUMN plain_password;`
