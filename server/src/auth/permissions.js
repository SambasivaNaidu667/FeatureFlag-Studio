// Single source of truth for role-based permissions.
// The frontend receives this list for display only; the backend enforces it.
const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze([
    "flags:read",
    "flags:create",
    "flags:update",
    "flags:toggle",
    "flags:delete",
    "flags:production",
    "users:manage",
    "audit:read",
  ]),
  developer: Object.freeze([
    "flags:read",
    "flags:create",
    "flags:update",
    "flags:toggle",
  ]),
  viewer: Object.freeze(["flags:read"]),
});

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function can(role, permission) {
  return permissionsFor(role).includes(permission);
}

module.exports = { ROLE_PERMISSIONS, permissionsFor, can };
