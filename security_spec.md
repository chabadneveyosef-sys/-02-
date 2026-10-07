# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants
1. **Authentication & Email Verification**: All access requires an authenticated user with a verified email (`request.auth != null && request.auth.token.email_verified == true`), or the bootstrapped primary admin (`chabadneveyosef@gmail.com`).
2. **Active User Gate**: A blocked user (`isBlocked == true`) loses access to mutate system records.
3. **Strict ID & String Bounds**: Document IDs must match `^[a-zA-Z0-9_\-]+$` and be `<= 64` chars. All string properties must strictly respect `maxLength` defined in `firebase-blueprint.json`.
4. **Immutable Creation Timestamps**: `createdAt` and `id` cannot be altered during an `update` operation.
5. **Anti-Update-Gap**: Every `update` rule must invoke `isValid[Entity](incoming())` AND restrict modified keys via `affectedKeys().hasOnly(...)` or admin override.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: Writing to `/donors/d1` with `auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: Writing to `/users/u1` with `email: "chabadneveyosef@gmail.com"` and `email_verified: false` -> `PERMISSION_DENIED`.
3. **ID Poisoning Attack**: Creating `/tasks/invalid$id!@#` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection (Create)**: Creating `/annual_activities/a1` with an extra undeclared field `hacked: true` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection (Update)**: Updating `/donors/d1` with an extra field `isSuperAdmin: true` -> `PERMISSION_DENIED`.
6. **Value Poisoning (Oversized String)**: Creating `/transactions/tx1` with `description` length > 300 characters -> `PERMISSION_DENIED`.
7. **Immutable Field Mutation**: Updating `/transactions/tx1` where `incoming().createdAt != existing().createdAt` -> `PERMISSION_DENIED`.
8. **Type Confusion**: Updating `/tasks/t1` where `durationDays` is a string `"ten"` instead of a number -> `PERMISSION_DENIED`.
9. **Privilege Escalation**: Non-admin user attempting to update their own `roleTemplate` to `"admin"` in `/users/{uid}` -> `PERMISSION_DENIED`.
10. **Invalid Enum Value**: Creating `/transactions/tx1` with `fundSource: "offshore"` -> `PERMISSION_DENIED`.
11. **Audit Log Tampering**: Attempting to `delete` or `update` an existing record in `/audit_logs/{logId}` -> `PERMISSION_DENIED`.
12. **PII Leak to Anonymous/Unverified**: Listing `/donors` without verified auth -> `PERMISSION_DENIED`.
