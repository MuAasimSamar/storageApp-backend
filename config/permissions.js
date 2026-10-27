export const PERMISSIONS = {
  FILES_READ_OWN: "files:read_own",
  FILES_WRITE_OWN: "files:write_own",
  FILES_DELETE_OWN: "files:delete_own",
  FILES_READ_ALL: "files:read_all",
  USERS_READ: "users:read",
  USERS_UPDATE: "users:update",
  USERS_DELETE: "users:delete",
  USERS_SESSION_TERMINATE: "users:session_terminate",
};

export const ROLE_PERMISSIONS = {
  Owner: ["*"], // Wildcard: Highest authority with full system access
  Admin: ["*"], // Wildcard: has access to everything
  Manager: [
    PERMISSIONS.FILES_READ_ALL,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.FILES_READ_OWN,
    PERMISSIONS.FILES_WRITE_OWN,
    PERMISSIONS.USERS_SESSION_TERMINATE,
  ],
  User: [
    PERMISSIONS.FILES_READ_OWN,
    PERMISSIONS.FILES_WRITE_OWN,
    PERMISSIONS.FILES_DELETE_OWN,
  ],
};
