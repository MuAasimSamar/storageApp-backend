import { ROLE_PERMISSIONS } from "../config/permissions.js";

export function can(requiredPermission) {
  return (req, res, next) => {
    const userRole = req.user?.role;

    if (!userRole) {
      return res
        .status(403)
        .json({ error: "Access denied. No role assigned." });
    }

    const permissions = ROLE_PERMISSIONS[userRole] || [];

    // 1. Admin wildcard check
    if (permissions.includes("*")) {
      return next();
    }

    // 2. Specific permission check
    if (permissions.includes(requiredPermission)) {
      return next();
    }

    // 3. Unauthorized
    return res.status(403).json({
      error: `Forbidden. You do not have permission: ${requiredPermission}`,
    });
  };
}
